import { useMemo, useRef, useState } from 'react';
import { useT, type Messages } from '../i18n';
import { ApiRequestError, buyTrainerItem, saveTrainer } from '../lib/api/client';
import type { MeResponse } from '../lib/api/contract';
import { affordableCount, itemKey, nextGoal, itemOnSale, itemsOf, lockedItem, nextSeason, shopCollection, TRAINER_ITEMS, TRAINER_SLOTS, type TrainerItem, type TrainerLook, type TrainerSlot } from '../lib/trainer';
import type { Pokemon } from '../types';
import { usePokemonData } from '../state/PokemonData';
import { useToast } from '../state/Toast';
import { useSettings } from '../state/Settings';
import { SaveImageButton } from './SaveImageButton';
import { Segmented } from './Segmented';
import { Sprite } from './Sprite';
import { TrainerAvatar } from './TrainerAvatar';

/** Anzeigename eines Katalog-Eintrags */
export function trainerItemName(t: Messages, it: Pick<TrainerItem, 'slot' | 'id'>, byId: Map<number, Pokemon>): string {
  const tx = t.trainer;
  switch (it.slot) {
    case 'skin':
    case 'hairColor':
    case 'outfitColor':
      return tx.items.color[it.id] ?? it.id;
    case 'face':
    case 'hair':
    case 'outfit':
    case 'hat':
    case 'accessory':
    case 'background':
      return (tx.items[it.slot] as Record<string, string>)[it.id] ?? it.id;
    case 'companion': {
      const p = it.id === 'none' ? undefined : byId.get(Number(it.id));
      return p ? t.game.pokemon(p) : tx.items.companionNone;
    }
    case 'title':
      return tx.titles[it.id] ?? it.id;
  }
}

const COLOR_SLOTS = new Set<TrainerSlot>(['skin', 'hairColor', 'outfitColor']);

/** Zufälliger Look – nur aus Freiem und Gekauftem (also immer speicherbar) */
export function randomLook(owned: ReadonlySet<string>, rnd: () => number = Math.random): TrainerLook {
  const out = {} as TrainerLook;
  for (const slot of TRAINER_SLOTS) {
    const items = itemsOf(slot).filter((i) => i.price === 0 || owned.has(itemKey(slot, i.id)));
    out[slot] = items[Math.floor(rnd() * items.length)].id;
  }
  return out;
}

interface Props {
  me: MeResponse;
  onMe: (me: MeResponse) => void;
}

