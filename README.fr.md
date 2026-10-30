<!-- Heybe : assistant IA personnel open source pour Mac / agent IA local -->
<p align="center">
  <a href="https://heybe.dev"><img src="docs/images/social-preview.png" alt="Heybe : assistant IA personnel open source qui fonctionne en local sur votre Mac" width="760"></a>
</p>

<h1 align="center">Heybe : assistant IA personnel open source pour Mac</h1>

<p align="center"><b>Dites-le une fois. Heybe s'occupe du reste.</b><br>
Un agent IA local qui tourne sur votre propre ordinateur, travaille dans un bac à sable (sandbox) et vous demande avant d'agir.<br>
DeepSeek par défaut, ou votre propre clé d'API OpenAI ou Claude.</p>

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
  <a href="README.de.md">Deutsch</a> ·
  <b>Français</b>
</p>

> [!IMPORTANT]
> **Statut : la préversion pour développeurs est en cours de développement. Pas encore de téléchargement.** Les captures sont des maquettes avec des données d'exemple.
> Inscrivez-vous à la liste d'attente sur **[heybe.dev](https://heybe.dev)** ou essayez le [prototype cliquable](https://heybe.dev/demo).

## Qu'est-ce que Heybe ?

Heybe est un **assistant IA privé qui tourne sur votre ordinateur**. Vous lui demandez quelque chose avec vos mots, comme à un ami. Il planifie les étapes, cherche sur le web, rédige le rapport ou le brouillon et enregistre le résultat dans un fichier sur votre Mac. Il continue même si vous fermez la fenêtre.

Conçu pour celles et ceux qui n'ont jamais utilisé d'« agent IA », et pour les indépendants et développeurs qui veulent un **assistant IA auto-hébergé** qu'ils peuvent inspecter et modifier :

- **Tourne sur votre Mac.** Fichiers, tâches et historique restent sur votre machine.
- **Espace sécurisé.** Chaque action s'exécute par défaut dans une sandbox isolée, loin de vos fichiers personnels.
- **Demande avant d'agir.** Supprimer des fichiers, écrire hors de son dossier ou dépasser le budget exige votre clic. Taper « oui » dans le chat ne compte pas.
- **Vous choisissez l'IA.** DeepSeek par défaut ; votre clé OpenAI ou Anthropic Claude ; ou un modèle local avec Ollama pour discuter hors ligne.
- **Open source.** L'édition Community est sous Apache-2.0, sans compte chez nous.

## Captures d'écran (aperçu du design)

> Maquettes de la v1 avec contenu d'exemple ; l'application réelle peut différer.

<p align="center">
  <img src="docs/images/heybe-screens-overview.png" alt="Écrans de l'application Heybe pour Mac : accueil, chat, progression, validation d'action, rapport et réglages" width="900">
</p>

| | |
|---|---|
| <img src="docs/images/heybe-onboarding-choose-ai-model.png" alt="Accueil Heybe : choisir DeepSeek, sa propre clé d'API OpenAI ou Claude, ou un modèle local sur le Mac" width="420"><br>**1. Premier lancement :** choisir d'où vient l'IA. | <img src="docs/images/heybe-chat-plan.png" alt="Chat Heybe : l'assistant IA local transforme une phrase en plan étape par étape" width="420"><br>**2. Chat :** dites-le une fois, obtenez un plan. |
| <img src="docs/images/heybe-task-progress-sandbox.png" alt="Progression Heybe : chaque étape s'exécute dans une sandbox, avec bouton Arrêter et coût" width="420"><br>**3. Tâche en cours :** étapes en direct, espace sécurisé, Arrêter, coût. | <img src="docs/images/heybe-action-approval.png" alt="Validation Heybe : l'agent IA demande avant de supprimer des fichiers, avec Refuser, Modifier et Approuver" width="420"><br>**4. Validation :** les actions sensibles attendent votre clic. |
| <img src="docs/images/heybe-task-result-report.png" alt="Résultat Heybe : tableau comparatif et recommandation avec sources, enregistrés en fichier local" width="420"><br>**5. Résultat :** rapport sourcé dans votre dossier Heybe. | <img src="docs/images/heybe-settings-api-keys.png" alt="Réglages Heybe : fournisseurs d'IA et clés d'API, sandbox toujours active, Telegram bientôt" width="420"><br>**6. Réglages :** IA et clés, règles de sécurité, messageries (bientôt). |

## Que peut faire Heybe ?

