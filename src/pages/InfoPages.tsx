import { Link } from 'react-router-dom';

export function About() {
  return (
    <div className="page prose-page">
      <header className="page-head">
        <h1 className="page-title">Über &amp; Kontakt</h1>
      </header>
      <section className="card prose">
        <p>
          <strong>Pokémon Elf</strong> ist ein kostenloses Fan-Projekt: Stell aus Pokémon eine Startelf auf, lass sie
          nach Positions-Fit bewerten und spiel damit eine simulierte Saison. Die Idee ist von Aufstellungs-Spielen
          inspiriert – nur eben mit Fußball statt Football.
        </p>
        <p>
          Die Pokémon-Daten (Namen, Typen, Basiswerte, Größe, Gewicht) stammen von der freien{' '}
          <a href="https://pokeapi.co" target="_blank" rel="noreferrer">
            PokeAPI
          </a>
          , die Sprites aus dem PokeAPI-Sprite-Archiv.
        </p>
        <p>
          Wie bewertet wird, steht im <Link to="/scouting">Scouting-Guide</Link>.
        </p>
        <h2 className="section-title">Kontakt</h2>
        <p>
          Feedback, Fehler oder Ideen? Am besten als Issue im Repository des Projekts oder per E-Mail an die im
          Impressum des Betreibers genannte Adresse.
        </p>
        <p className="muted small">
          Nicht verbunden mit oder unterstützt von Nintendo, Game Freak, Creatures oder The Pokémon Company.
          Pokémon-Namen und -Artwork gehören ihren jeweiligen Eigentümern.
        </p>
      </section>
    </div>
  );
}

export function Privacy() {
  return (
    <div className="page prose-page">
      <header className="page-head">
        <h1 className="page-title">Datenschutz</h1>
      </header>
      <section className="card prose">
        <p>Kurz gesagt: Diese App sammelt keine personenbezogenen Daten und setzt keine Tracking-Cookies.</p>
        <h2 className="section-title">Lokale Speicherung</h2>
        <p>
          Deine Aufstellung, Einstellungen, Bestwerte, laufende Runs und die lokale Rangliste werden ausschließlich im
          localStorage deines Browsers gespeichert. Sie verlassen dein Gerät nicht. Du kannst sie jederzeit über die
          Browser-Einstellungen löschen.
        </p>
        <h2 className="section-title">Externe Inhalte</h2>
        <p>
          Pokémon-Bilder werden von <code>raw.githubusercontent.com</code> (PokeAPI-Sprites, GitHub) geladen,
          Schriftarten von Google Fonts. Dabei wird – wie bei jedem Bildabruf – deine IP-Adresse an diese Dienste
          übertragen.
        </p>
        <h2 className="section-title">Geteilte Links</h2>
        <p>
          „Link kopieren" kodiert Formation, Pokémon-Nummern, Einstellungen und den optionalen Teamnamen in die URL. Es
          wird nichts auf einem Server gespeichert.
        </p>
      </section>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="page prose-page">
      <section className="card prose empty">
        <h1 className="page-title">Abseits!</h1>
        <p>Diese Seite gibt es nicht.</p>
        <Link className="btn btn--primary" to="/">
          Zurück zum Builder
        </Link>
      </section>
    </div>
  );
}