/** Trainer gestalten: Vorschau, je Slot die Auswahl (Gesperrtes mit Preis), Kaufen und Speichern. */
export function TrainerEditor({ me, onMe }: Props) {
  const t = useT();
  const tx = t.trainer;
  const toast = useToast();
  const { byId } = usePokemonData();
  const { sprite } = useSettings();
  const [look, setLook] = useState<TrainerLook>(me.trainer);
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'save' | string | null>(null);
  /** Shop-Filter: alles, nur Freigeschaltetes oder was man sich gerade leisten kann */
  const [filter, setFilter] = useState<'all' | 'owned' | 'affordable'>('all');
  const owned = useMemo(() => new Set(me.owned), [me.owned]);
  const dirty = TRAINER_SLOTS.some((s) => look[s] !== me.trainer[s]);
  const locked = lockedItem(look, owned);
  /** Gesperrte Teile in der Vorschau – zum Kaufen */
  const lockedNow = TRAINER_SLOTS.flatMap((slot) => {
    const it = itemsOf(slot).find((i) => i.id === look[slot]);
    return it && it.price > 0 && !owned.has(itemKey(slot, it.id)) ? [it] : [];
  });

  const fail = (e: unknown) => toast(e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : String(e));

  const save = async () => {
    setBusy('save');
    try {
      const next = await saveTrainer(look);
      onMe(next);
      setLook(next.trainer);
      toast(tx.saved);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const buy = async (it: TrainerItem) => {
    const key = itemKey(it.slot, it.id);
    setBusy(key);
    try {
      onMe(await buyTrainerItem(key));
      toast(tx.bought(trainerItemName(t, it, byId)));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card trainer-editor" aria-labelledby="trainer-editor-title">
      <h2 id="trainer-editor-title" className="section-title">
        {tx.editorTitle}
      </h2>
      <p className="muted small">{tx.editorNote}</p>
      <div className="trainer-editor__layout">
        <div className="trainer-editor__preview">
          {/* Trainerkarte – „Als Bild" speichert genau diesen Bereich */}
          <div className="trainer-card" ref={cardRef}>
            <TrainerAvatar look={look} size={180} label={tx.editorTitle} />
            {me.player && <strong className="trainer-editor__name">{me.player}</strong>}
            {look.title !== 'none' && <span className="trainer-editor__title">{tx.titles[look.title]}</span>}
            {(() => {
              // Begleiter mit Namen (auch auf dem gespeicherten Bild)
              const pet = look.companion !== 'none' ? byId.get(Number(look.companion)) : undefined;
              return pet && <span className="muted small trainer-card__pet">{tx.withCompanion(t.game.pokemon(pet))}</span>;
            })()}
            <span className="muted small">
              {tx.progress(me.achievements.filter((a) => a.done).length, me.achievements.length)}
            </span>
            {(() => {
              // Gesammelte Shop-Artikel (auch auf dem gespeicherten Bild)
              const have = shopCollection(owned).have;
              return have > 0 && <span className="muted small trainer-card__items">{tx.cardItems(have)}</span>;
            })()}
          </div>
          <SaveImageButton target={cardRef} filename="pokemon-elf-trainer.png" label={tx.cardImage} aria={tx.cardImageAria} />
          {lockedNow.map((it) => {
            const name = trainerItemName(t, it, byId);
            const missing = it.price - me.coins.balance;
            return (
              <div key={itemKey(it.slot, it.id)} className="trainer-editor__buy">
                <span className="small">{tx.previewing(name)}</span>
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  disabled={busy != null || missing > 0}
                  aria-label={tx.buyAria(name, it.price)}
                  onClick={() => buy(it)}
                >
                  {tx.buy(it.price)}
                </button>
                {missing > 0 && <span className="muted small">{tx.tooExpensive(missing)}</span>}
              </div>
            );
          })}
          <div className="trainer-editor__actions">
            <button type="button" className="btn btn--primary" disabled={!dirty || !!locked || busy != null} onClick={save}>
              {busy === 'save' ? tx.saving : tx.save}
            </button>
            <button
              type="button"
              className="btn btn--small"
              disabled={busy != null}
              title={tx.randomTitle}
              onClick={() => setLook(randomLook(owned))}
            >
              🎲 {tx.random}
            </button>
            {dirty && (
              <button type="button" className="btn btn--ghost btn--small" disabled={busy != null} onClick={() => setLook(me.trainer)}>
                {tx.reset}
              </button>
            )}
          </div>
          {dirty && <span className="muted small">{locked ? tx.lockedNote : tx.unsaved}</span>}
        </div>
        <div className="trainer-editor__slots">
          {(() => {
            // Hinweis auf Saisonartikel, die gerade im Shop sind (je Saison einmal)
            const now = Date.now();
            const seasons = [...new Map(TRAINER_ITEMS.filter((i) => i.season && itemOnSale(i, now)).map((i) => [i.season!.icon, i.season!])).values()];
            const next = nextSeason(TRAINER_ITEMS, now);
            return (
              <>
                {seasons.map((s) => (
                  <p key={s.icon} className="trainer-editor__season">
                    <span aria-hidden="true">{s.icon}</span> {tx.seasonNow(s.to)}
                  </p>
                ))}
                {next && (
                  <p className="trainer-editor__season trainer-editor__next muted small">
                    {tx.seasonNext(next.icon, next.from)}
                  </p>
                )}
                {(() => {
                  const c = shopCollection(owned);
                  return (
                    <p className="trainer-editor__collection muted small">
                      {tx.collection(c.have, c.total)}
                    </p>
                  );
                })()}
                {(() => {
                  // 🎯 Günstigster Artikel, für den die Münzen noch nicht reichen
                  const goal = nextGoal(owned, me.coins.balance, now);
                  return (
                    goal && (
                      <p className="trainer-editor__goal muted small">{tx.nextGoal(trainerItemName(t, goal, byId), goal.price - me.coins.balance)}</p>
                    )
                  );
                })()}
              </>
            );
          })()}
          <Segmented<'all' | 'owned' | 'affordable'>
            label={tx.filter}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: tx.filterAll },
              { value: 'owned', label: tx.filterOwned },
              { value: 'affordable', label: tx.filterAffordableCount(affordableCount(owned, me.coins.balance, Date.now())) },
            ]}
          />
          {TRAINER_SLOTS.map((slot) => (
            <fieldset key={slot} className="trainer-slot">
              <legend className="field__label">{tx.slots[slot]}</legend>
              <div className={`trainer-slot__options ${COLOR_SLOTS.has(slot) ? 'is-colors' : ''}`}>
                {itemsOf(slot).map((it) => {
                  const key = itemKey(slot, it.id);
                  const have = it.price === 0 || owned.has(key);
                  // Saisonartikel außerhalb ihrer Saison nur, wenn schon gekauft
                  if (!have && !itemOnSale(it, Date.now())) return null;
                  // Filter – das gerade getragene Teil bleibt immer sichtbar
                  if (look[slot] !== it.id && ((filter === 'owned' && !have) || (filter === 'affordable' && !have && it.price > me.coins.balance))) {
                    return null;
                  }
                  const active = look[slot] === it.id;
                  const name = trainerItemName(t, it, byId);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`trainer-option ${active ? 'is-active' : ''} ${have ? '' : 'is-locked'}`}
                      aria-pressed={active}
                      title={[name, it.season ? tx.seasonal(it.season.to) : '', have ? '' : tx.price(it.price)].filter(Boolean).join(' · ')}
                      onClick={() => setLook((l) => ({ ...l, [slot]: it.id }))}
                    >
                      {COLOR_SLOTS.has(slot) ? (
                        <span className="trainer-option__swatch" style={{ background: it.color }} />
                      ) : slot === 'title' ? (
                        <span className="trainer-option__text">{name}</span>
                      ) : slot === 'companion' ? (
                        <span className="trainer-option__pet">
                          {it.id === 'none' ? (
                            <span aria-hidden="true">–</span>
                          ) : (
                            byId.get(Number(it.id)) && <Sprite pokemon={byId.get(Number(it.id))!} style={sprite} />
                          )}
                        </span>
                      ) : (
                        // Frisuren ohne Kopfbedeckung zeigen (die Kappe verdeckt sie sonst)
                        <TrainerAvatar look={{ ...look, [slot]: it.id, ...(slot === 'hair' ? { hat: 'none' } : {}) }} size={52} companion={false} />
                      )}
                      <span className="sr-only">{name}</span>
                      {!have && <span className="trainer-option__price">{tx.price(it.price)}</span>}
                      {it.season && (
                        <span className="trainer-option__season" aria-hidden="true">
                          {it.season.icon}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </div>
    </section>
  );
}
