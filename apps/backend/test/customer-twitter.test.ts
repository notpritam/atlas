import { expect, test } from "bun:test";
import {
  twitterPost,
  parseTwitterPost,
  normalizeSocialContext,
} from "../src/customer-twitter.ts";
import { createPublicReader } from "../src/customer-public-resource.ts";
test("canonicalizes a single post without accepting lookalike hosts or credentials", () => {
  expect(
    twitterPost("https://twitter.com/nasa/status/12345/photo/1?x=1"),
  ).toEqual({ id: "12345", url: "https://x.com/nasa/status/12345" });
  for (const url of [
    "https://x.com.evil.test/nasa/status/12345",
    "https://user@x.com/nasa/status/12345",
    "https://x.com/nasa",
    "file:///tmp/a",
  ])
    expect(twitterPost(url)).toBeNull();
});
test("extracts only the requested post media, ordered photos/video and outbound articles", () => {
  const result = parseTwitterPost(
    {
      id_str: "12345",
      text: "A post",
      user: { name: "Mina", screen_name: "mina" },
      mediaDetails: [
        { type: "photo", media_url_https: "https://pbs.twimg.com/media/a.jpg" },
        {
          type: "video",
          video_info: {
            variants: [
              {
                content_type: "video/mp4",
                bitrate: 832000,
                url: "https://video.twimg.com/ext_tw_video/a/vid/640x360/a.mp4",
              },
              {
                content_type: "application/x-mpegURL",
                url: "https://video.twimg.com/a.m3u8",
              },
            ],
          },
        },
      ],
      entities: { urls: [{ expanded_url: "https://example.org/read" }] },
      quoted_tweet: {
        text: "Private neighboring text",
        mediaDetails: [
          {
            type: "photo",
            media_url_https: "https://pbs.twimg.com/media/quoted.jpg",
          },
        ],
      },
    },
    "12345",
  );
  expect(result.text).toBe("A post");
  expect(result.media.map((x) => x.kind)).toEqual(["image", "video"]);
  expect(JSON.stringify(result)).not.toContain("quoted.jpg");
  expect(result.links).toEqual(["https://example.org/read"]);
  expect(() => parseTwitterPost({ id_str: "other" }, "12345")).toThrow();
});
test("untrusted browser hints are bounded, normalized and cannot request private or arbitrary media", () => {
  const value = normalizeSocialContext({
    version: 1,
    images: [
      "https://pbs.twimg.com/media/a.jpg",
      "http://127.0.0.1/a",
      "https://evil.example/a.jpg",
    ],
    links: ["https://example.org/a", "file:///etc/passwd"],
    articleText: "Visible article",
  });
  expect(value.images).toHaveLength(1);
  expect(value.links).toEqual(["https://example.org/a"]);
  expect(value.articleText).toBe("Visible article");
  expect(() =>
    normalizeSocialContext({ version: 1, images: Array(100).fill("x") }),
  ).toThrow();
});
test("public reader blocks mixed/private DNS and private redirects before transport", async () => {
  let requests = 0;
  const read = createPublicReader({
    resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    transport: async () => {
      requests++;
      throw Error("must not run");
    },
  });
  await expect(
    read("https://example.org/a", {
      maxBytes: 100,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow();
  expect(requests).toBe(0);
  const redirected = createPublicReader({
    resolve: async () => [{ address: "1.1.1.1", family: 4 }],
    transport: async () => {
      requests++;
      return {
        status: 302,
        headers: new Headers({ location: "http://127.0.0.1/private" }),
        body: (async function* () {})(),
        cancel() {},
      };
    },
  });
  await expect(
    redirected("https://example.org/a", {
      maxBytes: 100,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow();
  expect(requests).toBe(1);
});

test('photo URL variants deduplicate and unsupported video formats stay explicitly incomplete',()=>{
 const hints=normalizeSocialContext({version:1,images:['https://pbs.twimg.com/media/one.jpg','https://pbs.twimg.com/media/one?format=jpg&name=small']});
 expect(hints.images).toHaveLength(1);
 const value=parseTwitterPost({id_str:'123',mediaDetails:[{type:'video',video_info:{variants:[{content_type:'application/x-mpegURL',url:'https://video.twimg.com/only.m3u8'}]}}]},'123');
 expect(value.media).toHaveLength(0);expect(value.incomplete).toBe(true);
});
