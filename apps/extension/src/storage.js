// Extension settings (local). Captures + enrichment stay local by default;
// browser control connects to the local bridge unless a hosted relay is set.

const DEFAULTS = {
  agentUrl: "http://127.0.0.1:8791",
  enrichEnabled: true,
  // Hosted browser-control relay. Empty relayUrl => local bridge (ws://127.0.0.1:8792).
  // Set both to drive this browser from an agent anywhere via the Atlas backend.
  relayUrl: "", // e.g. wss://atlas.notpritam.in/agent
  relayToken: "", // account token (same one the agent uses)
};

export async function getSettings() {
  const s = await chrome.storage.local.get(["agentUrl", "enrichEnabled", "relayUrl", "relayToken"]);
  return {
    agentUrl: (s.agentUrl || DEFAULTS.agentUrl).replace(/\/+$/, ""),
    enrichEnabled: s.enrichEnabled ?? DEFAULTS.enrichEnabled,
    relayUrl: (s.relayUrl ?? DEFAULTS.relayUrl).trim(),
    relayToken: (s.relayToken ?? DEFAULTS.relayToken).trim(),
  };
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}
