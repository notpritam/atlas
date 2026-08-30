import { z } from "zod";

/**
 * The five v1 capture types. `type` drives which fields are populated and how the
 * bb enrichment worker processes the row.
 *  - screenshot : a region/full-page screenshot (has a blob)
 *  - image      : an image grabbed from a page (has a blob or a remote srcUrl)
 *  - highlight  : selected text saved with its source + surrounding context
 *  - bookmark   : a saved URL; the backend fetches readable article text
 *  - note       : a standalone quick note typed into the extension popup
 */
export const CaptureType = z.enum([
  "screenshot",
  "image",
  "highlight",
  "bookmark",
  "note",
]);
export type CaptureType = z.infer<typeof CaptureType>;

/** Lifecycle of a capture through the enrichment queue. */
export const CaptureStatus = z.enum([
  "pending", // stored, waiting for the bb worker
  "processing", // leased by a worker
  "done", // enriched
  "failed", // enrichment failed (may be retried while attempts < MAX)
]);
export type CaptureStatus = z.infer<typeof CaptureStatus>;

/** An agent-proposed link from this capture to another item or concept. */
export const Association = z.object({
  targetId: z.string().nullish(),
  title: z.string().nullish(),
  reason: z.string().nullish(),
});
export type Association = z.infer<typeof Association>;

/** Where a highlight came from on the page, for later re-anchoring. */
export const SelectionContext = z.object({
  paragraph: z.string().nullish(),
  anchor: z.string().nullish(), // a CSS selector or xpath
});
export type SelectionContext = z.infer<typeof SelectionContext>;

/**
 * What a client POSTs to create a capture. Server-managed fields (id, status,
 * blob storage, enrichment, timestamps) are NOT part of this. Unknown keys are
 * stripped, so clients can send forward-compatible extras safely.
 * For screenshot/image the bytes arrive as a multipart `blob` part alongside a
 * `meta` part carrying this JSON.
 */
export const CaptureIngest = z.object({
  type: CaptureType,
  sourceUrl: z.string().nullish(),
  sourceTitle: z.string().nullish(),
  faviconUrl: z.string().nullish(),
  selectionText: z.string().nullish(),
  selectionContext: SelectionContext.nullish(),
  noteText: z.string().nullish(),
  srcUrl: z.string().nullish(), // image type: the remote image URL
  width: z.number().int().nullish(),
  height: z.number().int().nullish(),
  capturedAt: z.number().int().nullish(), // client clock (ms epoch)
});
export type CaptureIngest = z.infer<typeof CaptureIngest>;

/** The full capture as returned by read endpoints. */
export const Capture = z.object({
  id: z.string(),
  type: CaptureType,
  status: CaptureStatus,
  sourceUrl: z.string().nullable(),
  sourceTitle: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  selectionText: z.string().nullable(),
  selectionContext: SelectionContext.nullable(),
  noteText: z.string().nullable(),
  // blob metadata (bytes are served from the blob endpoint, never inlined)
  blobMime: z.string().nullable(),
  blobBytes: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  hasBlob: z.boolean(),
  hasThumb: z.boolean(),
  // enrichment outputs
  ocrText: z.string().nullable(),
  description: z.string().nullable(),
  summary: z.string().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  associations: z.array(Association),
  articleText: z.string().nullable(),
  lang: z.string().nullable(),
  model: z.string().nullable(),
  enrichError: z.string().nullable(),
  enrichAttempts: z.number(),
  // ownership / time
  deviceId: z.string().nullable(),
  capturedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  enrichedAt: z.number().nullable(),
});
export type Capture = z.infer<typeof Capture>;

/** What the bb worker PATCHes back after enriching a capture. */
export const EnrichmentResult = z.object({
  ocrText: z.string().nullish(),
  description: z.string().nullish(),
  summary: z.string().nullish(),
  category: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  associations: z.array(Association).nullish(),
  articleText: z.string().nullish(),
  lang: z.string().nullish(),
  model: z.string().nullish(),
  status: z.enum(["done", "failed"]).nullish(),
  error: z.string().nullish(),
});
export type EnrichmentResult = z.infer<typeof EnrichmentResult>;

/** User edits from the Library UI. */
export const CapturePatch = z.object({
  tags: z.array(z.string()).nullish(),
  category: z.string().nullish(),
  noteText: z.string().nullish(),
  summary: z.string().nullish(),
});
export type CapturePatch = z.infer<typeof CapturePatch>;
