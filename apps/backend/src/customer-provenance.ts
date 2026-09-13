const PROVENANCE_KEYS = [
  "schemaVersion", "captureMethod", "pageUrl", "canonicalUrl", "pageTitle", "siteName",
  "description", "authors", "publishedAt", "modifiedAt", "language", "leadImageUrl",
  "faviconUrl", "targetUrl", "headings", "capturedAt", "extractedAt", "extractorVersion",
  "contentHash", "extractionStatus", "extractionError", "sourceApplication",
  "originalFileName", "declaredMime", "byteSize",
] as const;
const REQUIRED_PROVENANCE_KEYS = PROVENANCE_KEYS.slice(0, 21);

const METHODS = new Set([
  "popup-save-page", "keyboard-save-page", "context-selection", "context-link", "context-image",
  "popup-highlight", "keyboard-highlight", "popup-region", "keyboard-region", "popup-full-page",
  "keyboard-full-page", "context-save-page", "context-region", "context-full-page",
  "extension-note", "library-note", "twitter-action", "bookmark-import",
  "agent-create",
  "ios-share-url", "ios-share-text", "ios-share-image", "ios-share-video",
  "ios-share-audio", "ios-share-document", "ios-share-file", "ios-app-note",
  "android-share-url", "android-share-text", "android-share-image", "android-share-video",
  "android-share-audio", "android-share-document", "android-share-file",
]);

export type ProcessingOptions = { ocr: boolean; summaries: boolean; tags: boolean };
export const DEFAULT_PROCESSING_OPTIONS: ProcessingOptions = Object.freeze({ ocr: true, summaries: true, tags: true });

export type CaptureProvenance = {
  schemaVersion: 1;
  captureMethod: string;
  pageUrl: string | null;
  canonicalUrl: string | null;
  pageTitle: string | null;
  siteName: string | null;
  description: string | null;
  authors: string[];
  publishedAt: string | null;
  modifiedAt: string | null;
  language: string | null;
  leadImageUrl: string | null;
  faviconUrl: string | null;
  targetUrl: string | null;
  headings: string[];
  capturedAt: number;
  extractedAt: number;
  extractorVersion: number;
  contentHash: string | null;
  extractionStatus: "complete" | "partial";
  extractionError: string | null;
  sourceApplication?: string | null;
  originalFileName?: string | null;
  declaredMime?: string | null;
  byteSize?: number | null;
};

export class ProvenanceValidationError extends Error {}
type JsonObject = Record<string, unknown>;

function exactObject(value: unknown, name: string, keys: readonly string[], required = keys): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProvenanceValidationError(`${name} must be an object.`);
  const row = value as JsonObject;
  const unknown = Object.keys(row).find((key) => !keys.includes(key));
  if (unknown) throw new ProvenanceValidationError(`${name}.${unknown} is not supported.`);
  const missing = required.find((key) => !(key in row));
  if (missing) throw new ProvenanceValidationError(`${name}.${missing} is required.`);
  return row;
}

function nullableText(row: JsonObject, key: string, max: number): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string" || value.length > max) throw new ProvenanceValidationError(`${key} is invalid or too long.`);
  return value.trim() || null;
}

function safeUrl(row: JsonObject, key: string): string | null {
  const value = nullableText(row, key, 4096);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new ProvenanceValidationError(`${key} must be a credential-free HTTP or HTTPS URL.`);
  }
}

function textList(row: JsonObject, key: string, count: number, length: number): string[] {
  const value = row[key];
  if (!Array.isArray(value) || value.length > count) throw new ProvenanceValidationError(`${key} contains too many values.`);
  return value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.length > length) throw new ProvenanceValidationError(`${key} contains an invalid value.`);
    return item.trim();
  });
}

function date(row: JsonObject, key: string): string | null {
  const value = nullableText(row, key, 64);
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) throw new ProvenanceValidationError(`${key} must be an ISO date.`);
  return parsed.toISOString();
}

function timestamp(row: JsonObject, key: string, fallback: number) {
  const value = row[key] ?? fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > Date.now() + 86_400_000) {
    throw new ProvenanceValidationError(`${key} must be a valid millisecond timestamp.`);
  }
  return value as number;
}