| Vous dites | Heybe fait |
|---|---|
| « Compare ces cinq applis de notes. » | Visite chaque site et produit un tableau sourcé avec une recommandation. |
| « Transforme ces notes de réunion en point hebdo. » | Extrait décisions, actions et responsables dans un brouillon. |
| « Résume cet article et les trois qu'il cite. » | Lit les pages et rédige une synthèse avec liens. |
| « Range mon dossier Brouillons. » | Trouve les vieilles copies et demande avant de les mettre à la corbeille. |
| « Fais le bilan des stats de mon site cette semaine. » *(indépendants)* | Un court bilan et des idées pour la semaine suivante. |

Plus d'exemples dans [docs/use-cases.md](docs/use-cases.md) (en anglais). Après la première préversion : briefing matinal programmé, alertes de prix et discussion avec Heybe depuis **Telegram** et d'autres messageries.

## Fonctionnalités et avancement

| Fonctionnalité | Statut |
|---|---|
| Application macOS (Tauri + React), Apple Silicon uniquement (M1 ou plus récent) | En développement |
| Chat en streaming avec DeepSeek (par défaut), OpenAI, Claude (votre clé) | En développement |
| Modèles locaux via Ollama (chat uniquement, hors ligne) | En développement |
| Recherche web en lisant directement les pages, avec sources | En développement |
| Tâches longues qui continuent fenêtre fermée (gestionnaire local, SQLite) | Socle fusionné |
| Sandbox par défaut : une micro-VM par session (BoxLite ; repli Lima) | Preuve de concept |
| Validation par clic, coût et modèle affichés pour chaque tâche | En développement |
| DMG signé et notarié sur heybe.dev, Apple Silicon uniquement (pas de version Intel, pas de Mac App Store) | Prévu |
| Mémoire à long terme consultable, modifiable et supprimable | v1.1 |
| Telegram et autres messageries | Prévu |
| Équipes d'agents dynamiques | Heybe Pro (plus tard) |

## Comparaison avec des produits similaires

Résumé de bonne foi d'informations publiques, octobre 2026. Les produits évoluent vite ; consultez leur documentation officielle.

