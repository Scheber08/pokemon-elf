/** Texte: info (Deutsch – Quelle). Die englische Fassung in ../en/info.ts muss dieselben Schlüssel haben. */
const info = {
  about: {
    title: 'Über & Kontakt',
    /** Folgt auf den fett gesetzten Namen „Pokémon Elf" */
    intro:
      ' ist ein kostenloses Fan-Projekt: Stell aus Pokémon eine Startelf auf, lass sie nach Positions-Fit bewerten und spiel damit eine simulierte Saison. Die Idee ist von Aufstellungs-Spielen inspiriert – nur eben mit Fußball statt Football.',
    /** Satz um den PokeAPI-Link: dataPre + Link + dataPost */
    dataPre: 'Die Pokémon-Daten (Namen, Typen, Basiswerte, Größe, Gewicht) stammen von der freien ',
    dataLink: 'PokeAPI',
    dataPost: ', die Sprites aus dem PokeAPI-Sprite-Archiv.',
    /** Satz um den Link zum Scouting-Guide: guidePre + Link + guidePost */
    guidePre: 'Wie bewertet wird, steht im ',
    guideLink: 'Scouting-Guide',
    guidePost: '.',
    /** „Was ist neu?" – die wichtigsten Neuerungen, neueste zuerst */
    newsTitle: 'Was ist neu?',
    news: [
      'Neu: Halbzeitstand im Spielbericht und in der 2D-Wiedergabe, Saisonrekord „Kaltschnäuzigste Mannschaft“, 🆕 in der Rangliste und dein Punkte-Abstand zur Top-Liste',
      'Challenges: „Letzter Run“ vor dem Start, Lieblings- und Angstgegner, Serien sowie Heim-/Auswärtsbilanz in der Saisonbilanz',
      'Tägliche Elf: „Top n %“ beim Platz und Archiv mit 🏅 und ▲/▼; Shop mit Sammelstand und neuen Saisons; Profil mit 🏅 an Bestwert-Runs',
      'Neu: Elf der Saison (auch als Bild), Heim- und Auswärtstabelle, Spieler des Spieltags und Last-Minute-Sieg im Ticker, farbige Tabellen-Zonen',
      'Manager-Saison: Heimrecht im Spielplan jetzt ausgeglichen (neue Saisons), Sterne für Spieler des Spieltags im Kader',
      'Online-Draft: Ø Fit je Team auf dem Board, Position und Fit im Verlauf samt „Run“-Hinweis, offene Positionen im Wartehinweis',
      'Saisonergebnis: Herbstmeister, bestes Team der Rückrunde, Überraschung/Enttäuschung, torreichstes Spiel und deine höchsten Siege/Niederlagen',
      'Manager-Saison: Formations-Tipp, beste Position der Bankspieler, Punkte-Hochrechnung und der gefährlichste Torschütze des nächsten Gegners',
      'Neu: Shinys im Draft – 2 % Chance je Pick (oder 10 % als „Shiny-Party“), je schwächer das Pokémon, desto größer der Team-Bonus',
      'Neu: Kapitän in allen Modi – seine Passung zählt doppelt, „Beste Wahl“ sucht ihn aus, im Online-Draft automatisch und bis zum Anpfiff wechselbar',
      'Neu: Trikotnummern, Trikotfarben, Torjubel und Vereinswappen für dein Team',
      'Manager-Saison: Verletzungen und Sperren, Pokal, Karriere mit Auf- und Abstieg, Live-Spieltag, Tore und Vorlagen je Pokémon',
      'Online-Draft: Wunschliste mit Taste W, „Mit CPU auffüllen“, alle Picks im Ergebnis und Vibration bei knapper Pick-Zeit',
      'Neu: eigener Menüpunkt „Manager“ und Spielwiedergabe (2D/Bericht) in jedem Modus – einstellbar oder aus',
      'Neu: Gestalte deinen eigenen Trainer – Münzen aus Erfolgen kaufen Kappen, Trikots, Hintergründe und Begleiter-Pokémon',
      'Online-Draft: Manager-Saison – Bank mitdraften, vor jedem Spieltag die Elf aufstellen, Tagesform je Pokémon, Transfermarkt',
      'Builder: „Meine Teams“ – bis zu fünf Elfen speichern und laden',
      'Online-Draft: Formkurve, Saisonrekorde, Saisonverlauf, Überraschung des Spieltags, Torjäger live und Hinweis zum Saisonende',
      'Online-Draft: Liga immer mit 18 Teams – aufgefüllt mit Teams echter Spieler aus der Rangliste',
      'Online-Draft: KO-Turnier als Spielmodus, optional mit Gruppenphase',
      'Online-Draft: realistischere Saison mit Tagesform und Torminuten im Ticker',
      'Online-Draft: Ultrabestien, Megas und Formen – je mit eigenem Limit pro Team',
      'Online-Draft: Revanche mit ewiger Tabelle, Wunschliste für Auto-Picks, Emoji-Reaktionen und QR-Code zum Beitreten',
      'Online-Draft: Draft-Noten, Schnäppchen des Drafts, „Deine Duelle“ und Toptorjäger je Team im Ergebnis',
      'Rangliste: Wochenwertung, Teams ansehen, Testspiel gegen deine Elf und Spielerprofile mit Allzeit-Platz',
      'Tägliche Elf: Serie und Archiv der letzten Tage',
      'Builder: Megas und Formen, „Beste Elf“, Sortierung nach Positions-Fit, Rückgängig und Wiederholen',
      'Installierbar als App (PWA) und Link-Vorschauen für Ligen und Profile',
    ],
    contactTitle: 'Kontakt',
    contact:
      'Feedback, Fehler oder Ideen? Am besten als Issue im Repository des Projekts oder per E-Mail an die im Impressum des Betreibers genannte Adresse.',
    disclaimer:
      'Nicht verbunden mit oder unterstützt von Nintendo, Game Freak, Creatures oder The Pokémon Company. Pokémon-Namen und -Artwork gehören ihren jeweiligen Eigentümern.',
  },
  privacy: {
    title: 'Datenschutz',
    intro:
      'Kurz gesagt: Diese App kommt ohne Konto aus und setzt keine Tracking-Cookies. Nur für die Online-Rangliste und Online-Ligen speichert der Server das Nötigste – mehr dazu unten.',
    localTitle: 'Lokale Speicherung',
    local:
      'Deine Aufstellung, Einstellungen, Bestwerte, laufende Runs, die lokale Rangliste, die Online-Ligen, in denen du mitspielst (Code, Liga- und Teamname), und die zufällige Geräte-Kennung für die Online-Rangliste und Online-Ligen werden im localStorage deines Browsers gespeichert. Du kannst sie jederzeit über die Browser-Einstellungen löschen – dann gilt dein Browser als neues Gerät.',
    usage: (entries: number, kb: number) => `Auf diesem Gerät gerade: ${entries} ${entries === 1 ? 'Eintrag' : 'Einträge'}, etwa ${kb} KB.`,
    leaderboardTitle: 'Online-Rangliste',
    leaderboardIntro:
      'Spielst du eine Challenge online, schickt die App deinen Run an unseren Server, damit er geprüft und gewertet werden kann. Gespeichert werden:',
    leaderboardItems: [
      'eine zufällige Geräte-ID und ein Hash des Geräte-Schlüssels (der Schlüssel selbst bleibt auf deinem Gerät),',
      'dein gewählter Spielername und Teamname,',
      'deine Runs: Aufstellung, Züge, Team-Score, Bilanz und Zeitpunkt,',
      'zum Schutz vor Missbrauch (Begrenzung neuer Geräte pro Anschluss) ein Hash deiner IP-Adresse bei der ersten Anmeldung des Geräts, bei IPv6 nur des Netzpräfixes (/64). Der Hash ist mit einem geheimen Zufallswert gesalzen, wird nur eine Stunde lang gebraucht und danach beim nächsten Serverzugriff gelöscht; die IP-Adresse selbst wird nie gespeichert.',
    ] as string[],
    leaderboardStorage:
      'Die Daten liegen in einer Cloudflare-D1-Datenbank. Spielername, Teamname und Ergebnisse sind in der Rangliste öffentlich sichtbar. Es gibt keine Konten, keine E-Mail-Adressen und keine Tracking-Cookies. Offline gespielte Runs verlassen dein Gerät nicht.',
    leaguesTitle: 'Online-Ligen (Fantasy-Draft)',
    leagues:
      'Erstellst du eine Online-Liga oder trittst einer bei, speichert der Server für diese Liga: die Einstellungen und den optionalen Liganamen, die Teamnamen und Formationen, alle Picks mit Zeitpunkt sowie die zufällige Geräte-ID, die dein Team mit deinem Gerät verknüpft (wie bei der Rangliste nur mit dem Hash des Geräte-Schlüssels). Wer den Link oder Code einer Liga hat, sieht Teamnamen und Picks; öffentliche Lobbys erscheinen mit Liganame, Name des Host-Teams und Teamzahl in der Lobby-Liste. Ligen werden 14 Tage nach dem Erstellen automatisch gelöscht.',
    leaguesAbuse:
      'Gegen Missbrauch zählt der Server neue Ligen pro Anschluss: Dafür speichert er beim Erstellen einen gesalzenen Hash deiner IP-Adresse (IPv6: Netzpräfix /64) zusammen mit der laufenden Stunde; nach Ablauf der Stunde wird er beim nächsten Erstellen einer Liga bzw. Abruf der Lobby-Liste gelöscht. Solange du mit einer Liga verbunden bist, kennt deren Server-Instanz außerdem deine IP-Adresse (für die Verbindungs-Limits) – sie hängt nur an der offenen Verbindung, landet in keiner Datenbank und ist mit dem Trennen weg.',
    externalTitle: 'Externe Inhalte',
    /** Satz um den Hostnamen (Code): externalPre + raw.githubusercontent.com + externalPost */
    externalPre: 'Pokémon-Bilder werden von ',
    externalPost:
      ' (PokeAPI-Sprites, GitHub) geladen, Schriftarten von Google Fonts. Dabei wird – wie bei jedem Bildabruf – deine IP-Adresse an diese Dienste übertragen.',
    sharedTitle: 'Geteilte Links',
    shared:
      '„Link kopieren" kodiert Formation, Pokémon-Nummern, Einstellungen und den optionalen Teamnamen in die URL. Es wird nichts auf einem Server gespeichert.',
  },
  notFound: {
    title: 'Abseits!',
    text: 'Diese Seite gibt es nicht.',
    back: 'Zurück zum Builder',
    or: 'Oder direkt weiter zu:',
  },
};

export default info;
