import { describe, expect, test } from "bun:test";
import {
  createPreviewFetcher, isPublicPreviewAddress, previewRequestOptions, previewSourceUrl,
  type PreviewTarget, type PreviewUpstream,
} from "./customer-preview.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=", "base64");
const PUBLIC = { address: "93.184.215.14", family: 4 as const };
function upstream(status = 200, headers: Record<string, string> = { "content-type": "image/png" }, chunks: Uint8Array[] = [PNG]): PreviewUpstream {
  return { status, headers: new Headers(headers), body: (async function* () { yield* chunks; })(), cancel() {} };
}

describe("private capture preview proxy", () => {
  test("only globally routable addresses and ordinary HTTP(S) URLs are candidates", () => {
    for (const address of ["127.0.0.1", "0.0.0.0", "10.0.0.1", "100.100.100.200", "169.254.169.254", "172.16.0.1", "192.168.1.1", "192.0.0.9", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1", "::", "::ffff:127.0.0.1", "::ffff:93.184.215.14", "fc00::1", "fe80::1", "ff02::1", "64:ff9b::7f00:1", "2001::1", "2001:db8::1", "2002:7f00:1::", "3fff::1", "not-an-ip"]) {
      expect(isPublicPreviewAddress(address)).toBe(false);
    }
    for (const address of [PUBLIC.address, "1.1.1.1", "2606:4700:4700::1111"]) expect(isPublicPreviewAddress(address)).toBe(true);
    for (const url of [null, "", "file:///etc/passwd", "data:image/png;base64,abc", "https://user:pass@example.com/a.png", "http://127.1/a", "http://0x7f000001/a", "http://[::ffff:127.0.0.1]/a", "https://example.com:8443/a"]) expect(previewSourceUrl(url)).toBeNull();
    expect(previewSourceUrl("https://images.example.com/a.png")?.hostname).toBe("images.example.com");
  });

  test("public image requests carry the validated IP while preserving Host and TLS hostname", async () => {
    const targets: PreviewTarget[] = [];
    const fetchPreview = createPreviewFetcher({
      resolve: async () => [PUBLIC],
      transport: async target => { targets.push(target); return upstream(); },
    });
    const result = await fetchPreview("owner", "https://images.example.com/a.png?size=400");
    expect(result.mime).toBe("image/png");
    expect(Buffer.from(result.bytes)).toEqual(PNG);
    const options = previewRequestOptions(targets[0]!);
    expect(options.hostname).toBe(PUBLIC.address);
    expect(options.servername).toBe("images.example.com");
    expect(options.path).toBe("/a.png?size=400");
    expect(options.headers).toEqual({ Host: "images.example.com", Accept: "image/png,image/jpeg,image/webp,image/gif", "Accept-Encoding": "identity", "User-Agent": "FoundKeep/1.0 (+https://foundkeep.app)" });
    expect(options.agent).toBe(false);
    expect(options.rejectUnauthorized).toBe(true);
  });

  test("private and mixed DNS answers fail before transport", async () => {
    let transported = 0;
    for (const addresses of [[{ address: "127.0.0.1", family: 4 as const }], [PUBLIC, { address: "10.1.2.3", family: 4 as const }], []]) {
      const fetchPreview = createPreviewFetcher({ resolve: async () => addresses, transport: async () => { transported++; return upstream(); } });
      await expect(fetchPreview("owner", "https://images.example.com/a.png")).rejects.toMatchObject({ status: 502 });
    }
    expect(transported).toBe(0);
  });

  test("redirects re-resolve and validate even when the hostname stays the same", async () => {
    let resolves = 0; let transported = 0; let cancelled = 0;
    const fetchPreview = createPreviewFetcher({
      resolve: async () => ++resolves === 1 ? [PUBLIC] : [{ address: "169.254.169.254", family: 4 }],
      transport: async () => { transported++; return { ...upstream(302, { location: "/next.png" }), cancel() { cancelled++; } }; },
    });
    await expect(fetchPreview("owner", "https://images.example.com/a.png")).rejects.toMatchObject({ status: 502 });
    expect(resolves).toBe(2); expect(transported).toBe(1); expect(cancelled).toBe(1);
    for (const location of ["http://127.0.0.1/private", "https://user:pass@images.example.com/a", "file:///etc/passwd"]) {
      const redirected = createPreviewFetcher({ resolve: async () => [PUBLIC], transport: async () => upstream(302, { location }) });
      await expect(redirected("owner", "https://images.example.com/a.png")).rejects.toMatchObject({ status: 502 });
    }
  });

  test("bounded redirects allow a public final raster", async () => {
    let requests = 0;
    const success = createPreviewFetcher({ resolve: async () => [PUBLIC], transport: async () => ++requests === 1 ? upstream(302, { location: "https://cdn.example.com/a.png" }) : upstream() });
    expect((await success("owner", "https://images.example.com/a.png")).mime).toBe("image/png");
    const loop = createPreviewFetcher({ resolve: async () => [PUBLIC], transport: async () => upstream(302, { location: "/loop" }), maxRedirects: 2 });
    await expect(loop("owner", "https://images.example.com/a.png")).rejects.toMatchObject({ status: 502 });
  });

  test("oversized, encoded, non-raster and disguised HTML bodies are unavailable", async () => {
    const cases = [
      upstream(200, { "content-type": "image/png", "content-length": "1000" }),
      upstream(200, { "content-type": "image/png" }, [PNG, new Uint8Array(80)]),
      upstream(200, { "content-type": "image/svg+xml" }, [Buffer.from("<svg/>")]),
      upstream(200, { "content-type": "text/html" }),
      upstream(200, { "content-type": "image/png" }, [Buffer.from("<html>not an image</html>")]),
      upstream(200, { "content-type": "image/png", "content-encoding": "gzip" }),
      upstream(404),
    ];
    for (const response of cases) {
      const fetchPreview = createPreviewFetcher({ resolve: async () => [PUBLIC], transport: async () => response, maxBytes: 100 });
      await expect(fetchPreview("owner", "https://images.example.com/a.png")).rejects.toMatchObject({ status: 502 });
    }
  });

  test("one deadline covers stalled DNS, transport and streamed bodies", async () => {
    for (const stage of ["dns", "transport", "body"]) {
      let cancelled = false;
      const fetchPreview = createPreviewFetcher({ deadlineMs: 15,
        resolve: async () => stage === "dns" ? await new Promise(() => {}) : [PUBLIC],
        transport: async () => stage === "transport" ? await new Promise(() => {}) : {
          ...upstream(), body: (async function* () { await new Promise(() => {}); yield PNG; })(), cancel() { cancelled = true; },
        },
      });
      await expect(fetchPreview("owner", "https://images.example.com/a.png")).rejects.toMatchObject({ status: 502 });
      if (stage === "body") expect(cancelled).toBe(true);
    }
  });

  test("concurrency is bounded and cancellation releases the account slot", async () => {
    let block = true;
    const controller = new AbortController();
    const fetchPreview = createPreviewFetcher({ maxConcurrent: 1, maxPerAccount: 1,
      resolve: async () => [PUBLIC], transport: async () => block ? await new Promise(() => {}) : upstream(),
    });
    const first = fetchPreview("owner", "https://images.example.com/a.png", controller.signal);
    await expect(fetchPreview("owner", "https://images.example.com/a.png")).rejects.toMatchObject({ status: 502 });
    await expect(fetchPreview("another-owner", "https://images.example.com/a.png")).rejects.toMatchObject({ status: 502 });
    controller.abort();
    await expect(first).rejects.toMatchObject({ status: 502 });
    block = false;
    expect((await fetchPreview("owner", "https://images.example.com/a.png")).mime).toBe("image/png");
    await expect(fetchPreview("owner", null)).rejects.toMatchObject({ status: 404 });
  });
});
