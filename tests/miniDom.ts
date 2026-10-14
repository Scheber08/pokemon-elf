/**
 * Minimales DOM für Render-Tests mit react-dom/client in Node (ohne jsdom): Knoten, Elemente,
 * Text, Ereignisse mit Capture/Bubbling und einfache Selektoren (Tag, .klasse, [attr], [attr="x"],
 * Nachfahren). Nur so viel, wie React und die getesteten Komponenten brauchen.
 *
 * Muss vor react-dom/client geladen werden (React prüft beim Laden, ob es ein DOM gibt):
 *   import { installMiniDom } from './miniDom'; installMiniDom();  – dann dynamisch importieren.
 */

const HTML_NS = 'http://www.w3.org/1999/xhtml';

type Listener = { fn: (ev: MiniEvent) => void; capture: boolean };

/** Ereignisziel „window" – dort endet das Bubbling (von installMiniDom gesetzt) */
let windowTarget: MiniNode | null = null;

export class MiniEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  target: MiniNode | null = null;
  currentTarget: MiniNode | null = null;
  eventPhase = 0;
  defaultPrevented = false;
  timeStamp = Date.now();
  isTrusted = true;
  button = 0;
  private stopped = false;

  constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean } = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? false;
  }
  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
  stopPropagation() {
    this.stopped = true;
  }
  stopImmediatePropagation() {
    this.stopped = true;
  }
  get propagationStopped() {
    return this.stopped;
  }
}

export class MiniNode {
  parentNode: MiniNode | null = null;
  childNodes: MiniNode[] = [];
  private listeners = new Map<string, Listener[]>();

  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    public ownerDocument: MiniDocument | null,
  ) {}

  get firstChild(): MiniNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): MiniNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling(): MiniNode | null {
    const p = this.parentNode;
    return p ? (p.childNodes[p.childNodes.indexOf(this) + 1] ?? null) : null;
  }
  get previousSibling(): MiniNode | null {
    const p = this.parentNode;
    return p ? (p.childNodes[p.childNodes.indexOf(this) - 1] ?? null) : null;
  }
  get parentElement(): MiniElement | null {
    return this.parentNode instanceof MiniElement ? this.parentNode : null;
  }
  appendChild<T extends MiniNode>(child: T): T {
    return this.insertBefore(child, null);
  }
  insertBefore<T extends MiniNode>(child: T, ref: MiniNode | null): T {
    child.parentNode?.removeChild(child);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(child);
    else this.childNodes.splice(i, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild<T extends MiniNode>(child: T): T {
    const i = this.childNodes.indexOf(child);
    if (i < 0) throw new Error('removeChild: kein Kind dieses Knotens');
    this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  contains(node: MiniNode | null): boolean {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  getRootNode(): MiniNode {
    let n: MiniNode = this;
    while (n.parentNode) n = n.parentNode;
    return n;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(value: string) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (value) this.appendChild(this.ownerDocument!.createTextNode(String(value)));
  }
  addEventListener(type: string, fn: (ev: MiniEvent) => void, opts?: boolean | { capture?: boolean }) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    const list = this.listeners.get(type) ?? [];
    if (!list.some((l) => l.fn === fn && l.capture === capture)) list.push({ fn, capture });
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: (ev: MiniEvent) => void, opts?: boolean | { capture?: boolean }) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((l) => !(l.fn === fn && l.capture === capture)));
  }
  /** Capture (Wurzel → Ziel), dann Bubbling (Ziel → Wurzel, falls bubbles). */
  dispatchEvent(ev: MiniEvent): boolean {
    const path: MiniNode[] = [];
    for (let n: MiniNode | null = this; n; n = n.parentNode) path.push(n);
    const win = windowTarget;
    ev.target = this;
    const call = (node: MiniNode, capture: boolean, phase: number) => {
      ev.currentTarget = node;
      ev.eventPhase = phase;
      for (const l of [...(node.listeners.get(ev.type) ?? [])]) {
        if (l.capture === capture || phase === 2) l.fn.call(node, ev);
      }
    };
    for (let i = path.length - 1; i > 0 && !ev.propagationStopped; i--) call(path[i], true, 1);
    if (!ev.propagationStopped) call(this, true, 2);
    if (ev.bubbles) {
      for (let i = 1; i < path.length && !ev.propagationStopped; i++) call(path[i], false, 3);
      if (win && win !== this && !ev.propagationStopped) call(win, false, 3);
    }
    ev.currentTarget = null;
    return !ev.defaultPrevented;
  }
}

