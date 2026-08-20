# pi-0x36-custom

> 0x36 custom config — a [pi](https://pi.dev) package bundling extensions, prompt templates, and a theme.

## What's inside

| Path | Type | What it does |
|---|---|---|
| `extensions/tok-per-second.ts` | extension | Replaces the footer with a live `tok/s` indicator: **live / max / avg** tokens per second under the model name, colored by a red → green → cyan gradient (`0` → `50` → `100+` tok/s). Replicates the native footer (pwd + git branch + session, usage stats, context %, model) and adds the tok/s line right-aligned below it. |
| `extensions/exit-alias.ts` | extension | Adds a `/exit` command as an alias for quitting pi cleanly. |
| `prompts/commit_en.md` | prompt template | Commits pending changes on the main branch following Conventional Commits, in **English**. |
| `prompts/commit_es.md` | prompt template | Same, but commits in **Spanish**. |
| `prompts/expoc.md` | prompt template | Builds an exploit / PoC for a given CVE: recon via web search, root-cause analysis from patch diffs, primitive mapping, and minimal trigger payload. |
| `prompts/threat.md` | prompt template | Threat-intel search for a CVE: targeted industries, attacked countries (ISO-3166), and exploit/PoC references with source URLs. |
| `themes/arasaka.json` | theme | Cyberpunk red/gold/black theme ("Arasaka"). |
| `test/tokps.test.ts` | test | Assert-based self-check for the tok/s math (`node test/tokps.test.ts`). |

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
| quit | `/exit` |
| themed UI | `/theme arasaka` |
| conventional commit | `/commit_en` or `/commit_es` |
| CVE exploit / PoC | `/expoc` then provide a CVE ID |
| CVE threat intel | `/threat` then provide a CVE ID |

## Development

```bash
node test/tokps.test.ts   # self-check for the tok/s calculations
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
