<!-- Heybe: Open-Source-KI-Assistent für den Mac / lokaler KI-Agent -->
<p align="center">
  <a href="https://heybe.dev"><img src="docs/images/social-preview.png" alt="Heybe: persönlicher Open-Source-KI-Assistent, der lokal auf deinem Mac läuft" width="760"></a>
</p>

<h1 align="center">Heybe: persönlicher Open-Source-KI-Assistent für den Mac</h1>

<p align="center"><b>Einmal sagen. Heybe erledigt den Rest.</b><br>
Ein lokaler KI-Agent, der auf deinem eigenen Rechner läuft, in einer Sandbox arbeitet und vor wichtigen Aktionen nachfragt.<br>
Standardmäßig mit DeepSeek, oder mit deinem eigenen OpenAI- oder Claude-API-Schlüssel.</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <a href="https://github.com/Slovian42/Heybe/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/Slovian42/Heybe/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Platform: macOS (Apple Silicon)" src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Apple%20Silicon-black">
  <img alt="Status: developer preview in development" src="https://img.shields.io/badge/status-developer%20preview%20in%20development-orange">
  <a href="CONTRIBUTING.md"><img alt="DCO sign-off required" src="https://img.shields.io/badge/DCO-sign--off-green"></a>
  <a href="https://heybe.dev"><img alt="Website: heybe.dev" src="https://img.shields.io/badge/web-heybe.dev-E8453C"></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.pt-BR.md">Português (Brasil)</a> ·
  <b>Deutsch</b> ·
  <a href="README.fr.md">Français</a>
</p>

