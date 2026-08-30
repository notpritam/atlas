#!/usr/bin/env node
// Atlas Agent — a tiny local bridge that enriches captures using YOUR Claude
// Code. It listens on 127.0.0.1 only; the browser extension posts pending
// captures here, we ask Claude Code to OCR/tag/summarize them, and hand the
// results back. Nothing is sent to any server. Leave it running.
import { execFile } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

const execFileP = promisify(execFile);
const PORT = Number(process.env.ATLAS_AGENT_PORT ?? 8791);
const MODEL = process.env.ATLAS_MODEL ?? "claude-haiku-4-5-20251001";

// Detect Claude Code for a friendly health signal.
let claudeVersion = null;
try {
  const { stdout } = await execFileP("claude", ["--version"]);
  claudeVersion = stdout.trim();
} catch {
  /* not found — enrich will surface a clear error */
}

// Lazily load the Claude Agent SDK (uses the user's Claude Code auth — no API key).
let queryFn = null;
async function getQuery() {
  if (queryFn) return queryFn;
  for (const pkg of ["@anthropic-ai/claude-agent-sdk", "@anthropic-ai/claude-code"]) {
    try {
      const mod = await import(pkg);
      if (mod.query) return (queryFn = mod.query);
    } catch {
      /* try next */
    }
  }
  throw new Error("Claude Agent SDK not found — install Claude Code (https://claude.com/claude-code)");
}

function extractJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

async function runClaude(prompt, { image = false } = {}) {
  const query = await getQuery();
  const options = {
    model: MODEL,
    maxTurns: image ? 4 : 1,
    permissionMode: "bypassPermissions",
    allowedTools: image ? ["Read"] : [],
  };
  let out = "";
  for await (const msg of query({ prompt, options })) {
    if (msg.type === "assistant") {
      for (const block of msg.message?.content ?? []) if (block.type === "text") out += block.text;
    } else if (msg.type === "result" && typeof msg.result === "string") {
      out = msg.result;
    }
  }
  return out;
}

const JSON_TAIL =
  `Return ONLY minified JSON with keys: "summary" (one short line), ` +
  `"category" (a single lowercase bucket like design|code|article|receipt|social|reference|docs), ` +
  `"tags" (2-5 lowercase, hyphenated, reusable concepts, no '#'), "associations" ([]).`;

function normalize(j) {
  const tags = Array.isArray(j.tags)
    ? j.tags.map((t) => String(t).trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-")).filter(Boolean).slice(0, 6)
    : [];
  const str = (v) => (typeof v === "string" ? v : undefined);
  return {
    ocrText: str(j.ocrText),
    description: str(j.description),
    summary: str(j.summary),
    category: str(j.category)?.trim().toLowerCase(),
    tags,
    associations: Array.isArray(j.associations) ? j.associations : [],
    model: MODEL,
  };
}

async function enrichOne(item) {
  try {
    if (item.imageBase64) {
      const ext = (item.imageMime?.split("/")[1] || "png").split("+")[0];
      const path = join(tmpdir(), `atlas-${item.id}.${ext}`);
      await writeFile(path, Buffer.from(item.imageBase64, "base64"));
      try {
        const ctx = item.sourceTitle ? `\nContext: ${item.sourceTitle} ${item.sourceUrl || ""}` : "";
        const prompt =
          `Read the image at ${path}. Extract all readable text (OCR), briefly describe it, then ${JSON_TAIL} ` +
          `Also include "ocrText" (all text found, or "") and "description" (1-2 sentences).${ctx}`;
        const out = await runClaude(prompt, { image: true });
        const j = extractJson(out);
        return j ? { id: item.id, ...normalize(j) } : { id: item.id, error: "could not parse enrichment" };
      } finally {
        unlink(path).catch(() => {});
      }
    }
    const src = item.sourceUrl ? `\nSource: ${item.sourceTitle || ""} ${item.sourceUrl}` : "";
    const prompt =
      `You are organizing a saved ${item.type} for a personal knowledge base. ${JSON_TAIL}\n` +
      `${item.type} content: ${JSON.stringify(String(item.text || "").slice(0, 4000))}${src}`;
    const out = await runClaude(prompt);
    const j = extractJson(out);
    return j ? { id: item.id, ...normalize(j) } : { id: item.id, error: "could not parse enrichment" };
  } catch (e) {
    return { id: item.id, error: String(e).slice(0, 300) };
  }
}

const app = new Hono();
app.use(
  "*",
  cors({
    origin: (o) =>
      o && (o.startsWith("chrome-extension://") || o.startsWith("http://localhost") || o.startsWith("http://127.0.0.1")) ? o : "",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["content-type"],
  }),
);

app.get("/health", (c) =>
  c.json({ ok: true, service: "atlas-agent", version: "0.1.0", claude: !!claudeVersion, claudeVersion, model: MODEL }),
);

app.post("/enrich", async (c) => {
  const { items } = await c.req.json().catch(() => ({ items: [] }));
  const results = [];
  for (const it of items || []) results.push(await enrichOne(it)); // sequential — one Claude session at a time
  return c.json({ results });
});

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: PORT }, (info) => {
  console.log(`\n  ▲ Atlas Agent  →  http://127.0.0.1:${info.port}`);
  console.log(`  Claude Code : ${claudeVersion ? `detected (${claudeVersion})` : "NOT found — install & log in at claude.com/claude-code"}`);
  console.log(`  Model       : ${MODEL}`);
  console.log(`\n  Leave this running. Your Atlas extension enriches captures through it.`);
  console.log(`  Captures made while this is off stay queued and catch up automatically.\n`);
});
