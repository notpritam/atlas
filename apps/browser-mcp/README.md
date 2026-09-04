# Atlas Browser MCP — agent-driven browser control + self-learning task playbooks

Let your agent **drive the page open in your browser** — snapshot it, screenshot
it, click, type, fill forms, scroll, navigate — and get **better every time** by
turning each run into a versioned, reusable playbook.

## The flow

```
Your agent (bb / Claude Code)          atlas-browser-mcp (this)              Atlas extension              the page
  browser_task_start ─────────────▶  starts recording + recalls a           WebSocket 127.0.0.1:8792
                                     prior playbook ("do it like we did")
  browser_snapshot / _click / … ──▶  cmd ──ws──▶  background bridge ──▶ content script ──▶ acts on the page
                                     ◀── result ◀───────────────────────────────────────── (with a highlight flash)
  browser_save_playbook ──────────▶  distils steps + learnings → versioned recipe in ~/.atlas/browser-skills.json
  browser_task_finish ────────────▶  banks the raw step log
```

You keep control: nothing happens until you click the floating **“Agent”** button
on the page you want driven (per-tab consent). A pulsing pill + a purple frame
show when a tab is under agent control.

## Self-learning loop (the important part)

1. **Record** — `browser_task_start(goal, tags)` begins a run; every `browser_*`
   command is logged (action, params, ok, result summary).
2. **Recall** — `browser_task_start` also returns any matching **playbook** from
   past runs — an ordered recipe + *learnings* (what previously broke). The agent
   follows that instead of rediscovering the page.
3. **Distil** — at the end, the agent calls `browser_save_playbook(title, tags,
   steps, learnings)`. If a recipe for this task exists it's **updated and
   version-bumped**, merging new learnings — so stale advice ("this button moved")
   is superseded, not accumulated.
4. **Reuse** — next time a similar task is asked, `browser_task_start` feeds the
   agent: *"we've done this before, here's the recipe + learnings"* — so it starts
   with the known pitfalls already solved.

Playbooks live in `~/.atlas/browser-skills.json` (override `ATLAS_SKILLS_PATH`):
`{ playbooks: [{ title, tags, goal, steps[], learnings[], version, updatedAt,
successCount }], runs: [...] }`.

## Tools

Control: `browser_status`, `browser_snapshot`, `browser_screenshot`,
`browser_click`, `browser_type`, `browser_fill_form`, `browser_select`,
`browser_scroll`, `browser_navigate`, `browser_get_text`, `browser_wait`,
`browser_press_key`.
Learning: `browser_task_start`, `browser_recall_task`, `browser_save_playbook`,
`browser_task_finish`.

The typical loop the agent runs: `browser_task_start` → `browser_snapshot` →
`browser_click`/`browser_type` (re-`browser_snapshot` after big changes) →
`browser_save_playbook` → `browser_task_finish`.

## Run & wire

```bash
cd ~/personal/apps/atlas/apps/browser-mcp
npm install
```

Register it with your agent (stdio MCP). For **bb**:
```bash
bb mcp add atlas-browser -- node /absolute/path/to/apps/browser-mcp/server.mjs
```
For **Claude Code**:
```bash
claude mcp add atlas-browser -- node /absolute/path/to/apps/browser-mcp/server.mjs
```
The server hosts the WebSocket bridge itself, so starting the MCP server is enough
— the Atlas extension connects to it automatically (reconnecting bridge). Reload
the extension after updating it (the new `agent-control.js` content script +
`control-bg.js` background bridge + `ws://127.0.0.1/*` host permission).

Env: `ATLAS_BRIDGE_PORT` (8792), `ATLAS_CMD_TIMEOUT_MS` (20000), `ATLAS_SKILLS_PATH`.

## Safety

- Per-tab consent via the on-page Agent button; commands are refused unless a tab
  is explicitly enabled.
- The bridge binds to `127.0.0.1` only.
- Every action flashes the element it touched, so you can watch what the agent does.
