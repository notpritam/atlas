#!/usr/bin/env bun
// Server-side enrichment worker. Drains the capture queue on the box, enriching
// each pending capture with the machine's Claude Code — so captures get OCR/
// tags/summaries without any local agent running on the user's machine.
import { openDb } from "../src/db.ts";
import { applyEnrichment, claimCaptures } from "../src/captures.ts";
import { enrichCaptureRow } from "../src/enrich-worker.ts";

const BATCH = Number(process.env.ATLAS_ENRICH_BATCH ?? 2);
const IDLE_MS = Number(process.env.ATLAS_ENRICH_IDLE_MS ?? 5000);
const ONCE = process.argv.includes("--once");

const db = openDb();
console.log(`atlas enrich worker started (batch=${BATCH}, idle=${IDLE_MS}ms${ONCE ? ", once" : ""})`);

do {
  const claimed = claimCaptures(db, "server-worker", BATCH);
  if (!claimed.length) {
    if (ONCE) break;
    await Bun.sleep(IDLE_MS);
    continue;
  }
  for (const cap of claimed) {
    const result = await enrichCaptureRow(db, cap.id);
    applyEnrichment(db, cap.id, result);
    const s = (result as { status?: string; error?: string }).status === "failed"
      ? `FAILED ${(result as { error?: string }).error}`
      : `${result.category} [${(result.tags ?? []).join(", ")}]`;
    console.log(`  enriched ${cap.id} (${cap.type}): ${s}`);
  }
} while (!ONCE);
