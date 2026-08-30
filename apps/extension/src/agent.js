// Client for the local Atlas Agent — a tiny companion the user runs that bridges
// to their own Claude Code for enrichment. All calls are to 127.0.0.1; if it's
// not running, captures simply stay queued in IndexedDB and enrich later.

export async function agentHealth(url) {
  const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw new Error(`agent ${res.status}`);
  return res.json(); // { ok, service, claude, version }
}

export async function agentEnrich(url, items) {
  const res = await fetch(`${url}/enrich`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`agent ${res.status}`);
  const data = await res.json();
  return data.results || [];
}
