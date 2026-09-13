import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  closeSync, createWriteStream, mkdirSync, openSync, readSync, renameSync,
  rmSync, statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export const MAX_CUSTOMER_FILE_BYTES = 50 * 1024 * 1024;
const MAX_METADATA_HEADER = 16 * 1024;

export class CustomerFileError extends Error {
  constructor(
    readonly status: 400 | 413 | 415 | 503,
    readonly code: string,
    message: string,
  ) { super(message); }
}

export function decodeCaptureHeader(raw: string | null): Record<string, unknown> {
  if (!raw || raw.length > Math.ceil(MAX_METADATA_HEADER / 3) * 4 + 8 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new CustomerFileError(400, "invalid_file_metadata", "The shared item metadata is invalid.");
  }
  try {
    const decoded = Buffer.from(raw, "base64url");
    if (decoded.byteLength > MAX_METADATA_HEADER || decoded.toString("base64url") !== raw) throw new Error();
    const value = JSON.parse(decoded.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new CustomerFileError(400, "invalid_file_metadata", "The shared item metadata is invalid.");
  }
}

export function safeFileName(raw: unknown): string {
  if (typeof raw !== "string") return "Shared file";
  const leaf = raw.split(/[\\/]/).at(-1) || "";
  const cleaned = leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return "Shared file";
  const bytes = Buffer.from(cleaned);
  if (bytes.byteLength <= 240) return cleaned;
  let value = bytes.subarray(0, 240).toString("utf8").replace(/\uFFFD+$/g, "").trim();
  return value || "Shared file";
}

function sniffMime(path: string, declared: string): string {
  const descriptor = openSync(path, "r");
  const head = Buffer.alloc(64);
  let bytes = 0;
  try { bytes = readSync(descriptor, head, 0, head.length, 0); } finally { closeSync(descriptor); }
  const data = head.subarray(0, bytes);
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (data.length >= 5 && data.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WAVE") return "audio/wav";
  if (data.length >= 3 && data.toString("ascii", 0, 3) === "ID3") return "audio/mpeg";
  if (data.length >= 2 && data[0] === 0xff && (data[1]! & 0xe0) === 0xe0) return declared === "audio/aac" ? "audio/aac" : "audio/mpeg";
  if (data.length >= 12 && data.toString("ascii", 4, 8) === "ftyp") {
    const brand = data.toString("ascii", 8, 12).toLowerCase();
    if (declared.startsWith("audio/") || brand.includes("m4a")) return "audio/mp4";
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }
  return "application/octet-stream";
}

export interface StoredCustomerFile {
  root: string;
  absolutePath: string;
  relativePath: string;
  bytes: number;
  mime: string;
  sha256: string;
}

export async function writeCustomerFile(
  request: Request,
  options: { root: string; maxBytes?: number; deadlineMs?: number; namespace?: "remote" },
): Promise<StoredCustomerFile> {
  const maxBytes = options.maxBytes ?? MAX_CUSTOMER_FILE_BYTES;
  const declaredLength = request.headers.get("content-length");
  if (!declaredLength || !/^\d+$/.test(declaredLength)) throw new CustomerFileError(400, "file_length_required", "Send the exact file length.");
  const expected = Number(declaredLength);
  if (!Number.isSafeInteger(expected) || expected <= 0) throw new CustomerFileError(400, "invalid_file_length", "The file length is invalid.");
  if (expected > maxBytes) throw new CustomerFileError(413, "file_too_large", "Files must be 50 MiB or smaller.");
  const declared = (request.headers.get("content-type") || "application/octet-stream").split(";", 1)[0]!.trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(declared)) throw new CustomerFileError(415, "invalid_file_type", "The file content type is invalid.");
  if (!request.body) throw new CustomerFileError(400, "file_required", "Choose a file to save.");

  const root = resolve(options.root);
  // Internal callers may select only the fixed remote namespace, never a supplied path.
  const directory = options.namespace === "remote" ? join(root, "customer-files", "remote") : join(root, "customer-files");
  const temporaryDirectory = join(directory, ".tmp");
  const month = new Date().toISOString().slice(0, 7);
  const finalDirectory = join(directory, month);
  mkdirSync(temporaryDirectory, { recursive: true });
  mkdirSync(finalDirectory, { recursive: true });
  const temporaryPath = join(temporaryDirectory, `${randomUUID()}.upload`);
  const absolutePath = join(finalDirectory, randomUUID());
  const reader = request.body.getReader();
  const writer = createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 });
  const digest = createHash("sha256");
  let bytes = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new CustomerFileError(503, "file_timeout", "The upload took too long. Try again.")), options.deadlineMs ?? 30_000);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new CustomerFileError(413, "file_too_large", "Files must be 50 MiB or smaller.");
      digest.update(value);
      if (!writer.write(value)) await Promise.race([once(writer, "drain"), deadline]);
    }
    writer.end();
    await Promise.race([once(writer, "finish"), deadline]);
    if (bytes !== expected || statSync(temporaryPath).size !== expected) throw new CustomerFileError(400, "file_length_mismatch", "The uploaded file length does not match its declaration.");
    const mime = sniffMime(temporaryPath, declared);
    renameSync(temporaryPath, absolutePath);
    const relativePath = relative(root, absolutePath).replaceAll("\\", "/");
    return { root, absolutePath, relativePath, bytes, mime, sha256: digest.digest("base64url") };
  } catch (error) {
    writer.destroy();
    rmSync(temporaryPath, { force: true });
    if (error instanceof CustomerFileError) throw error;
    throw new CustomerFileError(400, "file_interrupted", "The file upload was interrupted. Try again.");
  } finally {
    if (timeout) clearTimeout(timeout);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function resolveCustomerFile(root: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath) || !relativePath.replaceAll("\\", "/").startsWith("customer-files/")) {
    throw new CustomerFileError(400, "invalid_file_path", "The stored file path is invalid.");
  }
  const base = resolve(root, "customer-files");
  const path = resolve(root, relativePath);
  if (path !== base && !path.startsWith(base + "/")) throw new CustomerFileError(400, "invalid_file_path", "The stored file path is invalid.");
  return path;
}

