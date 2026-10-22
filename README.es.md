<!-- Heybe: asistente de IA personal de código abierto para Mac / agente de IA local -->
<p align="center">
  <a href="https://heybe.dev"><img src="docs/images/social-preview.png" alt="Heybe: asistente de IA personal de código abierto que funciona en tu Mac" width="760"></a>
</p>

<h1 align="center">Heybe: asistente de IA personal de código abierto para Mac</h1>

<p align="center"><b>Dilo una vez. Heybe se encarga del resto.</b><br>
Un agente de IA local que funciona en tu propio ordenador, trabaja dentro de un sandbox y te pregunta antes de actuar.<br>
Usa DeepSeek de serie o trae tu propia clave de API de OpenAI o Claude.</p>

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
  <b>Español</b> ·
  <a href="README.pt-BR.md">Português (Brasil)</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.fr.md">Français</a>
</p>

> [!IMPORTANT]
> **Estado: la versión preliminar para desarrolladores está en desarrollo. Todavía no se puede descargar.** Las capturas son diseños con datos de ejemplo.
> Únete a la lista de espera en **[heybe.dev](https://heybe.dev)** o prueba el [prototipo interactivo](https://heybe.dev/demo).

## ¿Qué es Heybe?

Heybe es un **asistente de IA privado que funciona en tu ordenador**. Le pides algo con tus propias palabras, como a un amigo. Planifica los pasos, consulta la web, escribe el informe o el borrador y guarda el resultado como archivo en tu Mac. Sigue trabajando aunque cierres la ventana.

Está pensado para quien nunca ha usado un "agente de IA" y para emprendedores y desarrolladores que quieren un **asistente de IA autoalojado** que puedan revisar y modificar:

- **Funciona en tu Mac.** Tus archivos, tareas e historial se quedan en tu equipo.
- **Espacio seguro.** Cada acción se ejecuta por defecto en un sandbox aislado, lejos de tus archivos personales.
- **Pregunta antes de actuar.** Borrar archivos, escribir fuera de su carpeta o pasarse del presupuesto requiere tu clic. Escribir "sí" en el chat no cuenta.
- **Tú eliges la IA.** DeepSeek por defecto; tu propia clave de OpenAI o Anthropic Claude; o un modelo local con Ollama para chatear sin conexión.
- **Código abierto.** La edición Community es Apache-2.0 y no necesitas una cuenta nuestra.

## Capturas (vista previa del diseño)

> Diseños de la v1 con contenido de ejemplo; la app real puede cambiar.

<p align="center">
  <img src="docs/images/heybe-screens-overview.png" alt="Pantallas de la app de escritorio Heybe: bienvenida, chat, progreso de tareas, aprobación de acciones, informe y ajustes" width="900">
</p>

| | |
|---|---|
| <img src="docs/images/heybe-onboarding-choose-ai-model.png" alt="Bienvenida de Heybe: elige DeepSeek, tu propia clave de API de OpenAI o Claude, o un modelo local en tu Mac" width="420"><br>**1. Primer inicio:** elige de dónde viene la IA. | <img src="docs/images/heybe-chat-plan.png" alt="Chat de Heybe: el asistente de IA local convierte una frase en un plan paso a paso" width="420"><br>**2. Chat:** dilo una vez y recibe un plan. |
| <img src="docs/images/heybe-task-progress-sandbox.png" alt="Progreso de tarea en Heybe: cada paso se ejecuta en un sandbox, con botón de parar y coste acumulado" width="420"><br>**3. Tarea en curso:** pasos en vivo, espacio seguro, botón Parar y coste. | <img src="docs/images/heybe-action-approval.png" alt="Diálogo de aprobación de Heybe: el agente de IA pregunta antes de borrar archivos, con Denegar, Editar y Aprobar" width="420"><br>**4. Aprobación:** las acciones sensibles esperan tu clic. |
| <img src="docs/images/heybe-task-result-report.png" alt="Resultado en Heybe: tabla comparativa y recomendación con fuentes, guardada como archivo local" width="420"><br>**5. Resultado:** informe con fuentes guardado en tu carpeta. | <img src="docs/images/heybe-settings-api-keys.png" alt="Ajustes de Heybe: proveedores de IA y claves de API, sandbox siempre activo, Telegram próximamente" width="420"><br>**6. Ajustes:** IA y claves, reglas de seguridad, apps de chat (pronto). |

## ¿Qué puede hacer Heybe?

| Tú dices | Heybe hace |
|---|---|
| "Compárame estas cinco apps de notas." | Revisa cada web y crea una tabla con fuentes y una recomendación. |
| "Convierte estas notas de reunión en un resumen semanal." | Extrae decisiones, tareas y responsables en un borrador. |
| "Resume este artículo y los tres que enlaza." | Lee las páginas y escribe un resumen con enlaces. |
| "Ordena mi carpeta de borradores." | Encuentra copias antiguas y pregunta antes de moverlas a la Papelera. |
| "Haz un resumen de las métricas de mi web de esta semana." *(emprendedores)* | Un breve repaso e ideas para la semana siguiente. |

Más en [docs/use-cases.md](docs/use-cases.md) (en inglés). Después de la primera versión preliminar: resumen matutino programado, alertas de precio y chatear con Heybe desde **Telegram** y otras apps de mensajería.

## Funciones y estado

| Función | Estado |
|---|---|
| App de escritorio para macOS (Tauri + React), primero Apple Silicon | En desarrollo |
| Chat en streaming con DeepSeek (por defecto), OpenAI y Claude (tu propia clave) | En desarrollo |
| Modelos locales con Ollama (solo chat, sin conexión) | En desarrollo |
| Búsqueda web leyendo páginas directamente, con fuentes | En desarrollo |
| Tareas largas que siguen al cerrar la ventana (gestor local, SQLite) | Base fusionada |
| Sandbox por defecto: una micro-VM por sesión (BoxLite; alternativa Lima) | Prueba de concepto |
| Aprobación con clic, coste y modelo visibles en cada tarea | En desarrollo |
| DMG firmado y notarizado desde heybe.dev (sin Mac App Store) | Planeado |
| Memoria a largo plazo que puedes ver, editar y borrar | v1.1 |
| Telegram y otras apps de chat | Planeado |
| Equipos de agentes dinámicos | Heybe Pro (más adelante) |

## Comparación con productos similares

Resumen de buena fe basado en información pública de octubre de 2026. Los productos cambian rápido; consulta la documentación oficial de cada uno.

| | Dónde se ejecuta | Código | Modelos | Seguridad | Apps de chat |
|---|---|---|---|---|---|
| **Heybe** (en desarrollo) | Tu Mac | Abierto (Apache-2.0); Pro más adelante | DeepSeek, OpenAI, Claude (tu clave), Ollama | Sandbox por defecto + aprobación con clic | Telegram planeado |
| [ChatGPT](https://chatgpt.com) (Work / navegador en la nube) | Nube de OpenAI; apps de escritorio y móvil | Propietario | OpenAI | Pide permiso para webs nuevas y acciones importantes | — |
| [Claude](https://claude.com) escritorio (Cowork) | App de escritorio (macOS, Windows); el código corre en una VM local; también sesiones en la nube | Propietario | Claude | Solo carpetas que autorizas; confirma acciones sensibles | — |
| [Manus](https://manus.im) | Agente en la nube; la app de escritorio trabaja en carpetas aprobadas | Propietario | Gestionados por Manus | Aprobación de cada comando local | — |
| [OpenClaw](https://github.com/openclaw/openclaw) | Tu equipo o servidor (macOS, Windows, Linux) | Abierto (MIT) | En la nube o locales | Sandbox opcional (p. ej. Docker) | Más de 20 |
| [FastClaw](https://github.com/fastclaw-ai/fastclaw) | Runtime multiagente autoalojado | Código disponible (FastClaw Community License) | En la nube o locales | Varios backends de sandbox | Varios |
| [Open Interpreter](https://github.com/openinterpreter/openinterpreter) | Tu terminal | Abierto (Apache-2.0) | En la nube o locales | Pregunta antes de ejecutar código | — |
| [Jan](https://jan.ai) | App de escritorio | Abierto (Apache-2.0) | Locales (llama.cpp) y APIs en la nube | Centrado en chat; herramientas con aprobación | — |
| [LM Studio](https://lmstudio.ai) | App de escritorio | Propietario, gratis para uso personal y laboral | Modelos locales | Centrado en chat | — |

**¿Por qué Heybe?** Si buscas una **alternativa a Manus** o **alternativa a ChatGPT agent** que funcione en tu Mac, sea de código abierto, acepte tu propia clave de API y ponga un sandbox y un clic de aprobación entre la IA y tus archivos.
**¿Por qué todavía no?** Heybe aún no se ha lanzado; las herramientas de arriba ya son maduras.

Heybe funciona sobre la API `/v1` de FastClaw, que no forma parte de este repositorio (ver [NOTICE](NOTICE)). Todas las marcas pertenecen a sus respectivos dueños; Heybe no está afiliado ni respaldado por ellos.

## Privacidad y seguridad

Son las reglas de diseño de la v1; cada una se probará antes de publicar la versión preliminar.

- **Local por defecto.** Tareas, archivos e historial viven en tu Mac. Los mensajes solo van al proveedor de IA que elijas, o a ninguno con un modelo local.
- **Tus claves son tuyas.** Se guardan en el Llavero de macOS, nunca en el repositorio, los registros ni las exportaciones.
- **Sandbox siempre activo.** La v1 no tiene modo para desactivarlo.
- **Aprobación con clic, no con texto.** Verás qué pasará y si se puede deshacer; nada ocurre hasta que haces clic.
- **Resultados honestos.** Un fallo se muestra como fallo, nunca como hecho.

## Hoja de ruta

| Etapa | Qué | Estado |
|---|---|---|
| 0 | Repositorio, adaptador `/v1` de FastClaw, prueba del sandbox | En curso |
| 1 | Chat de escritorio, proveedores y claves, lectura web, tareas | En curso |
| Vista previa v1 | Compilar desde el código en macOS (Apple Silicon) | Aún no disponible |
| v1.1 | Memoria a largo plazo | Planeado |
| Después | Telegram y apps de chat, tareas programadas, equipos de agentes, DMG firmado | Planeado |

## Inicio rápido para desarrolladores

Hoy funciona el workspace de TypeScript (adaptador, gestor de tareas, interfaz provisional) y sus pruebas. Aún no hay una app completa.

```bash
# Requiere Node 20+ y pnpm 10 (corepack enable)
git clone https://github.com/Slovian42/Heybe.git && cd Heybe
pnpm install
pnpm lint      # eslint + comprobación de límites + TypeScript
pnpm test      # vitest
pnpm --filter @heybe/desktop dev   # interfaz provisional en http://localhost:1420
```

FastClaw y sandbox: [docs/phase0-dev-env.md](docs/phase0-dev-env.md), [docs/sandbox-options.md](docs/sandbox-options.md). Nunca pongas claves reales en archivos (`.env` está ignorado por git).

## Preguntas frecuentes

<details><summary><b>¿Hay un asistente de IA de código abierto que funcione en local en Mac?</b></summary>
Heybe se está construyendo para eso: Apache-2.0, en tu Mac y con sandbox por defecto. Está en desarrollo y aún no se puede descargar.</details>

<details><summary><b>¿Heybe es una alternativa gratuita a Manus?</b></summary>
La edición Community es gratuita y de código abierto, y el trabajo se hace en tu ordenador. Solo pagas a tu proveedor de IA (por ejemplo DeepSeek), o nada con un modelo local.</details>

<details><summary><b>¿Puedo usar mi propia clave de API de OpenAI o Claude?</b></summary>
Sí. DeepSeek es el predeterminado, y puedes traer tu clave de OpenAI o Anthropic Claude. Se guarda en el Llavero de macOS.</details>

<details><summary><b>¿Funciona sin conexión con modelos locales?</b></summary>
El chat sin conexión con Ollama está previsto para la v1. El uso de herramientas con modelos locales no está garantizado.</details>

<details><summary><b>¿Puedo usarlo desde Telegram? ¿Y en Windows?</b></summary>
Telegram y otras apps de chat llegarán después de la primera versión preliminar. La v1 es solo para Mac.</details>

## Community y Pro

| | Heybe Community | Heybe Pro (más adelante) |
|---|---|---|
| Licencia | Apache-2.0, este repositorio | Propietaria, Slovian Inc |
| Asistente, tareas, sandbox, aprobaciones, tu propia clave | ✓ | ✓ |
| Equipos de agentes que se forman solos para cada trabajo | — | ✓ |
| Precio | Gratis | Sin anunciar |

## Contribuir

¡Bienvenido! Lee [CONTRIBUTING.md](CONTRIBUTING.md). Cada commit necesita la firma DCO (`git commit -s`); la CI lo comprueba. Para citar el proyecto, ver [CITATION.cff](CITATION.cff).

## Licencia

Nuestro código usa la [Licencia Apache 2.0](LICENSE), Copyright 2026 Slovian Inc. FastClaw se rige por separado por la FastClaw Community License; ver [NOTICE](NOTICE). Heybe no está afiliado con FastClaw, OpenAI, Anthropic, DeepSeek, Manus ni xAI.
