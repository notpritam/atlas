// Customer credentials and a durable, account-bound outbox. Only the background
// worker calls mutating operations; pages ask it for a credential-free status.
import * as db from "./db.js";
import { libraryOperation } from "./library-api.js";
import { clearPreferenceCache, getEffectivePreferences } from "./preferences.js";
import { CUSTOMER_ORIGIN, CUSTOMER_ORIGINS, EXTENSION_ENVIRONMENT } from "./product.js";
import { cloudImageMime } from "./image-formats.js";

export { CUSTOMER_ORIGIN } from "./product.js";
const STATE_KEY = "atlasCustomer";
const AUTO_CONNECT_PAUSED_KEY = "atlasAutoConnectPaused";
let draining = null;
let mutations = Promise.resolve();
let pairingSequence = 0;
let activeClaims = 0;

function exclusive(action) {
  const result = mutations.then(action, action);
  mutations = result.catch(() => {});
  return result;
}
function announce() {
  try {
    chrome.runtime.sendMessage({ kind: "atlas-changed" }).catch(() => {});
  } catch {
    /* no open view */
  }
}
async function readState() {
  return (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || null;
}
async function writeState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
  announce();
}
const sameConnection = (a, b) =>
  !!a &&
  !!b &&
  a.account.id === b.account.id &&
  a.connection.id === b.connection.id &&
  a.token === b.token;
