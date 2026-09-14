import { isIP } from "node:net";
import {
  previewSourceUrl,
  isPublicPreviewAddress,
  resolvePublicHost,
  requestPinned,
  type PreviewAddress,
  type PreviewTarget,
  type PreviewUpstream,
} from "./customer-preview.ts";
export type PublicResource = { url: string; mime: string; data: Buffer };
export type PublicReader = (
  url: string,
  options: { maxBytes: number; signal: AbortSignal; accept?: string },
) => Promise<PublicResource>;
/** Pinned DNS on every redirect, bounded body and wall time, no cookies/auth. */
export function createPublicReader(
  deps: {
    resolve?: (host: string, signal: AbortSignal) => Promise<PreviewAddress[]>;
    transport?: (
      target: PreviewTarget,
      signal: AbortSignal,
      accept?: string,
    ) => Promise<PreviewUpstream>;
  } = {},
): PublicReader {
  return async (raw, options) => {
    const signal = AbortSignal.any([
      options.signal,
      AbortSignal.timeout(15_000),
    ]);
    let response: PreviewUpstream | undefined;
    let cancel: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      cancel = () => {
        response?.cancel();
        reject(new Error("Source request cancelled or timed out."));
      };
      signal.addEventListener("abort", cancel, { once: true });
    });
    try {
      let url = previewSourceUrl(raw);
      if (!url) throw Error("This is not a public source.");
      for (let hop = 0; hop < 4; hop++) {
        signal.throwIfAborted();
        const host = url.hostname.replace(/^\[|\]$/g, ""),
          family = isIP(host);
        const addresses = family
          ? [{ address: host, family: family as 4 | 6 }]
          : await Promise.race([
              (deps.resolve || resolvePublicHost)(host, signal),
              aborted,
            ]);
        if (
          !addresses.length ||
          addresses.some((x) => !isPublicPreviewAddress(x.address))
        )
          throw Error("This is not a public source.");
        response = await Promise.race([
          (deps.transport || requestPinned)(
            { ...addresses[0]!, url },
            signal,
            options.accept || "*/*",
          ),
          aborted,
        ]);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const next = response.headers.get("location");
          response.cancel();
          if (!next) throw Error("Invalid source redirect.");
          url = previewSourceUrl(new URL(next, url).href);
          if (!url) throw Error("This is not a public source.");
          continue;
        }
        if (
          response.status !== 200 ||
          !["", "identity"].includes(
            response.headers.get("content-encoding") || "",
          )
        )
          throw Error("The public source is unavailable.");
        if (
          Number(response.headers.get("content-length") || 0) > options.maxBytes
        )
          throw Error("Source exceeds the size limit.");
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        const iterator = response.body[Symbol.asyncIterator]();
        while (true) {
          signal.throwIfAborted();
          const item = await Promise.race([iterator.next(), aborted]);
          if (item.done) break;
          bytes += item.value.byteLength;
          if (bytes > options.maxBytes)
            throw Error("Source exceeds the size limit.");
          chunks.push(item.value);
        }
        return {
          url: url.href,
          mime: (response.headers.get("content-type") || "")
            .split(";")[0]!
            .trim()
            .toLowerCase(),
          data: Buffer.concat(chunks),
        };
      }
      throw Error("Too many source redirects.");
    } finally {
      signal.removeEventListener("abort", cancel);
      response?.cancel();
    }
  };
}
export const readPublicResource = createPublicReader();
