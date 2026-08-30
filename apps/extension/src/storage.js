// Extension settings live in chrome.storage.local. The device token is a
// bearer secret; it is only ever read here and used from the background worker.

export async function getSettings() {
  const { atlasBaseUrl, atlasToken } = await chrome.storage.local.get([
    "atlasBaseUrl",
    "atlasToken",
  ]);
  return { baseUrl: (atlasBaseUrl || "").replace(/\/+$/, ""), token: atlasToken || "" };
}

export async function setSettings({ baseUrl, token }) {
  await chrome.storage.local.set({
    atlasBaseUrl: (baseUrl || "").trim(),
    atlasToken: (token || "").trim(),
  });
}