export class MiniText extends MiniNode {
  constructor(
    public data: string,
    doc: MiniDocument,
  ) {
    super(3, '#text', doc);
  }
  get nodeValue() {
    return this.data;
  }
  set nodeValue(v: string) {
    this.data = String(v);
  }
  override get textContent() {
    return this.data;
  }
  override set textContent(v: string) {
    this.data = String(v);
  }
}

export class MiniComment extends MiniNode {
  constructor(
    public data: string,
    doc: MiniDocument,
  ) {
    super(8, '#comment', doc);
  }
  override get textContent() {
    return '';
  }
}

function makeStyle(): Record<string, unknown> & {
  setProperty(name: string, value: string): void;
  removeProperty(name: string): void;
  getPropertyValue(name: string): string;
} {
  const props: Record<string, string> = {};
  return Object.assign(Object.create(null) as Record<string, unknown>, {
    setProperty(name: string, value: string) {
      props[name] = String(value);
    },
    removeProperty(name: string) {
      delete props[name];
    },
    getPropertyValue(name: string) {
      return props[name] ?? '';
    },
  });
}

/** Einfache Selektoren: „tag.klasse[attr][attr="wert"]", durch Leerzeichen als Nachfahren verbunden. */
function parseCompound(sel: string) {
  const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/.exec(sel.trim());
  if (!m) throw new Error(`Selektor nicht unterstützt: ${sel}`);
  const classes = m[2] ? m[2].split('.').filter(Boolean) : [];
  const attrs = [...(m[3] ?? '').matchAll(/\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g)].map((a) => ({
    name: a[1],
    value: a[2] ?? a[3] ?? a[4],
  }));
  return { tag: m[1]?.toLowerCase(), classes, attrs };
}

function matchesCompound(el: MiniElement, c: ReturnType<typeof parseCompound>): boolean {
  if (c.tag && el.localName !== c.tag) return false;
  const cls = (el.getAttribute('class') ?? '').split(/\s+/);
  if (c.classes.some((k) => !cls.includes(k))) return false;
  return c.attrs.every((a) => el.hasAttribute(a.name) && (a.value === undefined || el.getAttribute(a.name) === a.value));
}

function matches(el: MiniElement, selector: string): boolean {
  return selector.split(',').some((alt) => {
    const parts = alt.trim().split(/\s+/).map(parseCompound);
    if (!matchesCompound(el, parts[parts.length - 1])) return false;
    let node: MiniNode | null = el.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (node && !(node instanceof MiniElement && matchesCompound(node, parts[i]))) node = node.parentNode;
      if (!node) return false;
      node = node.parentNode;
    }
    return true;
  });
}

export class MiniElement extends MiniNode {
  readonly localName: string;
  readonly tagName: string;
  readonly namespaceURI: string;
  readonly style = makeStyle();
  readonly dataset: Record<string, string> = {};
  private attrs = new Map<string, string>();
  offsetTop = 0;
  offsetHeight = 0;
  offsetWidth = 0;
  [key: string]: unknown;