export function normalizeProvenance(input: unknown, capturedAt: number): CaptureProvenance | null {
  if (input === undefined || input === null) return null;
  const row = exactObject(input, "provenance", PROVENANCE_KEYS, REQUIRED_PROVENANCE_KEYS);
  if (row.schemaVersion !== 1) throw new ProvenanceValidationError("provenance.schemaVersion is not supported.");
  if (typeof row.captureMethod !== "string" || !METHODS.has(row.captureMethod)) throw new ProvenanceValidationError("captureMethod is not supported.");
  if (!Number.isInteger(row.extractorVersion) || (row.extractorVersion as number) < 1 || (row.extractorVersion as number) > 1000) throw new ProvenanceValidationError("extractorVersion is invalid.");
  const contentHash = nullableText(row, "contentHash", 64);
  if (contentHash && !/^[A-Za-z0-9_-]{43}$/.test(contentHash)) throw new ProvenanceValidationError("contentHash must be a SHA-256 base64url value.");
  if (!new Set(["complete", "partial"]).has(row.extractionStatus as string)) throw new ProvenanceValidationError("extractionStatus is invalid.");
  const language = nullableText(row, "language", 35);
  if (language && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) throw new ProvenanceValidationError("language is invalid.");
  const normalized: CaptureProvenance = {
    schemaVersion: 1,
    captureMethod: row.captureMethod,
    pageUrl: safeUrl(row, "pageUrl"),
    canonicalUrl: safeUrl(row, "canonicalUrl"),
    pageTitle: nullableText(row, "pageTitle", 1000),
    siteName: nullableText(row, "siteName", 300),
    description: nullableText(row, "description", 2000),
    authors: textList(row, "authors", 8, 200),
    publishedAt: date(row, "publishedAt"),
    modifiedAt: date(row, "modifiedAt"),
    language,
    leadImageUrl: safeUrl(row, "leadImageUrl"),
    faviconUrl: safeUrl(row, "faviconUrl"),
    targetUrl: safeUrl(row, "targetUrl"),
    headings: textList(row, "headings", 20, 500),
    capturedAt: timestamp(row, "capturedAt", capturedAt),
    extractedAt: timestamp(row, "extractedAt", capturedAt),
    extractorVersion: row.extractorVersion as number,
    contentHash,
    extractionStatus: row.extractionStatus as CaptureProvenance["extractionStatus"],
    extractionError: nullableText(row, "extractionError", 500),
  };
  if ("sourceApplication" in row) {
    const value = nullableText(row, "sourceApplication", 300);
    if (value && !/^[A-Za-z0-9.-]+$/.test(value)) throw new ProvenanceValidationError("sourceApplication is invalid.");
    normalized.sourceApplication = value;
  }
  if ("originalFileName" in row) {
    const value = nullableText(row, "originalFileName", 500);
    normalized.originalFileName = value ? value.split(/[\\/]/).at(-1)!.trim() || null : null;
  }
  if ("declaredMime" in row) {
    const value = nullableText(row, "declaredMime", 255);
    if (value && !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(value)) throw new ProvenanceValidationError("declaredMime is invalid.");
    normalized.declaredMime = value?.toLowerCase() || null;
  }
  if ("byteSize" in row) {
    const value = row.byteSize;
    if (value !== null && (!Number.isSafeInteger(value) || (value as number) < 0)) throw new ProvenanceValidationError("byteSize is invalid.");
    normalized.byteSize = value as number | null;
  }
  return normalized;
}

export function normalizeProcessingOptions(input: unknown): ProcessingOptions {
  if (input === undefined || input === null) return { ...DEFAULT_PROCESSING_OPTIONS };
  const row = exactObject(input, "processingOptions", ["ocr", "summaries", "tags"]);
  for (const key of ["ocr", "summaries", "tags"] as const) {
    if (typeof row[key] !== "boolean") throw new ProvenanceValidationError(`processingOptions.${key} must be true or false.`);
  }
  return { ocr: row.ocr as boolean, summaries: row.summaries as boolean, tags: row.tags as boolean };
}

export function parseStoredJson<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; }
  catch { return fallback; }
}
