# Atlas Hosted Relay — design (2026-09-05)

Turn Atlas's backend into a **hosted, authenticated hub** so the extension and the
agent connect from anywhere — no `localhost:8792` / `8791` and no SSH tunnel.
User calls: **Full hub**, **invite-code / API-key auth**, **agent runs anywhere**
(local bb/Claude now, hosted later — configurable URL from the extension + bb panel).

Decomposed into 3 phases; **this spec is Phase 1**.

| Phase | Scope |
|---|---|
| **1 (this)** | Hosted **browser-control relay** + invite-token auth. `wss://atlas.notpritam.in/agent`. Extension + agent MCP connect with one token; backend routes agent↔browser per account. Local mode kept as fallback. |
| 2 | Server-side **enrichment** (move OCR/tagging off the local agent to a backend LLM key). |
| 3 | **Accounts + capture sync** (invite→account, multi-device, per-user isolation everywhere). |

## Phase 1 architecture

Fold the relay into the **existing atlas backend** (Bun + Hono, `:8790`, behind
caddy TLS at `atlas.notpritam.in`). Reuses its `devices` table + token auth.

```
User's Chrome (extension, role=browser) ─┐                          ┌─ User's Claude/bb (atlas-browser MCP, role=agent)
                                         └── wss://atlas.notpritam.in/agent ──┘
                                            atlas backend :8790  (relay hub)
                                            rooms keyed by accountId; routes
                                            cmd→browser, result→agent, fans out
                                            status/context/activity to agents
```

### Auth: invite token = device with `relay` scope
- Add `"relay"` to the `Scope` enum (`packages/shared/src/api.ts`).
- Mint with the existing CLI: `atlas devices add "<account>" --scope relay --kind relay` → prints a token once (only the sha256 is stored, `devices` table).
- **One token per account**, used by BOTH sides. `accountId = device.id`. The
  connection's **role** (`browser` | `agent`) is declared in the hello.
- **First-message auth** (token NOT in the URL → never logged): the client
  connects to `/agent`, then sends `{type:"hello", role, token}` as its first
  frame within 5s. Backend validates (relay scope, not revoked) → joins the
  account's room, else closes `4001`.

### Relay hub (`apps/backend/src/relay.ts`, new — pure + testable)
- `Map<accountId, Room>`; `Room = { browsers:Set, agents:Set, routeMap:Map, lastStatus, latestContext }`.
- Routing = the local shared-bridge owner logic, scoped per room:
  - **browser → server**: `result` → look up `routeMap[internalId]` → forward to origin agent as `{type:"result", id:origId}`. `status`/`context`/`activity` → update room + fan out to `room.agents`.
  - **agent → server**: `cmd` → pick a browser in the room, `internalId=uuid`, `routeMap.set(internalId,{agentWs,origId})`, forward `{type:"cmd", id:internalId, …}`. On (re)join, send current `lastStatus`/`latestContext`.
- Hard tenant isolation: a socket only ever sees its own account's room.
- Thin Bun adapter in `index.ts`: `server.upgrade(req,{data})` for `/agent`; `websocket:{open,message,close}` delegate to the hub. Bun auto-pings (idle handled).

### Clients (config-driven; local mode preserved)
- **Extension** `control-bg.js`: if `relayUrl` + `relayToken` set (chrome.storage) → connect `wss` to `relayUrl` and send hello `{role:"browser", token}`; else the current `ws://127.0.0.1:8792`. `storage.js` gains `relayUrl`/`relayToken`; settings UI (dashboard) gains the two fields. Everything else (CDP, cursor, streaming, activity) unchanged — only the socket URL differs.
- **MCP** `server.mjs`: if `ATLAS_RELAY_URL` + `ATLAS_TOKEN` set → connect as a remote client (`role:"agent"` hello with token) instead of owning/attaching a local port; else current local shared-bridge. Reconnect with backoff.

### Security
- TLS via caddy (unchanged `reverse_proxy localhost:8790` passes WS upgrades).
- Token → account scoping; per-room isolation; revocable tokens (`atlas devices revoke`); first-message auth keeps tokens out of URLs/logs; the on-page **Agent-pill per-tab consent stays**. Relay never executes — pure routing.
- **Privacy shift to accept:** page snapshots/screenshots/commands now transit the server (over TLS) instead of staying on `localhost`. This is inherent to "connect from anywhere".

### Testing
- Hub unit tests: two accounts never cross; cmd/result round-trip; fan-out; auth reject (bad/absent/revoked token; wrong first frame).
- Live smoke: mint a token, run a fake browser + fake agent socket against `wss://atlas.notpritam.in/agent`, assert a snapshot round-trips.

### Rollout
- Add relay code (backward-compatible; local mode default when unconfigured).
- Restart `atlas-backend`; verify `/agent` upgrade through caddy.
- Mint the user's account token; set it in the extension + the agent MCP env.

## Out of scope (Phase 1)
Server-side enrichment, capture sync, real account UI, hosted agents, billing.
