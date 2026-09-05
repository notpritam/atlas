// Server-side enrichment. Uses the machine's Claude Code (via the Claude Agent
// SDK — no API key) to OCR/tag/summarize a capture, reading its blob straight
// from disk. Mirrors apps/agent's logic so behaviour matches the local agent.
import { readFileSync } from "node:fs";
import type { Database } from "bun:sqlite";
import type { EnrichmentResult } from "@atlas/shared";
import { absBlobPath } from "./blobs.ts";
import { getCaptureRow } from "./db.ts";

const MODEL = process.env.ATLAS_MODEL ?? "claude-haiku-4-5-20251001";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let queryFn: any = null;
async function getQuery() {
  if (queryFn) return queryFn;
  for (const pkg of ["@anthropic-ai/claude-agent-sdk", "@anthropic-ai/claude-code"]) {
    try { const mod = await import(pkg); if (mod.query) return (queryFn = mod.query); } catch { /* try next */ }
  }
  throw new Error("Claude Agent SDK not found — install Claude Code on the server.");
}

function extractJson(text: string): Record<string, unknown> | null {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function runClaude(prompt: string, image = false): Promise<string> {
  const query = await getQuery();
  const options = { model: MODEL, maxTurns: image ? 4 : 1, permissionMode: "bypassPermissions", allowedTools: image ? ["Read"] : [] };
  let out = "";
  for await (const msg of query({ prompt, options })) {
    if (msg.type === "assistant") { for (const block of msg.message?.content ?? []) if (block.type === "text") out += block.text; }
    else if (msg.type === "result" && typeof msg.result === "string") out = msg.result;
  }
  return out;
}

const JSON_TAIL =
  `Return ONLY minified JSON with keys: "summary" (one short line), ` +
  `"category" (a single lowercase bucket like design|code|article|receipt|social|reference|docs), ` +
  `"tags" (2-5 lowercase, hyphenated, reusable concepts, no '#'), "associations" ([]).`;

function normalize(j: Record<string, unknown>): EnrichmentResult {
  const tags = Array.isArray(j.tags)
    ? j.tags.map((t) => String(t).trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-")).filter(Boolean).slice(0, 6)
    : [];
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    ocrText: str(j.ocrText),
    description: str(j.description),
    summary: str(j.summary),
    category: str(j.category)?.trim().toLowerCase(),
    tags,
    associations: Array.isArray(j.associations) ? j.associations : [],
    model: MODEL,
  } as EnrichmentResult;
}

/** Enrich one capture by id → an EnrichmentResult ready for applyEnrichment. */
export async function enrichCaptureRow(db: Database, id: string): Promise<EnrichmentResult> {
  const row = getCaptureRow(db, id);
  if (!row) return { status: "failed", error: "capture gone", model: MODEL } as EnrichmentResult;
  try {
    if (row.blob_path && (row.blob_mime ?? "").startsWith("image/")) {
      const path = absBlobPath(row.blob_path);
      readFileSync(path); // fail fast if the blob is missing
      const ctx = row.source_title ? `\nContext: ${row.source_title} ${row.source_url ?? ""}` : "";
      const prompt =
        `Read the image at ${path}. Extract all readable text (OCR), briefly describe it, then ${JSON_TAIL} ` +
        `Also include "ocrText" (all text found, or "") and "description" (1-2 sentences).${ctx}`;
      const j = extractJson(await runClaude(prompt, true));
      return j ? normalize(j) : ({ status: "failed", error: "could not parse enrichment", model: MODEL } as EnrichmentResult);
    }
    const text = row.article_text || row.selection_text || row.note_text || row.ocr_text || "";
    const src = row.source_url ? `\nSource: ${row.source_title ?? ""} ${row.source_url}` : "";
    const prompt =
      `You are organizing a saved ${row.type} for a personal knowledge base. ${JSON_TAIL}\n` +
      `${row.type} content: ${JSON.stringify(String(text).slice(0, 4000))}${src}`;
    const j = extractJson(await runClaude(prompt));
    return j ? normalize(j) : ({ status: "failed", error: "could not parse enrichment", model: MODEL } as EnrichmentResult);
  } catch (e) {
    return { status: "failed", error: String(e).slice(0, 300), model: MODEL } as EnrichmentResult;
  }
}