async function updateConnection(expected, patch) {
  return exclusive(async () => {
    const current = await readState();
    if (sameConnection(current, expected))
      await writeState({ ...current, ...patch });
  });
}
function publicAccount(account) {
  return account
    ? {
        id: account.id,
        email: account.email,
        name: account.name,
        createdAt: account.createdAt,
      }
    : null;
}
export async function protectCloudStorage() {
  // This also protects legacy connection settings from content-script access.
  await chrome.storage.local.setAccessLevel?.({
    accessLevel: "TRUSTED_CONTEXTS",
  });
}
async function revokeCredential(previous) {
  if (!previous?.token) return { revoked: true, warning: null };
  try {
    const response = await fetch(
      CUSTOMER_ORIGIN + "/api/connections/disconnect",
      {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: { Authorization: "Bearer " + previous.token },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (response.ok || response.status === 401)
      return { revoked: true, warning: null };
  } catch {
    /* Local disconnect is immediate even when revocation is offline. */
  }
  return {
    revoked: false,
    warning:
      "The previous browser credential could not be revoked. Remove it from Connected browsers in your FoundKeep dashboard.",
  };
}

function browserLabel() {
  const agent = navigator.userAgent || "";
  const browser = /Edg\//.test(agent) ? "Edge" : /OPR\//.test(agent) ? "Opera" : /Chrome\//.test(agent) || /Chromium\//.test(agent) ? "Chrome" : "Chromium browser";
  const platform = /CrOS/.test(agent) ? "ChromeOS" : /Windows/.test(agent) ? "Windows" : /Mac OS X/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : null;
  return platform ? `${browser} · ${platform}` : browser;
}
export function trustedPairingSender(sender) {
  try {
    return (
      !sender?.id &&
      (sender.frameId === undefined || sender.frameId === 0) &&
      CUSTOMER_ORIGINS.includes(new URL(sender.url).origin) &&
      (sender.origin === undefined || CUSTOMER_ORIGINS.includes(sender.origin))
    );
  } catch {
    return false;
  }
}
export async function handleExternalMessage(message, sender) {
  if (!trustedPairingSender(sender))
    return { ok: false, error: "This page cannot connect FoundKeep." };
  if (message?.kind === "atlas-ping") {
    const state = await readState();
    return {
      ok: true,
      version: chrome.runtime.getManifest().version,
      environment: EXTENSION_ENVIRONMENT,
      origin: CUSTOMER_ORIGIN,
      autoConnect: {
        account: publicAccount(state?.account),
        paused: Boolean((await chrome.storage.local.get(AUTO_CONNECT_PAUSED_KEY))[AUTO_CONNECT_PAUSED_KEY]),
      },
      account:
        state?.token && state.status !== "reconnect"
          ? publicAccount(state.account)
          : null,
    };
  }
  const automatic = message?.kind === "atlas-auto-connect";
  if (
    (!automatic && message?.kind !== "atlas-connect") ||
    Object.keys(message).some((k) => !(automatic ? ["kind", "code", "accountId"] : ["kind", "code"]).includes(k)) ||
    (automatic && (typeof message.accountId !== "string" || !message.accountId || message.accountId.length > 160)) ||
    typeof message.code !== "string" ||
    !/^[a-zA-Z0-9_-]{32,256}$/.test(message.code)
  ) {
    return { ok: false, error: "Request a new connection code from FoundKeep." };
  }
  const automaticConflict = async (state) => {
    if ((await chrome.storage.local.get(AUTO_CONNECT_PAUSED_KEY))[AUTO_CONNECT_PAUSED_KEY])
      return "This browser was disconnected. Choose Connect FoundKeep to connect it again.";
    if (state?.account?.id && state.account.id !== message.accountId)
      return "This browser belongs to another account. Confirm the account switch in Apps & devices.";
    return null;
  };
  if (automatic) {
    const state = await readState();
    const conflict = await automaticConflict(state);
    if (conflict) return { ok: false, error: conflict };
    if (state?.token && state.status !== "reconnect") return { ok: true, account: publicAccount(state.account) };
    if (activeClaims) return { ok: false, error: "A browser connection is already in progress. Check again in a moment." };
  }
  const sequence = ++pairingSequence;
  activeClaims++;
  try {
    await protectCloudStorage();
    const response = await fetch(CUSTOMER_ORIGIN + "/api/pairing/claim", {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: message.code, name: browserLabel() }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok)
      return {
        ok: false,
        error:
          result.message ||
          "This connection code expired. Try connecting again.",
      };
    if (
      !result.account?.id ||
      !result.account.email ||
      !result.connection?.id ||
      typeof result.token !== "string" ||
      !result.token ||
      result.token.length > 4096
    ) {
      return {
        ok: false,
        error: "FoundKeep returned an incomplete connection. Try again.",
      };
    }
    if (automatic && result.account.id !== message.accountId) {
      await revokeCredential({ token: result.token });
      return { ok: false, error: "Your signed-in account changed. Open the dashboard again." };
    }
    let previous, next;
    const connected = await exclusive(async () => {
      if (sequence !== pairingSequence)
        return {
          ok: false,
          error: "A newer connection request replaced this one.",
        };
      previous = await readState();
      if (automatic) {
        const conflict = await automaticConflict(previous);
        if (conflict) return { ok: false, error: conflict };
      }
      next = {
        account: publicAccount(result.account),
        connection: result.connection,
        token: result.token,
        status: "connected",
        error: null,
      };
      await writeState(next);
      if (!automatic) await chrome.storage.local.set({ [AUTO_CONNECT_PAUSED_KEY]: false });
      return { ok: true, account: publicAccount(result.account) };
    });
    if (!connected.ok) {
      // A slower claim can finish after a newer request. Its credential was
      // never installed and must not linger as an unused connected browser.
      await revokeCredential({ token: result.token });
      return connected;
    }
    if (connected.ok && previous?.token && previous.token !== next.token) {
      const revoked = await revokeCredential(previous);
      if (revoked.warning) {
        await updateConnection(next, { notice: revoked.warning });
        return { ...connected, warning: revoked.warning };
      }
    }
    return connected;
  } catch {
    return {
      ok: false,
      error: "Could not reach FoundKeep. Check your connection and try again.",
    };
  } finally {
    activeClaims--;
  }
}

/** Snapshot the selected account at save time, even while its token needs renewal. */
export async function captureBinding() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const state = await readState();
    const preferenceState = await getEffectivePreferences();
    const current = await readState();
    if ((!state && !current) || sameConnection(state, current)) {
      return {
        cloudAccountId: state?.account?.id || null,
        processingOptions: { ...preferenceState.preferences.organization },
      };
    }
  }
  // If the selected account is changing continuously, leave this capture local.
  // A later explicit import can bind it once the customer has made a selection.
  return {
    cloudAccountId: null,
    processingOptions: { ocr: true, summaries: true, tags: true },
  };
}
export async function getCloudStatus() {
  const state = await readState();
  const metrics = await db.cloudMetrics(state?.account?.id);
  return {
    account: publicAccount(state?.account),
    status: state?.status || "disconnected",
    ...metrics,
    error: state?.error || metrics.error,
    notice: state?.notice || null,
  };
}
export async function disconnectCloud() {
  pairingSequence++;
  const previous = await exclusive(async () => {
    const state = await readState();
    await chrome.storage.local.set({ [STATE_KEY]: null, [AUTO_CONNECT_PAUSED_KEY]: true });
    announce();
    return state;
  });
  await clearPreferenceCache();
  return revokeCredential(previous);
}