  constructor(tag: string, doc: MiniDocument, ns = HTML_NS) {
    super(1, tag.toUpperCase(), doc);
    this.localName = tag.toLowerCase();
    this.tagName = tag.toUpperCase();
    this.namespaceURI = ns;
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name.toLowerCase()) ?? null;
  }
  setAttribute(name: string, value: unknown) {
    this.attrs.set(name.toLowerCase(), String(value));
  }
  setAttributeNS(_ns: string | null, name: string, value: unknown) {
    this.setAttribute(name, value);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name.toLowerCase());
  }
  removeAttributeNS(_ns: string | null, name: string) {
    this.removeAttribute(name);
  }
  hasAttribute(name: string) {
    return this.attrs.has(name.toLowerCase());
  }
  getAttributeNames() {
    return [...this.attrs.keys()];
  }
  /** Für die Ausgabe in Testmeldungen (pretty-format liest attributes) */
  get attributes() {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
  }
  get children() {
    return this.childNodes.filter((c) => c instanceof MiniElement);
  }
  get id() {
    return this.getAttribute('id') ?? '';
  }
  get className() {
    return this.getAttribute('class') ?? '';
  }
  focus() {
    this.ownerDocument!.activeElement = this;
  }
  blur() {
    if (this.ownerDocument!.activeElement === this) this.ownerDocument!.activeElement = null;
  }
  click() {
    this.dispatchEvent(new MiniEvent('click', { bubbles: true, cancelable: true }));
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} };
  }
  scrollIntoView() {}
  matches(selector: string) {
    return matches(this, selector);
  }
  closest(selector: string): MiniElement | null {
    for (let n: MiniNode | null = this; n; n = n.parentNode) if (n instanceof MiniElement && n.matches(selector)) return n;
    return null;
  }
  querySelectorAll(selector: string): MiniElement[] {
    const out: MiniElement[] = [];
    const walk = (n: MiniNode) => {
      for (const c of n.childNodes) {
        if (c instanceof MiniElement) {
          if (matches(c, selector)) out.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): MiniElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

export class MiniDocument extends MiniNode {
  readonly documentElement: MiniElement;
  readonly head: MiniElement;
  readonly body: MiniElement;
  activeElement: MiniElement | null = null;
  defaultView: unknown = globalThis;
  visibilityState: 'visible' | 'hidden' = 'visible';
  title = '';

  constructor() {
    super(9, '#document', null);
    this.ownerDocument = null;
    this.documentElement = new MiniElement('html', this);
    this.head = new MiniElement('head', this);
    this.body = new MiniElement('body', this);
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string) {
    return new MiniElement(tag, this);
  }
  createElementNS(ns: string, tag: string) {
    return new MiniElement(tag, this, ns);
  }
  createTextNode(text: string) {
    return new MiniText(String(text), this);
  }
  createComment(text: string) {
    return new MiniComment(String(text), this);
  }
  querySelector(selector: string) {
    return this.documentElement.querySelector(selector);
  }
  querySelectorAll(selector: string) {
    return this.documentElement.querySelectorAll(selector);
  }
  getElementById(id: string) {
    return this.documentElement.querySelectorAll(`[id="${id}"]`)[0] ?? null;
  }
}

/** IntersectionObserver-Attrappe: Tests melden die beobachteten Ziele selbst als sichtbar. */
export class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets = new Set<unknown>();
  constructor(private readonly cb: (entries: { isIntersecting: boolean; target: unknown }[]) => void) {
    FakeObserver.all.push(this);
  }
  observe(target: unknown) {
    this.targets.add(target);
  }
  unobserve(target: unknown) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  /** Alle beobachteten Ziele „sichtbar" melden */
  fire() {
    if (this.targets.size) this.cb([...this.targets].map((target) => ({ isIntersecting: true, target })));
  }
  static fireAll() {
    for (const o of [...FakeObserver.all]) o.fire();
  }
}

/** ResizeObserver-Attrappe: meldet nie etwas (Größen gibt es im Mini-DOM nicht). */
export class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Speicher-Attrappe für localStorage */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

/**
 * Globales DOM einrichten: window (= globalThis, damit window.setTimeout den Fake-Timern folgt),
 * document, Event, Beobachter, matchMedia, localStorage. Gibt das Dokument zurück.
 */
export function installMiniDom(): MiniDocument {
  const g = globalThis as unknown as Record<string, unknown>;
  const doc = new MiniDocument();
  const winEvents = new MiniNode(0, '#window', doc);
  windowTarget = winEvents;
  g.window = globalThis;
  g.document = doc;
  g.self = globalThis;
  g.addEventListener = winEvents.addEventListener.bind(winEvents);
  g.removeEventListener = winEvents.removeEventListener.bind(winEvents);
  g.dispatchEvent = winEvents.dispatchEvent.bind(winEvents);
  g.Event = MiniEvent;
  g.Node = MiniNode;
  g.Element = MiniElement;
  g.HTMLElement = MiniElement;
  g.HTMLIFrameElement = class HTMLIFrameElement {};
  g.IntersectionObserver = FakeObserver;
  g.ResizeObserver = FakeResizeObserver;
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  g.localStorage = memoryStorage();
  g.sessionStorage = memoryStorage();
  g.IS_REACT_ACT_ENVIRONMENT = true;
  // <select>: React liest select.options – hier aus den <option>-Kindern
  if (!Object.getOwnPropertyDescriptor(MiniElement.prototype, 'options')) {
    Object.defineProperty(MiniElement.prototype, 'options', {
      configurable: true,
      get(this: MiniElement) {
        if (this.localName !== 'select') return undefined;
        return this.querySelectorAll('option').map((o) => {
          if (o.value == null) o.value = o.getAttribute('value') ?? o.textContent;
          return o;
        });
      },
    });
  }
  if (typeof g.requestAnimationFrame !== 'function') {
    g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16);
    g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  }
  return doc;
}
