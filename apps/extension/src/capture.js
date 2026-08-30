// Local capture + enrichment queue. Captures save to IndexedDB instantly and
// usably; a drain loop hands the pending ones to the local Atlas Agent (Claude
// Code) when it's reachable, and leaves them queued when it isn't.
import * as db from "./db.js";
import { agentEnrich, agentHealth } from "./agent.js";
import { getSettings } from "./storage.js";

/** Save a capture locally and kick off a drain attempt. */
export async function saveCapture(input) {
  const rec = await db.addCapture(input);
  drainQueue().catch(() => {});
  broadcast();
  return rec;
}

// base64 from a Blob without FileReader (service-worker safe)
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function broadcast() {
  try {
    chrome.runtime.sendMessage({ kind: "atlas-changed" }).catch(() => {});
  } catch {
    /* no listener open — fine */
  }
}

let draining = false;

/** Try to enrich a batch of pending captures via the local agent. Safe to call
 *  often; no-ops when the agent is offline or the queue is empty. */
export async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    const { agentUrl, enrichEnabled } = await getSettings();
    if (!enrichEnabled) return;

    const pending = await db.pendingCaptures(4);
    if (!pending.length) return;

    // Is the Claude Code bridge up? If not, leave everything queued.
    try {
      await agentHealth(agentUrl);
    } catch {
      return;
    }

    for (const r of pending) await db.updateCapture(r.id, { status: "processing" });

    const items = [];
    for (const r of pending) {
      const item = {
        id: r.id,
        type: r.type,
        sourceTitle: r.sourceTitle,
        sourceUrl: r.sourceUrl,
        text: r.selectionText || r.noteText || r.articleText || r.sourceTitle || "",
      };
      if (r.blob && (r.type === "screenshot" || r.type === "image")) {
        item.imageBase64 = await blobToBase64(r.blob);
        item.imageMime = r.blobMime || "image/png";
      }
      items.push(item);
    }

    let results;
    try {
      results = await agentEnrich(agentUrl, items);
    } catch (e) {
      for (const r of pending) {
        await db.updateCapture(r.id, {
          status: "failed",
          enrichError: String(e).slice(0, 300),
          enrichAttempts: (r.enrichAttempts || 0) + 1,
        });
      }
      return;
    }

    const byId = new Map(results.map((x) => [x.id, x]));
    for (const r of pending) {
      const en = byId.get(r.id);
      if (!en || en.error) {
        await db.updateCapture(r.id, {
          status: "failed",
          enrichError: en?.error || "no result",
          enrichAttempts: (r.enrichAttempts || 0) + 1,
        });
      } else {
        await db.updateCapture(r.id, {
          status: "done",
          ocrText: en.ocrText ?? r.ocrText,
          description: en.description ?? null,
          summary: en.summary ?? null,
          category: en.category ?? null,
          tags: Array.isArray(en.tags) ? en.tags : [],
          associations: Array.isArray(en.associations) ? en.associations : [],
          model: en.model ?? "claude-code",
          enrichedAt: Date.now(),
          enrichError: null,
        });
      }
    }
  } finally {
    draining = false;
    broadcast();
  }
}
