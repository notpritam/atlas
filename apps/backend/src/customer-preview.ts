import { Resolver } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { BlockList, isIP } from "node:net";

export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
export const PREVIEW_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export class CustomerPreviewError extends Error {
  constructor(readonly status: 404 | 502) { super("Preview unavailable."); }
}
export interface PreviewAddress { address: string; family: 4 | 6 }
export interface PreviewTarget extends PreviewAddress { url: URL }
export interface PreviewUpstream {
  status: number;
  headers: Headers;
  body: AsyncIterable<Uint8Array>;
  cancel(): void;
}
export interface PreviewImage { bytes: Uint8Array; mime: string }
interface PreviewOptions {
  resolve?: (hostname: string, signal: AbortSignal) => Promise<PreviewAddress[]>;
  transport?: (target: PreviewTarget, signal: AbortSignal) => Promise<PreviewUpstream>;
  deadlineMs?: number; maxBytes?: number; maxRedirects?: number;
  maxConcurrent?: number; maxPerAccount?: number;
}

// Use the runtime's IP parser and CIDR matching, not host-string heuristics.
// Conservatively exclude special-purpose IPv4 ranges and IPv6 transition,
// documentation and protocol-assignment ranges. IPv6 must be global unicast.
const privateV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) privateV4.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const specialV6 = new BlockList();
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  specialV6.addSubnet(address, prefix, "ipv6");
}
export function isPublicPreviewAddress(address: string): boolean {
  if (isIP(address) === 4) return !privateV4.check(address, "ipv4");
  if (isIP(address) === 6) return globalV6.check(address, "ipv6") && !specialV6.check(address, "ipv6");
  return false;
}
const hostnameOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, "");

// DTO eligibility is deliberately synchronous. DNS authorization happens again
// at fetch time; eligibility never grants permission to connect to an address.
export function previewSourceUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || !raw || raw.length > 4096) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    const hostname = hostnameOf(url);
    if (!hostname || (isIP(hostname) && !isPublicPreviewAddress(hostname))) return null;
    url.hash = "";
    return url;
  } catch { return null; }
}

export async function resolvePublicHost(hostname: string, signal: AbortSignal): Promise<PreviewAddress[]> {
  const resolver = new Resolver({ timeout: 1500, tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw new CustomerPreviewError(502);
    const answers = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
    const addresses: PreviewAddress[] = [];
    for (const [index, answer] of answers.entries()) {
      if (answer.status === "fulfilled") addresses.push(...answer.value.map(address => ({ address, family: (index === 0 ? 4 : 6) as 4 | 6 })));
      // An absent record type is ordinary. A failed query is not proof that the
      // other address family is safe, so timeouts and other DNS failures close.
      else if (!["ENODATA", "ENOTFOUND"].includes(answer.reason?.code)) throw new CustomerPreviewError(502);
    }
    return addresses;
  } finally {
    signal.removeEventListener("abort", cancel);
    resolver.cancel();
  }
}

export function previewRequestOptions(target: PreviewTarget): RequestOptions {
  const hostname = hostnameOf(target.url);
  return {
    protocol: target.url.protocol,
    // Connect directly to the validated address. There is no second lookup,
    // pooled connection or ambient HTTP proxy between validation and connect.
    hostname: target.address, family: target.family,
    port: target.url.protocol === "https:" ? 443 : 80,
    path: target.url.pathname + target.url.search,
    method: "GET", agent: false, maxHeaderSize: 16 * 1024,
    servername: isIP(hostname) ? undefined : hostname,
    rejectUnauthorized: true,
    headers: { Host: target.url.host, "User-Agent": "FoundKeep/1.0 (+https://foundkeep.app)", Accept: "image/png,image/jpeg,image/webp,image/gif", "Accept-Encoding": "identity" },
  };
}

export async function requestPinned(target: PreviewTarget, signal: AbortSignal, accept?: string): Promise<PreviewUpstream> {
  return new Promise((resolve, reject) => {
    const request = (target.url.protocol === "https:" ? httpsRequest : httpRequest)(
      { ...previewRequestOptions(target), ...(accept ? { headers: { ...previewRequestOptions(target).headers, Accept: accept } } : {}), signal },
      response => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        resolve({ status: response.statusCode || 0, headers, body: response, cancel() { response.destroy(); request.destroy(); } });
      },
    );
    request.on("error", reject);
    request.on("upgrade", (_response, socket) => { socket.destroy(); reject(new CustomerPreviewError(502)); });
    request.end();
  });
}

