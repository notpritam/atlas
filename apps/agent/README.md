# Atlas Agent

A tiny local bridge that enriches your [Atlas](https://atlas.notpritam.in) captures
using **your own Claude Code** — OCR on screenshots, tags, summaries, categories.
It runs on `127.0.0.1` only. **Nothing is sent to any server**; your captures never
leave your machine.

## Run it

You need [Claude Code](https://claude.com/claude-code) installed and logged in.

```bash
npx @notpritam/atlas-agent
```

Leave it running. The Atlas browser extension talks to it at
`http://127.0.0.1:8791`. Captures you make while it's off stay safely queued in the
browser and catch up automatically the next time it's running.

## How it works

1. The extension stores every capture locally (IndexedDB) and marks it `pending`.
2. It POSTs a batch of pending captures to this agent.
3. The agent asks your Claude Code to read/OCR and organize each one, and returns
   `{ summary, category, tags, ocrText, description }`.
4. The extension updates its local records — no cloud, no API key, no account.

## Options

| Env | Default | Meaning |
| --- | --- | --- |
| `ATLAS_AGENT_PORT` | `8791` | Port to listen on (must match the extension's Agent URL) |
| `ATLAS_MODEL` | `claude-haiku-4-5-20251001` | Model Claude Code uses to enrich |

## Autostart (optional, macOS)

Add to your shell profile or a `launchd` plist so it starts with your Mac:

```bash
npx @notpritam/atlas-agent &
```