export async function importLocalCaptures({ confirmed, accountId } = {}) {
  if (confirmed !== true || !accountId)
    throw new Error("Confirm which account will receive these local captures.");
  return exclusive(async () => {
    const current = await readState();
    if (!current?.token || current.account.id !== accountId)
      throw new Error("The account changed. Reopen import and confirm again.");
    const records = await db.listCaptures({ limit: Infinity });
    let imported = 0;
    for (const record of records) {
      if (record.cloudAccountId) continue;
      await db.updateCapture(record.id, {
        cloudAccountId: accountId,
        cloudClientId: record.cloudClientId || record.id,
        cloudStatus: "queued",
        cloudError: null,
        cloudAttempts: 0,
        cloudNextRetryAt: 0,
        status: "done",
      });
      imported++;
    }
    announce();
    return { imported };
  });
}
async function uploadBody(record) {
  let sourceUrl = null;
  try {
    const url = new URL(record.sourceUrl);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      sourceUrl = url.href;
  } catch {
    /* Notes on browser pages have no public source URL. */
  }
  const body = {
    clientId: record.cloudClientId || record.id,
    type:
      record.cloudType ||
      (record.type === "highlight" ? "selection" : record.type),
    sourceUrl,
    sourceTitle: record.sourceTitle,
    selectionText: record.selectionText,
    noteText: record.noteText,
    articleText: record.articleText,
    provenance: record.provenance,
    ...(record.socialContext ? {socialContext: record.socialContext} : {}),
    processingOptions: record.processingOptions,
    width: record.width,
    height: record.height,
    capturedAt: record.capturedAt,
    folderId: record.folderId || null,
    userTags: record.userTags || [],
  };
  if (record.blob) {
    if (record.blob.size > 8 * 1024 * 1024)
      throw new Error(
        "This image exceeds the 8 MiB upload limit. It is still saved in this browser.",
      );
    const mime = cloudImageMime(record.blob);
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    body.dataUrl = `data:${mime};base64,${btoa(text)}`;
  }
  return body;
}
async function drain({ force = false } = {}) {
  // Serial uploads bound memory and make retries/restarts safe. A persisted
  // record remains queued until acknowledgement, so an interrupted request
  // always retries the same account/clientId pair.
  for (let n = 0; n < 10; n++) {
    const connection = await readState();
    if (!connection?.token || connection.status === "reconnect") return;
    const preferenceState = await getEffectivePreferences();
    if (!force && !preferenceState.preferences.sync.automatic) return;
    const records = await db.listCloudQueue(connection.account.id);
    const record = records.find(
        (r) =>
          r.cloudAccountId === connection.account.id &&
          r.cloudStatus === "queued" &&
          (!r.cloudNextRetryAt || r.cloudNextRetryAt <= Date.now()),
      );
    if (!record) return;
    let body;
    try {
      body = record.cloudRemoteId ? null : await uploadBody(record);
    } catch (error) {
      await db.updateCapture(record.id, {
        cloudStatus: "failed",
        cloudError: error.message,
      });
      announce();
      continue;
    }
    // Blob conversion yields. Never use a newly selected account's credential
    // for this record, and stop an obsolete request before sending it.
    if (!sameConnection(connection, await readState())) continue;
    if (!(await db.getCapture(record.id))) continue;
    try {
      let remoteId = record.cloudRemoteId;
      let enrichmentStatus = record.cloudEnrichmentStatus;
      if (!remoteId) {
        const response = await fetch(CUSTOMER_ORIGIN + "/api/captures", {
          method: "POST",
          credentials: "omit",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + connection.token,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        });
        const result = await response.json().catch(() => ({}));
        if (response.status === 401) {
          await updateConnection(connection, {
            token: null,
            status: "reconnect",
            error:
              "Reconnect this browser to resume syncing. Your captures are safe locally.",
          });
          announce();
          continue;
        }
        if (!response.ok) {
          const error = new Error(
            result.message ||
              `FoundKeep could not sync this capture (${response.status}).`,
          );
          error.permanent =
            response.status >= 400 &&
            response.status < 500 &&
            response.status !== 429;
          throw error;
        }
        if (!result.capture?.id)
          throw new Error(
            "FoundKeep did not confirm the upload. It will be retried safely.",
          );
        remoteId = result.capture.id;
        enrichmentStatus = result.capture.status;
        await db.updateCapture(record.id, { cloudRemoteId: remoteId, cloudEnrichmentStatus: enrichmentStatus });
      }
      if (record.collectionSubmission) {
        const submission = record.collectionSubmission;
        const available = await libraryRequest('collections', {}, connection.account.id);
        const target = available.collections?.find(item => item.id === submission.id && item.canSubmit);
        if (!target || target.visibility !== submission.visibility) {
          const error = new Error('The collection access or visibility changed. Your private copy is saved; choose the collection again from your library.');
          error.permanent = true; throw error;
        }
        if (!sameConnection(connection, await readState()) || !(await db.getCapture(record.id))) continue;
        const result = await libraryRequest('submit-collection', { id: submission.id, value: {
          ...submission.entry, clientId: record.cloudClientId || record.id, captureId: remoteId,
        } }, connection.account.id);
        if (!result.entry?.id) throw new Error('FoundKeep did not confirm the collection entry. It will be retried safely.');
        await db.updateCapture(record.id, { collectionEntryId: result.entry?.id, collectionEntryStatus: result.entry?.status });
      }
      await db.updateCapture(record.id, {
        cloudStatus: "synced",
        cloudRemoteId: remoteId,
        cloudEnrichmentStatus: enrichmentStatus,
        cloudError: null,
        cloudNextRetryAt: 0,
        status: "done",
      });
      await updateConnection(connection, { status: "connected", error: null });
    } catch (error) {
      const attempts = (record.cloudAttempts || 0) + 1;
      const detail = error.permanent
        ? error.message
        : "Could not reach FoundKeep. Saved in this browser; sync will retry automatically.";
      await db.updateCapture(record.id, {
        cloudStatus: error.permanent ? "failed" : "queued",
        cloudError: detail,
        cloudAttempts: attempts,
        cloudNextRetryAt:
          Date.now() + Math.min(300000, 15000 * 2 ** Math.min(attempts - 1, 5)),
      });
      await updateConnection(connection, { error: detail });
      // Connectivity failures affect the whole batch. Do not hammer the API.
      if (!error.permanent) return;
    } finally {
      announce();
    }
  }
}
export function drainCloudQueue({ force = false } = {}) {
  if (force && draining)
    return draining.then(() => drainCloudQueue({ force: true }));
  if (!draining)
    draining = drain({ force }).finally(() => {
      draining = null;
    });
  return draining;
}
export async function retryCloudSync() {
  const connection = await readState();
  if (!connection?.token) return;
  for (const record of await db.listCloudQueue(connection.account.id, ["queued", "failed"])) {
    if (
      record.cloudAccountId === connection.account.id &&
      ["queued", "failed"].includes(record.cloudStatus)
    ) {
      await db.updateCapture(record.id, {
        cloudStatus: "queued",
        cloudNextRetryAt: 0,
        cloudError: null,
      });
    }
  }
  return drainCloudQueue({ force: true });
}

