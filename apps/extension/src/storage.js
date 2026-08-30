// Extension settings (local only). No tokens, no server — the DB is in the
// browser and enrichment goes to a local Atlas Agent bridging to Claude Code.

const DEFAULTS = {
  agentUrl: "http://127.0.0.1:8791",
  enrichEnabled: true,
};

export async function getSettings() {
  const s = await chrome.storage.local.get(["agentUrl", "enrichEnabled"]);
  return {
    agentUrl: (s.agentUrl || DEFAULTS.agentUrl).replace(/\/+$/, ""),
    enrichEnabled: s.enrichEnabled ?? DEFAULTS.enrichEnabled,
  };
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}
