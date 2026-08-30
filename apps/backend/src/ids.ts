import { createHash, randomBytes } from "node:crypto";

/**
 * Lexicographically-sortable id: 8-char base36 ms-timestamp + 12 random hex.
 * Sortable by creation time, collision-safe for a single-user store.
 */
export function ulid(prefix: string): string {
  const time = Date.now().toString(36).padStart(8, "0");
  const rand = randomBytes(6).toString("hex");
  return `${prefix}_${time}${rand}`;
}

export function sha256hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** A high-entropy bearer token (URL-safe, ~43 chars). */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}