// Sidebar responses stay bound to the connection which started the operation.
export async function libraryRequest(operation, args, accountId) {
  const request=libraryOperation(operation,args);
  const connection=await readState();
  if (!accountId || connection?.account?.id!==accountId || !connection.token || connection.status==='reconnect') throw new Error('Connect your FoundKeep account to open its collection.');
  const response=await fetch(CUSTOMER_ORIGIN+request.path,{
    method:request.method,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30_000),
    headers:{Authorization:'Bearer '+connection.token,...(request.body?{'Content-Type':'application/json'}:{}),...(request.range?{Range:request.range}:{})},
    body:request.body?JSON.stringify(request.body):undefined,
  });
  if (!sameConnection(connection,await readState())) throw new Error('Your account changed. Open the collection again.');
  if (response.status===401) {
    await updateConnection(connection,{status:'reconnect',error:'Reconnect this browser to continue.'});
    throw new Error('Reconnect this browser to continue.');
  }
  const reader=response.body?.getReader(); const chunks=[];let length=0;
  try {
    if (reader) while (true) { const result=await reader.read();if(result.done)break;length+=result.value.byteLength;if(length>12*1024*1024)throw new Error('This saved item is too large to preview. Open it in your dashboard.');chunks.push(result.value); }
  } finally {void reader?.cancel().catch(()=>{});}
  if (!sameConnection(connection,await readState())) throw new Error('Your account changed. Open the collection again.');
  const blob=new Blob(chunks,{type:response.headers.get('Content-Type')||''});
  if (request.binary && response.ok) {
    const mime=blob.type.split(';')[0];
    if (!['image/png','image/jpeg','image/webp','video/mp4','text/plain'].includes(mime)) throw new Error('This saved file type cannot be opened here.');
    const total=Number(response.headers.get('Content-Range')?.split('/')[1]||blob.size);
    if (!Number.isSafeInteger(total)||total<=0||total>50*1024*1024||blob.size>4*1024*1024) throw new Error('This saved file is too large to open here.');
    const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    if(!sameConnection(connection,await readState()))throw new Error('Your account changed.');
    return {base64:btoa(binary),mime,total,bytes:bytes.length};
  }
  if (request.image && response.ok) {
    if (!['image/png','image/jpeg','image/webp'].includes(blob.type)) throw new Error('No preview available.');
    const bitmap=await createImageBitmap(blob);
    try {
      const ratio=Math.min(1,480/bitmap.width,640/bitmap.height);
      const canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*ratio)),Math.max(1,Math.round(bitmap.height*ratio)));
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      const preview=await canvas.convertToBlob({type:'image/webp',quality:.75});
      const bytes=new Uint8Array(await preview.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
      if(!sameConnection(connection,await readState()))throw new Error('Your account changed.');
      return {dataUrl:'data:image/webp;base64,'+btoa(binary)};
    } finally {bitmap.close();}
  }
  let data;try{data=JSON.parse(await blob.text());}catch{throw new Error('FoundKeep could not read the collection response.');}
  if(!sameConnection(connection,await readState()))throw new Error('Your account changed. Open the collection again.');
  if(!response.ok)throw new Error(String(data?.message||'FoundKeep could not complete this action.').slice(0,300));
  if(request.method!=='GET')announce();
  return data;
}