> [!IMPORTANT]
> **Status: Die Developer Preview ist in Entwicklung. Es gibt noch keinen Download.** Die Screenshots sind Design-Entwürfe mit Beispielinhalten.
> Trag dich auf **[heybe.dev](https://heybe.dev)** in die Warteliste ein oder probier den [klickbaren Prototyp](https://heybe.dev/demo).

## Was ist Heybe?

Heybe ist ein **privater KI-Assistent, der auf deinem Computer läuft**. Du sagst in normalen Worten, was du brauchst. Heybe plant die Schritte, recherchiert im Web, schreibt den Bericht oder Entwurf und speichert das Ergebnis als Datei auf deinem Mac. Auch wenn du das Fenster schließt, arbeitet er weiter.

Gedacht für Menschen ohne Erfahrung mit KI-Agenten und für Solo-Gründer und Entwickler, die einen **selbst gehosteten KI-Assistenten** wollen, den sie prüfen und anpassen können:

- **Läuft auf deinem Mac.** Dateien, Aufgaben und Verlauf bleiben auf deinem Gerät.
- **Geschützter Bereich.** Jede Aktion läuft standardmäßig in einer isolierten Sandbox, getrennt von deinen persönlichen Dateien.
- **Fragt vorher.** Dateien löschen, außerhalb des eigenen Ordners schreiben oder das Budget überschreiten braucht deinen Klick. "Ja" im Chat zählt nicht.
- **Du wählst die KI.** Standard ist DeepSeek; eigener OpenAI- oder Anthropic-Claude-Schlüssel; oder ein lokales Modell mit Ollama für Offline-Chat.
- **Open Source.** Die Community Edition steht unter Apache-2.0, ganz ohne Konto bei uns.

## Screenshots (Design-Vorschau)

> Entwürfe für v1 mit Beispielinhalten; die echte App kann anders aussehen.

<p align="center">
  <img src="docs/images/heybe-screens-overview.png" alt="Übersicht der Heybe-Desktop-App: Einrichtung, Chat, Aufgabenfortschritt, Freigabe, Ergebnisbericht und Einstellungen" width="900">
</p>

| | |
|---|---|
| <img src="docs/images/heybe-onboarding-choose-ai-model.png" alt="Heybe-Einrichtung: DeepSeek, eigener OpenAI- oder Claude-API-Schlüssel oder lokales Modell auf dem Mac wählen" width="420"><br>**1. Erster Start:** wählen, woher die KI kommt. | <img src="docs/images/heybe-chat-plan.png" alt="Heybe-Chat: der lokale KI-Assistent macht aus einem Satz einen Schritt-für-Schritt-Plan" width="420"><br>**2. Chat:** einmal sagen, Plan bekommen. |
| <img src="docs/images/heybe-task-progress-sandbox.png" alt="Heybe-Aufgabenfortschritt: jeder Schritt läuft in der Sandbox, mit Stopp-Knopf und bisherigen Kosten" width="420"><br>**3. Aufgabe läuft:** Live-Schritte, Sandbox-Hinweis, Stopp, Kosten. | <img src="docs/images/heybe-action-approval.png" alt="Heybe-Freigabedialog: der KI-Agent fragt vor dem Löschen von Dateien, mit Ablehnen, Bearbeiten und Freigeben" width="420"><br>**4. Freigabe:** sensible Aktionen warten auf deinen Klick. |
| <img src="docs/images/heybe-task-result-report.png" alt="Heybe-Ergebnis: Vergleichstabelle und Empfehlung mit Quellen, als lokale Datei gespeichert" width="420"><br>**5. Ergebnis:** Bericht mit Quellen in deinem Heybe-Ordner. | <img src="docs/images/heybe-settings-api-keys.png" alt="Heybe-Einstellungen: KI-Anbieter und API-Schlüssel, Sandbox immer an, Telegram folgt" width="420"><br>**6. Einstellungen:** KI und Schlüssel, Sicherheitsregeln, Chat-Apps (bald). |

## Was kann Heybe?

| Du sagst | Heybe macht |
|---|---|
| "Vergleich diese fünf Notiz-Apps für mich." | Besucht jede Website und erstellt eine Tabelle mit Quellen und Empfehlung. |
| "Mach aus diesen Meeting-Notizen ein Wochen-Update." | Fasst Entscheidungen, To-dos und Zuständige in einem Entwurf zusammen. |
| "Fass diesen Artikel und die drei verlinkten zusammen." | Liest die Seiten und schreibt ein kurzes Briefing mit Links. |
| "Räum meinen Entwürfe-Ordner auf." | Findet alte Kopien und fragt, bevor etwas in den Papierkorb geht. |
| "Fass die Website-Zahlen dieser Woche zusammen." *(Solo-Gründer)* | Kurzer Rückblick plus Ideen für nächste Woche. |

Mehr in [docs/use-cases.md](docs/use-cases.md) (Englisch). Nach der ersten Preview geplant: tägliches Morgen-Briefing, Preisalarme und Chatten mit Heybe über **Telegram** und andere Messenger.

## Funktionen und Stand

| Funktion | Stand |
|---|---|
| macOS-Desktop-App (Tauri + React), zuerst Apple Silicon | In Entwicklung |
| Streaming-Chat mit DeepSeek (Standard), OpenAI, Claude (eigener Schlüssel) | In Entwicklung |
| Lokale Modelle über Ollama (nur Chat, offline) | In Entwicklung |
| Websuche durch direktes Lesen der Seiten, mit Quellen | In Entwicklung |
| Lange Aufgaben, die nach dem Schließen weiterlaufen (lokaler Task-Manager, SQLite) | Grundgerüst gemergt |
| Sandbox standardmäßig an: eine Micro-VM pro Sitzung (BoxLite; Alternative Lima) | Proof of Concept |
| Freigabe per Klick, Kosten und Modell bei jeder Aufgabe sichtbar | In Entwicklung |
| Signierte, notarisierte DMG über heybe.dev (kein Mac App Store) | Geplant |
| Langzeitgedächtnis, das du sehen, ändern und löschen kannst | v1.1 |
| Telegram und andere Chat-Apps | Geplant |
| Dynamische Agenten-Teams | Heybe Pro (später) |

## Vergleich mit ähnlichen Produkten

Eine faire Zusammenfassung öffentlicher Informationen, Stand Oktober 2026. Produkte ändern sich schnell; bitte die offiziellen Dokumentationen prüfen.

| | Läuft wo | Quellcode | Modelle | Sicherheit | Chat-Apps |
|---|---|---|---|---|---|
| **Heybe** (in Entwicklung) | Dein Mac | Open Source (Apache-2.0); Pro später | DeepSeek, OpenAI, Claude (eigener Schlüssel), Ollama | Sandbox standardmäßig + Freigabe per Klick | Telegram geplant |
| [ChatGPT](https://chatgpt.com) (Work / Cloud-Browser) | OpenAI-Cloud; Desktop- und Mobil-Apps | Proprietär | OpenAI | Fragt vor neuen Websites und folgenreichen Aktionen | — |
| [Claude](https://claude.com) Desktop (Cowork) | Desktop-App (macOS, Windows); Code läuft in lokaler VM; auch Cloud-Sitzungen | Proprietär | Claude | Nur freigegebene Ordner; fragt vor sensiblen Aktionen | — |
| [Manus](https://manus.im) | Cloud-Agent; Desktop-App arbeitet in freigegebenen Ordnern | Proprietär | Von Manus verwaltet | Freigabe für jeden lokalen Befehl | — |
| [OpenClaw](https://github.com/openclaw/openclaw) | Dein Rechner oder Server (macOS, Windows, Linux) | Open Source (MIT) | Cloud oder lokal | Optionale Sandbox (z. B. Docker) | Über 20 |
| [FastClaw](https://github.com/fastclaw-ai/fastclaw) | Selbst gehostete Multi-Agent-Runtime | Source-available (FastClaw Community License) | Cloud oder lokal | Mehrere Sandbox-Backends | Mehrere |
| [Open Interpreter](https://github.com/openinterpreter/openinterpreter) | Dein Terminal | Open Source (Apache-2.0) | Cloud oder lokal | Fragt vor dem Ausführen von Code | — |
| [Jan](https://jan.ai) | Desktop-App | Open Source (Apache-2.0) | Lokal (llama.cpp) und Cloud-APIs | Chat-zentriert; Tools mit Freigabe | — |
| [LM Studio](https://lmstudio.ai) | Desktop-App | Proprietär, kostenlos privat und beruflich | Lokale Modelle | Chat-zentriert | — |

**Warum Heybe?** Wenn du eine **Manus-Alternative** oder **ChatGPT-Agent-Alternative** suchst, die auf deinem Mac läuft, Open Source ist, deinen eigenen API-Schlüssel nutzt und Sandbox plus Freigabe-Klick zwischen KI und deine Dateien setzt.
**Warum (noch) nicht?** Heybe ist noch nicht veröffentlicht; die Tools oben sind ausgereift.

Heybe läuft über die `/v1`-API von FastClaw, das nicht Teil dieses Repositorys ist (siehe [NOTICE](NOTICE)). Alle Marken gehören ihren jeweiligen Inhabern; Heybe ist mit keinem von ihnen verbunden oder von ihnen unterstützt.

## Datenschutz und Sicherheit

Das sind die Designregeln für v1; jede wird vor der Preview getestet.

- **Lokal als Standard.** Aufgaben, Dateien und Verlauf liegen auf deinem Mac. Prompts gehen nur an den KI-Anbieter deiner Wahl, mit lokalem Modell nirgendwohin.
- **Deine Schlüssel gehören dir.** Gespeichert im macOS-Schlüsselbund, nie im Repository, in Logs oder Exporten.
- **Sandbox immer an.** v1 hat keinen Modus zum Abschalten.
- **Freigabe per Klick, nicht per Text.** Du siehst, was passiert und ob es rückgängig gemacht werden kann; ohne Klick passiert nichts.
- **Ehrliche Ergebnisse.** Ein Fehler wird als Fehler angezeigt, nie als erledigt.

## Roadmap

| Phase | Was | Stand |
|---|---|---|
| 0 | Repository, FastClaw-`/v1`-Adapter, Sandbox-Test | Läuft |
| 1 | Desktop-Chat, Anbieter und Schlüssel, Web-Lesen, Aufgaben | Läuft |
| v1 Developer Preview | Aus dem Quellcode bauen auf macOS (Apple Silicon) | Noch nicht verfügbar |
| v1.1 | Langzeitgedächtnis | Geplant |
| Später | Telegram und Messenger, Zeitpläne, Agenten-Teams, signierte DMG | Geplant |

## Schnellstart für Entwickler

Heute funktionieren der TypeScript-Workspace (Adapter, Task-Manager, Platzhalter-Oberfläche) und die Tests. Eine komplette App gibt es noch nicht.

```bash
# Benötigt Node 20+ und pnpm 10 (corepack enable)
git clone https://github.com/Slovian42/Heybe.git && cd Heybe
pnpm install
pnpm lint      # eslint + Grenzprüfungen + TypeScript
pnpm test      # vitest
pnpm --filter @heybe/desktop dev   # Platzhalter-UI unter http://localhost:1420
```

FastClaw und Sandbox: [docs/phase0-dev-env.md](docs/phase0-dev-env.md), [docs/sandbox-options.md](docs/sandbox-options.md). Niemals echte Schlüssel in Dateien schreiben (`.env` wird von git ignoriert).

## Häufige Fragen

<details><summary><b>Gibt es einen Open-Source-KI-Assistenten, der lokal auf dem Mac läuft?</b></summary>
Genau dafür wird Heybe gebaut: Apache-2.0, auf deinem Mac, Sandbox standardmäßig an. Noch in Entwicklung und nicht zum Download verfügbar.</details>

<details><summary><b>Ist Heybe eine kostenlose Manus-Alternative?</b></summary>
Die Community Edition ist kostenlos und Open Source, und die Arbeit passiert auf deinem Computer. Du zahlst nur deinen KI-Anbieter (z. B. DeepSeek), mit lokalem Modell gar nichts.</details>

<details><summary><b>Kann ich meinen eigenen OpenAI- oder Claude-API-Schlüssel nutzen?</b></summary>
Ja. Standard ist DeepSeek; du kannst deinen OpenAI- oder Anthropic-Claude-Schlüssel mitbringen. Er liegt im macOS-Schlüsselbund.</details>

<details><summary><b>Funktioniert Heybe offline mit lokalen Modellen?</b></summary>
Offline-Chat über Ollama ist für v1 geplant. Tool-Nutzung mit lokalen Modellen wird nicht versprochen.</details>

<details><summary><b>Kann ich Heybe über Telegram nutzen? Und unter Windows?</b></summary>
Telegram und andere Messenger kommen nach der ersten Preview. v1 gibt es nur für den Mac.</details>

## Community und Pro

| | Heybe Community | Heybe Pro (später) |
|---|---|---|
| Lizenz | Apache-2.0, dieses Repository | Proprietär, Slovian Inc |
| Assistent, Aufgaben, Sandbox, Freigaben, eigener Schlüssel | ✓ | ✓ |
| Agenten-Teams, die sich für jede Aufgabe selbst zusammenstellen | — | ✓ |
| Preis | Kostenlos | Noch nicht bekannt |

## Mitmachen

Beiträge sind willkommen. Bitte [CONTRIBUTING.md](CONTRIBUTING.md) lesen. Jeder Commit braucht ein DCO-Sign-off (`git commit -s`); die CI prüft das. Zum Zitieren siehe [CITATION.cff](CITATION.cff).

## Lizenz

Unser eigener Code steht unter der [Apache License 2.0](LICENSE), Copyright 2026 Slovian Inc. Für FastClaw gilt separat die FastClaw Community License; siehe [NOTICE](NOTICE). Heybe ist nicht mit FastClaw, OpenAI, Anthropic, DeepSeek, Manus oder xAI verbunden.
