import { useRef, useState } from 'react';
import { TypeBadge } from '../components/Badges';
import { LevelIcon } from '../components/LevelIcon';
import { downloadBlob, nodeToPng } from '../lib/exportImage';
import {
  FACTORS,
  FACTOR_LABEL,
  LEVEL_LABEL,
  POSITIONS,
  PROFILES,
  PROFILE_GROUPS,
  type Level,
} from '../config/positions';
import { SCORING } from '../config/scoring';
import { SEASON } from '../config/season';
import { useToast } from '../state/Toast';

const LEVELS: Level[] = [3, 2, 1, 0];
const fmt = (n: number) => n.toLocaleString('de-DE');

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Soll mein Innenverteidiger hohe Verteidigung oder hohe KP haben?',
    a: 'Verteidigung ist beim Innenverteidiger der Schlüsselwert, KP hilft nur. Ein Pokémon mit 130 Verteidigung und mittleren KP ist fast immer die bessere Wahl als ein KP-Riese mit dünner Abwehr. Größe und Gewicht helfen zusätzlich – Kopfballduelle gewinnt man nicht mit 0,3 m.',
  },
  {
    q: 'Warum sehe ich die exakten Ratings nicht?',
    a: 'Weil Scouting mit dem Auge der halbe Spaß ist. Die Tabelle verrät, worauf es ankommt – welche Zahl am Ende herauskommt, siehst du erst nach der Saison am Team-Score.',
  },
  {
    q: 'Sind Legendäre nicht einfach immer besser?',
    a: 'Oft ja, deshalb sind in den Challenges höchstens zwei erlaubt. Aber auch Legendäre unterliegen denselben Regeln: Ein Legendäres mit niedriger Initiative bleibt ein schwacher Flügelspieler.',
  },
  {
    q: 'Bringt ein passender Typ viel?',
    a: 'Nein – der Typ-Bonus ist ein Tie-Breaker. +3 % für den ersten gelisteten Typ, +2 % bzw. +1 % für die weiteren. Zwischen zwei ähnlich starken Kandidaten kann er den Ausschlag geben, mehr nicht.',
  },
  {
    q: 'Warum ist meine Elf mit drei Stars und einem Loch so schwach?',
    a: 'Die drei schwächsten Positionen zählen zusätzlich mit doppeltem Gewicht. Ein Loch zieht stärker runter, als ein Star hebt – eine ausgeglichene Elf schlägt fast immer eine Elf mit Lücken.',
  },
  {
    q: 'Was macht der Standardschütze?',
    a: 'Er zählt nicht zum Team-Score. In der Saison verwandelt er einen Teil der Tore aus Standards und gibt einen kleinen Bonus auf die Torerwartung – je besser Sp.-Angriff und Angriff, desto mehr.',
  },
  {
    q: 'Warum sind die Scores in der 151 Challenge anders?',
    a: 'Für Retro und die 151 Challenge wird nur über die Original-151 normalisiert. So sind Scores innerhalb jeder Challenge fair vergleichbar – ein Glurak wird an den Kanto-Pokémon gemessen, nicht an Paldea.',
  },
];