export function validatePreviewImage(bytes: Uint8Array, mime: string, maxBytes = MAX_PREVIEW_BYTES): PreviewImage {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const matches = mime === "image/png" ? data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === "image/jpeg" ? data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255
    : mime === "image/webp" ? data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP"
    : mime === "image/gif" ? ["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6)) : false;
  if (!matches || data.byteLength > maxBytes) throw new CustomerPreviewError(502);
  return { bytes, mime };
}

export function createPreviewFetcher(options: PreviewOptions = {}) {
  const resolve = options.resolve || resolvePublicHost;
  const transport = options.transport || requestPinned;
  const bounded = (value: number | undefined, limit: number) => Number.isSafeInteger(value) && value! > 0 ? Math.min(value!, limit) : limit;
  const maxBytes = bounded(options.maxBytes, MAX_PREVIEW_BYTES);
  const deadlineMs = bounded(options.deadlineMs, 6000);
  const maxRedirects = bounded(options.maxRedirects, 3);
  const maxConcurrent = bounded(options.maxConcurrent, 8);
  const maxPerAccount = bounded(options.maxPerAccount, 4);
  let active = 0;
  const accounts = new Map<string, number>();
  return async (accountId: string, raw: unknown, callerSignal?: AbortSignal): Promise<PreviewImage> => {
    let url = previewSourceUrl(raw);
    if (!url) throw new CustomerPreviewError(404);
    const own = accounts.get(accountId) || 0;
    if (active >= maxConcurrent || own >= maxPerAccount) throw new CustomerPreviewError(502);
    active++; accounts.set(accountId, own + 1);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const timer = setTimeout(cancel, deadlineMs);
    callerSignal?.addEventListener("abort", cancel, { once: true });
    let response: PreviewUpstream | undefined;
    const interrupted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new CustomerPreviewError(502)), { once: true }));
    try {
      if (callerSignal?.aborted) throw new CustomerPreviewError(502);
      for (let redirects = 0; redirects <= maxRedirects; redirects++) {
        const hostname = hostnameOf(url);
        const family = isIP(hostname);
        const addresses = family ? [{ address: hostname, family: family as 4 | 6 }]
          : await Promise.race([resolve(hostname, controller.signal), interrupted]);
        if (!addresses.length || addresses.some(value => isIP(value.address) !== value.family || !isPublicPreviewAddress(value.address))) throw new CustomerPreviewError(502);
        const pending = transport({ url, ...addresses[0]! }, controller.signal);
        // Also dispose an injected/late transport response after cancellation.
        void pending.then(value => { if (controller.signal.aborted) value.cancel(); }, () => {});
        response = await Promise.race([pending, interrupted]);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          response.cancel(); response = undefined;
          if (!location || redirects === maxRedirects) throw new CustomerPreviewError(502);
          const next = previewSourceUrl(new URL(location, url).href);
          if (!next) throw new CustomerPreviewError(502);
          url = next;
          continue;
        }
        const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
        const encoding = response.headers.get("content-encoding");
        const declared = response.headers.get("content-length");
        if (response.status !== 200 || !PREVIEW_MIMES.has(mime) || (encoding && encoding.toLowerCase() !== "identity") ||
          (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes))) throw new CustomerPreviewError(502);
        const chunks: Uint8Array[] = [];
        let size = 0;
        const iterator = response.body[Symbol.asyncIterator]();
        while (true) {
          const { value, done } = await Promise.race([iterator.next(), interrupted]);
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new CustomerPreviewError(502);
          chunks.push(value);
        }
        if (declared !== null && size !== Number(declared)) throw new CustomerPreviewError(502);
        return validatePreviewImage(Buffer.concat(chunks, size), mime, maxBytes);
      }
      throw new CustomerPreviewError(502);
    } catch (error) {
      if (error instanceof CustomerPreviewError) throw error;
      throw new CustomerPreviewError(502);
    } finally {
      response?.cancel();
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", cancel);
      controller.abort();
      active--;
      const remaining = accounts.get(accountId)! - 1;
      if (remaining) accounts.set(accountId, remaining); else accounts.delete(accountId);
    }
  };
}

// One process-wide limiter, shared by every customer router instance.
export const fetchCustomerPreview = createPreviewFetcher();