| | Où ça tourne | Code | Modèles | Sécurité | Messageries |
|---|---|---|---|---|---|
| **Heybe** (en développement) | Votre Mac | Open source (Apache-2.0) ; Pro plus tard | DeepSeek, OpenAI, Claude (votre clé), Ollama | Sandbox par défaut + validation par clic | Telegram prévu |
| [ChatGPT](https://chatgpt.com) (Work / navigateur cloud) | Cloud d'OpenAI ; applis bureau et mobile | Propriétaire | OpenAI | Demande avant les nouveaux sites et les actions importantes | — |
| [Claude](https://claude.com) desktop (Cowork) | Appli bureau (macOS, Windows) ; code dans une VM locale ; sessions cloud aussi | Propriétaire | Claude | Dossiers autorisés seulement ; confirme les actions sensibles | — |
| [Manus](https://manus.im) | Agent cloud ; l'appli bureau travaille dans les dossiers approuvés | Propriétaire | Gérés par Manus | Validation de chaque commande locale | — |
| [OpenClaw](https://github.com/openclaw/openclaw) | Votre machine ou serveur (macOS, Windows, Linux) | Open source (MIT) | Cloud ou locaux | Sandbox optionnelle (ex. Docker) | Plus de 20 |
| [FastClaw](https://github.com/fastclaw-ai/fastclaw) | Runtime multi-agents auto-hébergé | Source disponible (FastClaw Community License) | Cloud ou locaux | Plusieurs backends de sandbox | Plusieurs |
| [Open Interpreter](https://github.com/openinterpreter/openinterpreter) | Votre terminal | Open source (Apache-2.0) | Cloud ou locaux | Demande avant d'exécuter du code | — |
| [Jan](https://jan.ai) | Appli bureau | Open source (Apache-2.0) | Locaux (llama.cpp) et API cloud | Centré sur le chat ; outils soumis à validation | — |
| [LM Studio](https://lmstudio.ai) | Appli bureau | Propriétaire, gratuit perso et pro | Modèles locaux | Centré sur le chat | — |

**Pourquoi Heybe ?** Si vous cherchez une **alternative à Manus** ou à **ChatGPT agent** qui tourne sur votre Mac, est open source, accepte votre propre clé d'API et place une sandbox et un clic de validation entre l'IA et vos fichiers.
**Pourquoi pas encore ?** Heybe n'est pas encore sorti ; les outils ci-dessus sont déjà matures.

Heybe s'appuie sur l'API `/v1` de FastClaw, qui ne fait pas partie de ce dépôt (voir [NOTICE](NOTICE)). Toutes les marques appartiennent à leurs propriétaires ; Heybe n'est ni affilié ni soutenu par eux.

## Confidentialité et sécurité

Ce sont les règles de conception de la v1 ; chacune sera testée avant la préversion.

- **Local par défaut.** Tâches, fichiers et historique restent sur votre Mac. Les prompts ne partent que chez le fournisseur d'IA choisi, ou nulle part avec un modèle local.
- **Vos clés restent à vous.** Stockées dans le trousseau macOS, jamais dans le dépôt, les journaux ou les exports.
- **Sandbox toujours active.** La v1 n'a pas de mode pour la désactiver.
- **Validation par clic, pas par texte.** Vous voyez ce qui va se passer et si c'est réversible ; rien ne se passe sans votre clic.
- **Résultats honnêtes.** Un échec s'affiche comme un échec, jamais comme terminé.

## Feuille de route

| Étape | Contenu | Statut |
|---|---|---|
| 0 | Dépôt, adaptateur `/v1` FastClaw, test de la sandbox | En cours |
| 1 | Chat bureau, fournisseurs et clés, lecture web, tâches | En cours |
| Préversion v1 | Compiler depuis les sources sur macOS (Apple Silicon) | Pas encore disponible |
| v1.1 | Mémoire à long terme | Prévu |
| Ensuite | Telegram et messageries, tâches planifiées, équipes d'agents, DMG signé | Prévu |

## Démarrage rapide pour développeurs

Aujourd'hui fonctionnent l'espace de travail TypeScript (adaptateur, gestionnaire de tâches, interface provisoire) et ses tests. Il n'y a pas encore d'application complète.

```bash
# Nécessite Node 20+ et pnpm 10 (corepack enable)
git clone https://github.com/Slovian42/Heybe.git && cd Heybe
pnpm install
pnpm lint      # eslint + contrôles de frontières + TypeScript
pnpm test      # vitest
pnpm --filter @heybe/desktop dev   # interface provisoire sur http://localhost:1420
```

FastClaw et sandbox : [docs/phase0-dev-env.md](docs/phase0-dev-env.md), [docs/sandbox-options.md](docs/sandbox-options.md). Ne mettez jamais de vraies clés dans des fichiers (`.env` est ignoré par git).

## Questions fréquentes

<details><summary><b>Existe-t-il un assistant IA open source qui tourne en local sur Mac ?</b></summary>
Heybe est conçu pour ça : Apache-2.0, sur votre Mac, sandbox activée par défaut. En développement, pas encore téléchargeable.</details>

<details><summary><b>Heybe est-il une alternative gratuite à Manus ?</b></summary>
L'édition Community est gratuite et open source, et le travail se fait sur votre ordinateur. Vous ne payez que votre fournisseur d'IA (par exemple DeepSeek), ou rien avec un modèle local.</details>

<details><summary><b>Puis-je utiliser ma propre clé d'API OpenAI ou Claude ?</b></summary>
Oui. DeepSeek est le choix par défaut ; vous pouvez apporter votre clé OpenAI ou Anthropic Claude. Elle est stockée dans le trousseau macOS.</details>

<details><summary><b>Fonctionne-t-il hors ligne avec des modèles locaux ?</b></summary>
Le chat hors ligne via Ollama est prévu pour la v1. L'usage d'outils avec des modèles locaux n'est pas garanti.</details>

<details><summary><b>Puis-je l'utiliser depuis Telegram ? Et sous Windows ?</b></summary>
Telegram et les autres messageries arriveront après la première préversion. La v1 est uniquement pour Mac.</details>

## Community et Pro

| | Heybe Community | Heybe Pro (plus tard) |
|---|---|---|
| Licence | Apache-2.0, ce dépôt | Propriétaire, Slovian Inc |
| Assistant, tâches, sandbox, validations, votre propre clé | ✓ | ✓ |
| Équipes d'agents constituées automatiquement pour chaque mission | — | ✓ |
| Prix | Gratuit | Non annoncé |

## Contribuer

Les contributions sont bienvenues. Lisez [CONTRIBUTING.md](CONTRIBUTING.md). Chaque commit doit être signé DCO (`git commit -s`) ; la CI le vérifie. Pour citer le projet, voir [CITATION.cff](CITATION.cff).

## Licence

Notre code est sous [licence Apache 2.0](LICENSE), Copyright 2026 Slovian Inc. FastClaw relève séparément de la FastClaw Community License ; voir [NOTICE](NOTICE). Heybe n'est affilié ni à FastClaw, ni à OpenAI, Anthropic, DeepSeek, Manus ou xAI.