export function Scouting() {
  const tableRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const saveTable = async () => {
    if (!tableRef.current) return;
    setBusy(true);
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      downloadBlob(await nodeToPng(tableRef.current, { scale: 2, background: bg }), 'pokemon-elf-scouting.png');
    } catch {
      toast('Tabelle konnte nicht gespeichert werden');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page scouting">
      <header className="page-head">
        <h1 className="page-title">Scouting-Guide</h1>
        <p className="page-lead">
          Was ein Pokémon auf jeder Position gut macht. Die exakten Zahlen bleiben geheim – mit dem Auge scouten ist der
          halbe Spaß.
        </p>
      </header>

      <div className="scouting__table card" ref={tableRef}>
        <div className="scouting__legend" aria-label="Legende">
          {LEVELS.map((l) => (
            <span key={l} className={`lvl lvl--${l}`}>
              <LevelIcon level={l} size={16} /> {LEVEL_LABEL[l]}
            </span>
          ))}
        </div>
        {PROFILE_GROUPS.map((g) => (
          <section key={g.title} className="scouting__group">
            <h2 className="section-title">{g.title}</h2>
            <div className="table-scroll">
              <table className="scout-table">
                <thead>
                  <tr>
                    <th scope="col" className="left">
                      Position
                    </th>
                    {FACTORS.map((f) => (
                      <th scope="col" key={f}>
                        {FACTOR_LABEL[f]}
                      </th>
                    ))}
                    <th scope="col" className="left">
                      Typ-Bonus
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.profiles.map(({ key, codes }) => {
                    const pr = PROFILES[key];
                    return (
                      <tr key={key}>
                        <th scope="row" className="left">
                          <span className="scout-table__codes">{codes}</span>
                          <span className="scout-table__title">{pr.title}</span>
                          <span className="scout-table__role">{pr.role}</span>
                        </th>
                        {FACTORS.map((f) => {
                          const l = pr.weights[f];
                          const note = pr.notes?.[f];
                          return (
                            <td key={f} className={`lvl lvl--${l}`} title={`${FACTOR_LABEL[f]}: ${LEVEL_LABEL[l]}`}>
                              <LevelIcon level={l} />
                              {note && <small className="lvl__note">{note}</small>}
                            </td>
                          );
                        })}
                        <td className="left">
                          <span className="type-badges">
                            {pr.types.length ? pr.types.map((t) => <TypeBadge key={t} type={t} small />) : '–'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        <p className="scouting__mark">Pokémon Elf · Scouting-Guide</p>
      </div>
      <div className="actionbar">
        <button type="button" className="btn btn--primary" onClick={saveTable} disabled={busy}>
          {busy ? 'Speichere …' : 'Tabelle speichern'}
        </button>
      </div>

      <div className="prose-grid">
        <section className="card prose">
          <h2 className="section-title">Wie ein Team bewertet wird</h2>
          <p>
            Jedes Pokémon bekommt pro Position einen Fit von 0 bis 100. Der Team-Score (0–1.000) ist der gewichtete
            Durchschnitt der elf Fits mal zehn. Die Gewichte: Torwart {fmt(POSITIONS.TW.teamWeight)}, jeder
            Innenverteidiger {fmt(POSITIONS.IV.teamWeight)}, Außenverteidiger und Schienenspieler{' '}
            {fmt(POSITIONS.LV.teamWeight)}, Sechser {fmt(POSITIONS.DM.teamWeight)}, Zentrales Mittelfeld{' '}
            {fmt(POSITIONS.ZM.teamWeight)}, Zehner {fmt(POSITIONS.OM.teamWeight)}, Außenbahn und Flügel{' '}
            {fmt(POSITIONS.LF.teamWeight)}, Stürmer {fmt(POSITIONS.ST.teamWeight)}.
          </p>
          <p>
            Die Abwehrreihe zählt zusammen am meisten, der Torwart ist die wichtigste Einzelposition. Und: Die{' '}
            {SCORING.team.weakestCount} schwächsten Fits gehen zusätzlich mit doppeltem Gewicht ein. Ein Loch zieht
            stärker runter, als ein Star hebt.
          </p>
          <p>
            In der Saison trifft deine Elf auf {SEASON.opponents} Gegner mit Ratings von {SEASON.minRating} bis{' '}
            {SEASON.maxRating}. Tore fallen zufällig (Poisson), aber je größer der Abstand der Ratings, desto klarer die
            Sache.
          </p>
        </section>
        <section className="card prose">
          <h2 className="section-title">Größe und Gewicht</h2>
          <p>
            Größe zählt nur, wo es in der Tabelle steht – vor allem im Tor und in der Innenverteidigung. Ab{' '}
            {fmt(SCORING.height.cap)} m gibt es keinen Bonus mehr: Ein 14-Meter-Wailord fängt nicht mehr Bälle als ein
            2,2-Meter-Keeper.
          </p>
          <p>
            Gewicht wirkt logarithmisch: Jede Verdopplung bringt gleich viel – von 25 auf 50 kg zählt so viel wie von
            200 auf 400 kg. Bei etwa {fmt(SCORING.weight.capKg)} kg ist Schluss.
          </p>
        </section>
        <section className="card prose">
          <h2 className="section-title">Die Spezialwerte</h2>
          <p>
            <strong>Sp.-Angriff</strong> steht für Passspiel und Technik – darum ist er im zentralen Mittelfeld und auf
            der Zehn der Schlüsselwert. Stürmer brauchen ihn für den Abschluss.
          </p>
          <p>
            <strong>Sp.-Verteidigung</strong> steht für Spielübersicht und Ruhe am Ball. Beim Torwart heißt das:
            Reflexe und Nerven – dort ist sie Schlüssel.
          </p>
        </section>
        <section className="card prose">
          <h2 className="section-title">Typen</h2>
          <p>
            Jede Position hat Lieblingstypen: Gestein und Stahl in der Abwehr, Elektro, Unlicht und Flug auf den Flügeln,
            Feuer, Eis und Drache im Sturm. Der erste gelistete Typ gibt +3 %, die weiteren +2 % bzw. +1 %. Jeder der 18
            Typen hat genau zwei Lieblingspositionen – kein Typ ist bevorzugt. Das ist ein Tie-Breaker – kein Grund,
            einen schwachen Spieler aufzustellen.
          </p>
        </section>
      </div>

      <section className="card faq" aria-labelledby="faq-title">
        <h2 id="faq-title" className="section-title">
          FAQ
        </h2>
        {FAQ.map((f) => (
          <details key={f.q} className="faq__item">
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
