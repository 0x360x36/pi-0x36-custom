# pi-0x36-custom

> 0x36 custom config — a [pi](https://pi.dev) package bundling extensions, prompt templates, and a theme.

## What's inside

| Path | Type | What it does |
|---|---|---|
| `extensions/tok-per-second.ts` | extension | Replaces the footer with a live `tok/s` indicator: **live / max / avg** tokens per second under the model name, colored by a red → green → cyan gradient (`0` → `50` → `100+` tok/s). Replicates the native footer (pwd + git branch + session, usage stats, context %, model) and adds the tok/s line right-aligned below it. La línea pwd muestra `[±branch]` en tiempo real + **tamaño del directorio a la derecha del estado de git** `📦 1.23 GB` con **gradiente blanco→rojo 0–5 GB** (`0 GB #ffffff` → `5 GB #ff0000`, poll cada 15s via `du -sb`→`-sk`→fallback). |
| `extensions/dir-size.ts` | extension | Tamaño del directorio donde se abrió pi en **GB/MB/KB** (auto escala 1024, gradiente **blanco→rojo 0–5 GB**). Provee comandos `/du [ruta] [--gb\|--mb\|--kb\|--bytes\|-h]` y aliases `/dir-size`, `/tamaño` (`ej: /du --gigas`, `/du ./dist --mb`) + tool `dir_size` para “¿cuánto pesa?”. El **render visual** está integrado en el footer de `tok-per-second` a la derecha del estado de git `📦 1.23 GB` (poll cada 15s `du -sb`→`-sk`→fallback). |
| `extensions/lib/dir-size.ts` | lib | Helpers puros `formatBytes`/`parseDuArgs`/`getDirSize`/`formatCwdShort`/`sizeGradientRgb` para `dir-size` (testable sin TUI, gradiente blanco→rojo). |
| `extensions/lib/git.ts` | lib | Helpers puros `parsePorcelain`/`branchSegment` y poller git para `tok-per-second`. |
| `extensions/exit-alias.ts` | extension | Adds a `/exit` command as an alias for quitting pi cleanly. |
| `extensions/telegram-notify.ts` | extension | Envía un mensaje por un **bot de Telegram** cuando el agente termina de responder (evento `agent_settled`, ya sin reintentos/compactaciones pendientes): icono según el resultado (`✅` ok, `⚠️` abortado, `❌` error), proyecto, modelo, hora y la última respuesta (truncada a 3500 chars). Comando `/telegram [status] \| set <bot_token> [chat_id] \| test \| on \| off` — `set` sin chat_id lo autodetecta vía `getUpdates`. Config (gana la última): `~/.pi/agent/telegram-notify.json` (0600), `.pi/telegram-notify.json`, `.env` en la **raíz del paquete** (0600, se relee en cada uso; ahí escriben `set`/`on`/`off`) y el entorno real `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` / `TELEGRAM_NOTIFY=0\|1`. |
| `extensions/lib/telegram.ts` | lib | Helpers puros y de API para `telegram-notify`: `buildNotifyText`/`truncate` (límite 4096 de Telegram), `assistantText`, `mergeConfig`/`parseConfig`/`parseEnvConfig`/`readConfigFiles`/`writeConfig` y `.env` vía stdlib (`readEnvFile`/`writeEnvFile`/`parseEnv`), `sendTelegram`/`detectChatId` (fetch inyectable, timeout 10s, sin dependencias). |
| `prompts/commit_en.md` | prompt template | Commits pending changes on the main branch following Conventional Commits, in **English**. |
| `prompts/commit_es.md` | prompt template | Same, but commits in **Spanish**. |
| `prompts/expoc.md` | prompt template | Builds an exploit / PoC for a given CVE: recon via web search, root-cause analysis from patch diffs, primitive mapping, and minimal trigger payload. |
| `prompts/threat.md` | prompt template | Threat-intel search for a CVE: targeted industries, attacked countries (ISO-3166), and exploit/PoC references with source URLs. |
| `themes/arasaka.json` | theme | Cyberpunk red/gold/black theme ("Arasaka"). |
| `test/tokps.test.ts` | test | Assert-based self-check for the tok/s math (`node test/tokps.test.ts`). |
| `test/branch-status.test.ts` | test | Assert-based self-check for the footer branch segment (`node test/branch-status.test.ts`). |
| `test/telegram.test.ts` | test | Self-check de las notificaciones Telegram: helpers, precedencia de config, `sendMessage`/`getUpdates` con fetch falso y wiring de `/telegram` + `agent_settled` (`node test/telegram.test.ts`). |
| `test/dir-size.test.ts` | test | Assert-based self-check para `formatBytes`/`parseDuArgs`/`getDirSize` (`node test/dir-size.test.ts`). |

## Requirements

- [pi coding agent](https://github.com/earendil-works/pi) (Node.js ≥ 22 for running the test)
- Git (for the git install source)

## Install from GitHub

```bash
# global (user settings, ~/.pi/agent/settings.json)
pi install git:github.com/0x360x36/pi-0x36-custom

# or with SSH
pi install git:git@github.com:0x360x36/pi-0x36-custom

# project-local, so the team shares it (.pi/settings.json)
pi install -l git:github.com/0x360x36/pi-0x36-custom

# try it for this run only, without installing
pi -e git:github.com/0x360x36/pi-0x36-custom
```

Pinning a release ref (recommended for reproducibility):

```bash
pi install git:github.com/0x360x36/pi-0x36-custom@v1
```

Verify with `pi list`, then restart pi (or start a new session) for extensions to load.

## Usage

| What | How |
|---|---|
| tok/s footer | enabled automatically once the extension loads; you'll see `tok/s <live> max <peak> avg <session>` under the model name |
| branch status | `[±main]` en el footer: `[` `]` blancos, `±` verde = clean/synced, `+` verde = staged, `●` amarillo = unstaged, `?` amarillo = untracked, `✖` rojo = conflicto, `↑`/`↓` rojo = ahead/behind (ej. `[±main ●2 ?1 ↑1]`, `?2` = 2 untracked) |
| tamaño directorio | en footer, **a la derecha del estado de git**: `~/proyecto [±main] 📦 1.23 GB` — gradiente **blanco→rojo 0–5 GB**, poll cada 15s |
| tamaño puntual | `/du [ruta] [--gb\|--mb\|--kb\|--bytes\|-h]` — alias `/dir-size`, `/tamaño` (ej: `/du --gigas`, `/du ./dist --mb`, `/du --unit=gb`) |
| tamaño (LLM) | tool `dir_size` — pregunta “¿cuánto pesa este proyecto?” |
| quit | `/exit` |
| aviso Telegram | `/telegram set <bot_token> [chat_id]` (crea el bot con @BotFather, escríbele `/start`; sin chat_id se autodetecta con `getUpdates`) → cada vez que el agente termina llega un mensaje. `/telegram test` prueba, `/telegram on\|off` silencia, `/telegram` muestra estado. `set`/`on`/`off` guardan en el `.env` de la raíz del paquete |
| themed UI | `/theme arasaka` |
| conventional commit | `/commit_en` or `/commit_es` |
| CVE exploit / PoC | `/expoc` then provide a CVE ID |
| CVE threat intel | `/threat` then provide a CVE ID |

## Development

```bash
node test/tokps.test.ts          # self-check for the tok/s calculations
node test/branch-status.test.ts  # self-check for the footer branch segment
node test/dir-size.test.ts       # self-check for dir-size (GB/MB/KB)
node test/telegram.test.ts       # self-check for telegram-notify (no hace red real)
```

## Layout

```
extensions/   pi extensions (.ts, auto-discovered)
prompts/      prompt templates (.md, auto-discovered)
themes/       themes (.json, auto-discovered)
test/         assert-based self-checks
```

Resources are auto-discovered from the conventional directories — no `pi` manifest in `package.json` required.

## Security

**Pi extensions run with full system access.** Review the source (`extensions/`) before installing — and audit what you install with `pi -e git:github.com/0x360x36/pi-0x36-custom` to try it without persisting anything.
