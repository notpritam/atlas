// The only module that talks to the Atlas backend. Imported by the background
// worker (all capture posting) and the popup (quick note + connection test).
import { getSettings } from "./storage.js";

/**
 * POST a capture. `meta` is the JSON capture (type + source metadata). If
 * `blob` is given, the request is multipart (screenshot/image); otherwise JSON.
 */
export async function postCapture(meta, blob) {
  const { baseUrl, token } = await getSettings();
  if (!baseUrl || !token) throw new Error("Atlas is not configured (set URL + token in the popup)");
  const url = `${baseUrl}/v1/captures`;

  let res;
  if (blob) {
    const ext = (blob.type.split("/")[1] || "bin").split("+")[0];
    const fd = new FormData();
    fd.set("meta", JSON.stringify(meta));
    fd.set("blob", blob, `capture.${ext}`);
    res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: fd,
    });
  } else {
    res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(meta),
    });
  }
  if (!res.ok) throw new Error(`Atlas responded ${res.status}`);
  return res.json();
}

/** Ping /v1/health to validate the URL + token (used by the popup indicator). */
export async function testConnection() {
  const { baseUrl, token } = await getSettings();
  if (!baseUrl || !token) throw new Error("not configured");
  const res = await fetch(`${baseUrl}/v1/health`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