export function removeCustomerFile(root: string, relativePath: string | null | undefined): void {
  if (!relativePath) return;
  try { rmSync(resolveCustomerFile(root, relativePath), { force: true }); } catch {}
}

export function fileDisposition(mime: string, name: string): string {
  const inline = mime === "application/pdf" || mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/");
  return `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(safeFileName(name))}`;
}

/** Call only after checking capture ownership. A single range supports private media seeking. */
export function customerFileResponse(file:ReturnType<typeof Bun.file>,mime:string,name:string,range:string|null):Response {
  const size=file.size;
  const headers=new Headers({
    'Content-Type':mime,'Content-Disposition':fileDisposition(mime,name),
    'Content-Security-Policy':"default-src 'none'; sandbox",'Cross-Origin-Resource-Policy':'same-origin',
    'Accept-Ranges':'bytes','Content-Length':String(size),
  });
  if(!range)return new Response(file.stream(),{headers});
  const match=/^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start=0,end=size-1,valid=!!match&&(!!match[1]||!!match[2]);
  if(valid&&match){
    if(!match[1]){
      const suffix=Number(match[2]);valid=Number.isSafeInteger(suffix)&&suffix>0;start=Math.max(0,size-suffix);
    }else{
      start=Number(match[1]);const requestedEnd=match[2]?Number(match[2]):size-1;
      valid=Number.isSafeInteger(start)&&Number.isSafeInteger(requestedEnd)&&start<size&&requestedEnd>=start;
      end=Math.min(requestedEnd,size-1);
    }
  }
  if(!valid||!size){headers.set('Content-Range',`bytes */${size}`);headers.set('Content-Length','0');return new Response(null,{status:416,headers});}
  headers.set('Content-Range',`bytes ${start}-${end}/${size}`);headers.set('Content-Length',String(end-start+1));
  return new Response(file.slice(start,end+1).stream(),{status:206,headers});
}
