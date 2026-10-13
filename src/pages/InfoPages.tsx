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
        <p>
          Kurz gesagt: Diese App kommt ohne Konto aus und setzt keine Tracking-Cookies. Nur für die Online-Rangliste und
          Online-Ligen speichert der Server das Nötigste – mehr dazu unten.
        </p>
        <h2 className="section-title">Lokale Speicherung</h2>
        <p>
          Deine Aufstellung, Einstellungen, Bestwerte, laufende Runs, die lokale Rangliste, die Online-Ligen,
          in denen du mitspielst (Code, Liga- und Teamname), und die zufällige Geräte-Kennung für die Online-Rangliste
          und Online-Ligen werden im localStorage deines Browsers gespeichert. Du kannst sie
          jederzeit über die Browser-Einstellungen löschen – dann gilt dein Browser als neues Gerät.
        </p>
        <h2 className="section-title">Online-Rangliste</h2>
        <p>
          Spielst du eine Challenge online, schickt die App deinen Run an unseren Server, damit er geprüft und gewertet
          werden kann. Gespeichert werden:
        </p>
        <ul>
          <li>eine zufällige Geräte-ID und ein Hash des Geräte-Schlüssels (der Schlüssel selbst bleibt auf deinem Gerät),</li>
          <li>dein gewählter Spielername und Teamname,</li>
          <li>deine Runs: Aufstellung, Züge, Team-Score, Bilanz und Zeitpunkt,</li>
          <li>
            zum Schutz vor Missbrauch (Begrenzung neuer Geräte pro Anschluss) ein Hash deiner IP-Adresse bei der ersten
            Anmeldung des Geräts, bei IPv6 nur des Netzpräfixes (/64). Der Hash ist mit einem geheimen Zufallswert
            gesalzen, wird nur eine Stunde lang gebraucht und danach beim nächsten Serverzugriff gelöscht; die
            IP-Adresse selbst wird nie gespeichert.
          </li>
        </ul>
        <p>
          Die Daten liegen in einer Cloudflare-D1-Datenbank. Spielername, Teamname und Ergebnisse sind in der Rangliste
          öffentlich sichtbar. Es gibt keine Konten, keine E-Mail-Adressen und keine Tracking-Cookies. Offline gespielte
          Runs verlassen dein Gerät nicht.
        </p>
        <h2 className="section-title">Online-Ligen (Fantasy-Draft)</h2>
        <p>
          Erstellst du eine Online-Liga oder trittst einer bei, speichert der Server für diese Liga: die Einstellungen
          und den optionalen Liganamen, die Teamnamen und Formationen, alle Picks mit Zeitpunkt sowie die zufällige
          Geräte-ID, die dein Team mit deinem Gerät verknüpft (wie bei der Rangliste nur mit dem Hash des
          Geräte-Schlüssels). Wer den Link oder Code einer Liga hat, sieht Teamnamen und Picks; öffentliche Lobbys
          erscheinen mit Liganame, Name des Host-Teams und Teamzahl in der Lobby-Liste. Ligen werden 14 Tage nach dem
          Erstellen automatisch gelöscht.
        </p>
        <p>
          Gegen Missbrauch zählt der Server neue Ligen pro Anschluss: Dafür speichert er beim Erstellen einen gesalzenen
          Hash deiner IP-Adresse (IPv6: Netzpräfix /64) zusammen mit der laufenden Stunde; nach Ablauf der Stunde wird er
          beim nächsten Erstellen einer Liga bzw. Abruf der Lobby-Liste gelöscht. Solange du mit einer Liga verbunden
          bist, kennt deren Server-Instanz außerdem deine IP-Adresse (für die Verbindungs-Limits) – sie hängt nur an der
          offenen Verbindung, landet in keiner Datenbank und ist mit dem Trennen weg.
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
