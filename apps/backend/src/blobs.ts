import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { sha256hex } from "./ids.ts";

const BLOB_ROOT = join(config.dataDir, "blobs");

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

function extForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? "bin";
}

/** Content-addressed path: blobs/<sha[0:2]>/<sha[2:4]>/<sha>.<ext>. */
function relPathFor(sha256: string, mime: string): string {
  return join(sha256.slice(0, 2), sha256.slice(2, 4), `${sha256}.${extForMime(mime)}`);
}

export function absBlobPath(relPath: string): string {
  return join(BLOB_ROOT, relPath);
}

/**
 * Store bytes content-addressed by sha256. If a file with that hash already
 * exists on disk, the write is skipped (dedupe) and the existing path returned.
 */
export async function storeBlob(
  bytes: Uint8Array,
  mime: string,
): Promise<{ relPath: string; sha256: string; bytes: number }> {
  const sha256 = sha256hex(bytes);
  const relPath = relPathFor(sha256, mime);
  const abs = absBlobPath(relPath);
  const file = Bun.file(abs);
  if (!(await file.exists())) {
    mkdirSync(dirname(abs), { recursive: true });
    await Bun.write(abs, bytes);
  }
  return { relPath, sha256, bytes: bytes.length };
}
