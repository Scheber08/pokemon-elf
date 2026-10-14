/**
 * Test-Helfer für den Online-Draft: Fake-WebSocket, -Uhr, -Alarm und -Speicher rund um
 * DraftRoomCore – so, wie server/draftRoom.ts ihn mit der echten Laufzeit verbindet –
 * und ein Fake-Namespace für env.DRAFTS (HTTP-Endpunkte).
 */
import type { DraftServerMessage, DraftSnapshot } from '../src/lib/api/draftContract';
import type { Scale } from '../src/lib/fit';
import type { Pokemon } from '../src/types';
import { DraftRoomCore, type ClosedRoom, type ConnAttachment, type DraftConn, type RoomRecord } from '../server/draftCore';
import type { DraftNamespace, DraftRoomStub, Env } from '../server/env';

/** WebSocket wie in der Hibernation-API: Anhang wird (wie serializeAttachment) kopiert. */
export class FakeSocket implements DraftConn {
  /** Alle empfangenen Nachrichten (geparst) … */
  readonly received: DraftServerMessage[] = [];
  /** … und roh, wie verschickt */
  readonly raw: string[] = [];
  closed: { code: number; reason: string } | null = null;
  private att: ConnAttachment | null;

  constructor(att: ConnAttachment) {
    this.att = structuredClone(att);
  }

  attachment(): ConnAttachment | null {
    return this.att ? structuredClone(this.att) : null;
  }

  setAttachment(a: ConnAttachment): void {
    this.att = structuredClone(a);
  }

  send(data: string): void {
    if (this.closed) throw new Error('WebSocket ist geschlossen');
    this.raw.push(data);
    this.received.push(JSON.parse(data) as DraftServerMessage);
  }

  close(code: number, reason: string): void {
    this.closed ??= { code, reason };
  }

  isOpen(): boolean {
    return !this.closed;
  }

  /** Letzter empfangener Zustand */
  get state(): DraftSnapshot | null {
    for (let i = this.received.length - 1; i >= 0; i--) {
      const m = this.received[i];
      if (m.type === 'state') return m.state;
    }
    return null;
  }

  get states(): DraftSnapshot[] {
    return this.received.flatMap((m) => (m.type === 'state' ? [m.state] : []));
  }

  get errors(): { code: string; message: string }[] {
    return this.received.flatMap((m) => (m.type === 'error' ? [{ code: m.code, message: m.message }] : []));
  }

  get lastError(): { code: string; message: string } | null {
    const e = this.errors;
    return e.length ? e[e.length - 1] : null;
  }

  /** Empfangenes vergessen (für „bekommt nichts"-Prüfungen) */
  reset(): void {
    this.received.length = 0;
    this.raw.length = 0;
  }
}

/** Ein Draft-Raum mit Fake-Uhr, -Alarm und -Speicher (Speicher wird wie in echt kopiert). */
export class FakeRoom {
  now: number;
  alarmAt: number | null = null;
  stored: RoomRecord | null = null;
  /** Grabstein einer geschlossenen Lobby (statt stored) */
  closedRec: ClosedRoom | null = null;
  readonly sockets: FakeSocket[] = [];
  /** Wie oft der Alarm gestellt wurde */
  alarmSets = 0;
  core: DraftRoomCore;

  constructor(
    private readonly env: Pick<Env, 'DB' | 'IP_SALT'>,
    private readonly list: Pokemon[],
    private readonly scale: Scale,
    now = Date.now(),
  ) {
    this.now = now;
    this.core = this.makeCore();
  }

  private makeCore(): DraftRoomCore {
    return new DraftRoomCore({
      storage: {
        load: async () => structuredClone(this.stored ?? this.closedRec ?? null),
        save: async (rec) => {
          if ('closed' in rec) {
            this.closedRec = structuredClone(rec);
            this.stored = null;
          } else {
            this.stored = structuredClone(rec);
            this.closedRec = null;
          }
        },
        clear: async () => {
          this.stored = null;
          this.closedRec = null;
        },
      },
      now: () => this.now,
      alarm: {
        set: async (at) => {
          this.alarmAt = at;
          this.alarmSets++;
        },
        clear: async () => {
          this.alarmAt = null;
        },
      },
      // Wie getWebSockets(): auch schon geschlossene – der Kern prüft isOpen()
      sockets: () => this.sockets,
      env: this.env,
      list: this.list,
      scale: this.scale,
    });
  }

  /** Simuliert Hibernation bzw. Neustart: neuer Kern, Zustand nur aus dem Speicher. */
  restart(): void {
    this.core = this.makeCore();
  }

  /** Neue Verbindung (wie fetch() im Durable Object: erst admit, dann angenommen). */
  connect(ip: string | null = null): FakeSocket {
    const att = this.core.admit(ip);
    if (!att) throw new Error('429: Raum voll');
    const sock = new FakeSocket(att);
    this.sockets.push(sock);
    return sock;
  }

  /** Offene Verbindungen */
  get open(): FakeSocket[] {
    return this.sockets.filter((s) => !s.closed);
  }

  /** Nachricht schicken – Objekte als JSON, Strings/Binärdaten unverändert. */
  async send(sock: FakeSocket, msg: unknown): Promise<void> {
    const raw = typeof msg === 'string' || msg instanceof ArrayBuffer ? msg : JSON.stringify(msg);
    await this.core.message(sock, raw);
  }

  /** Verbindung bricht ab (webSocketClose). */
  async drop(sock: FakeSocket): Promise<void> {
    sock.close(1006, 'weg');
    await this.core.disconnect(sock);
  }

  /** Uhr bis `t` vorstellen; fällige Alarme feuern zu ihrer Zeit (wie die Laufzeit). */
  async advanceTo(t: number): Promise<void> {
    while (this.alarmAt != null && this.alarmAt <= t) {
      this.now = Math.max(this.now, this.alarmAt);
      this.alarmAt = null;
      await this.core.alarm();
    }
    this.now = Math.max(this.now, t);
  }

  advance(ms: number): Promise<void> {
    return this.advanceTo(this.now + ms);
  }

  /** Den nächsten Alarm feuern lassen (Uhr springt dorthin). */
  async fireAlarm(): Promise<void> {
    if (this.alarmAt == null) throw new Error('Kein Alarm gestellt');
    await this.advanceTo(this.alarmAt);
  }
}

/** env.DRAFTS für Tests: ein FakeRoom pro Code; fetch() merkt sich weitergereichte Upgrades. */
export class FakeNamespace implements DraftNamespace {
  readonly rooms = new Map<string, FakeRoom>();
  readonly forwarded: Request[] = [];

  constructor(private readonly makeRoom: (code: string) => FakeRoom) {}

  idFromName(name: string) {
    return { toString: () => name };
  }

  room(code: string): FakeRoom {
    let room = this.rooms.get(code);
    if (!room) {
      room = this.makeRoom(code);
      this.rooms.set(code, room);
    }
    return room;
  }

  get(id: { toString(): string }): DraftRoomStub {
    const room = this.room(id.toString());
    return {
      create: (input) => room.core.create(input),
      snapshot: () => room.core.snapshot(),
      // Wie RPC: Werte kommen als Kopie an
      rematchTemplate: async (deviceId, dead) => structuredClone(await room.core.rematchTemplate(deviceId, dead)),
      createFrom: (state) => room.core.createFrom(structuredClone(state)),
      setRematch: (code, dead) => room.core.setRematch(code, dead),
      fetch: async (request) => {
        this.forwarded.push(request);
        return new Response('weitergereicht', { status: 200 });
      },
    };
  }
}
