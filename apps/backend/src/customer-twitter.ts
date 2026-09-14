import {
  readPublicResource,
  type PublicReader,
} from "./customer-public-resource.ts";
import { previewSourceUrl } from "./customer-preview.ts";
export type SocialContext = {
  version: 1;
  images: string[];
  links: string[];
  articleText: string;
};
export type TwitterManifest = {
  text: string;
  author: string;
  publishedAt: string | null;
  media: { kind: "image" | "video"; url: string }[];
  links: string[];
  metadataAvailable: boolean;
  incomplete?: boolean;
};
export function twitterPost(
  raw: string | null | undefined,
): { id: string; url: string } | null {
  try {
    const u = new URL(raw || "");
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      ![
        "x.com",
        "www.x.com",
        "twitter.com",
        "www.twitter.com",
        "mobile.twitter.com",
        "m.twitter.com",
      ].includes(u.hostname)
    )
      return null;
    const match = u.pathname.match(
      /^\/([A-Za-z0-9_]+|i\/web)\/status\/(\d{1,25})(?:\/(?:photo|video)\/\d+)?\/?$/,
    );
    return match
      ? { id: match[2]!, url: `https://x.com/${match[1]}/status/${match[2]}` }
      : null;
  } catch {
    return null;
  }
}
function imageUrl(raw: unknown): string | null {
  try {
    const u = new URL(String(raw));
    if (
      u.protocol !== "https:" ||
      u.hostname !== "pbs.twimg.com" ||
      !u.pathname.startsWith("/media/") ||
      u.username ||
      u.password ||
      u.href.length > 2048
    )
      return null;
    const extension = u.pathname
      .match(/\.(jpg|jpeg|png|webp)$/i)?.[1]
      ?.toLowerCase();
    const format = (extension || u.searchParams.get("format") || "jpg").replace(
      "jpeg",
      "jpg",
    );
    if (!["jpg", "png", "webp"].includes(format)) return null;
    u.pathname = u.pathname.replace(/\.(jpg|jpeg|png|webp)$/i, "");
    u.search = "";
    u.hash = "";
    u.searchParams.set("format", format);
    u.searchParams.set("name", "orig");
    return u.href;
  } catch {
    return null;
  }
}
function videoUrl(raw: unknown): string | null {
  try {
    const u = new URL(String(raw));
    return u.protocol === "https:" &&
      u.hostname === "video.twimg.com" &&
      /\.mp4$/i.test(u.pathname) &&
      !u.username &&
      !u.password &&
      u.href.length <= 4096
      ? u.href
      : null;
  } catch {
    return null;
  }
}
function outbound(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  const url = previewSourceUrl(raw);
  if (!url || /(^|\.)(x\.com|twitter\.com|twimg\.com)$/.test(url.hostname))
    return null;
  return url.href;
}
export function normalizeSocialContext(value: unknown): SocialContext {
  if (value == null)
    return { version: 1, images: [], links: [], articleText: "" };
  if (typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid social context.");
  const v = value as Record<string, unknown>;
  if (
    v.version !== 1 ||
    Object.keys(v).some(
      (k) => !["version", "images", "links", "articleText"].includes(k),
    )
  )
    throw Error("Invalid social context.");
  for (const key of ["images", "links"])
    if (
      v[key] !== undefined &&
      (!Array.isArray(v[key]) ||
        (v[key] as unknown[]).length > 16 ||
        (v[key] as unknown[]).some(
          (x) => typeof x !== "string" || x.length > 4096,
        ))
    )
      throw Error("Too many social attachment hints.");
  if (
    v.articleText !== undefined &&
    (typeof v.articleText !== "string" || v.articleText.length > 100_000)
  )
    throw Error("The visible article is too large.");
  return {
    version: 1,
    images: [
      ...new Set(
        ((v.images || []) as unknown[])
          .map(imageUrl)
          .filter((x): x is string => !!x),
      ),
    ].slice(0, 8),
    links: [
      ...new Set(
        ((v.links || []) as unknown[])
          .map(outbound)
          .filter((x): x is string => !!x),
      ),
    ].slice(0, 3),
    articleText: (v.articleText as string) || "",
  };
}
export function parseTwitterPost(value: unknown, id: string): TwitterManifest {
  const v = value as any;
  if (!v || v.id_str !== id) throw Error("The public post is unavailable.");
  const media: TwitterManifest["media"] = [];
  let incomplete = Array.isArray(v.mediaDetails) && v.mediaDetails.length > 8;
  for (const item of (Array.isArray(v.mediaDetails)
    ? v.mediaDetails
    : []
  ).slice(0, 8)) {
    if (item.type === "photo") {
      const url = imageUrl(item.media_url_https);
      if (url) media.push({ kind: "image", url });
      else incomplete = true;
    } else if (["video", "animated_gif"].includes(item.type)) {
      const variants = (
        Array.isArray(item.video_info?.variants) ? item.video_info.variants : []
      ).filter((x: any) => x.content_type === "video/mp4" && videoUrl(x.url));
      variants.sort(
        (a: any, b: any) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0),
      );
      // Prefer a useful small copy, keeping large originals within bounded budgets.
      const selected =
        variants.find((x: any) => (Number(x.bitrate) || 0) <= 2_500_000) ||
        variants.at(-1);
      if (selected) media.push({ kind: "video", url: videoUrl(selected.url)! });
      else incomplete = true;
    }
  }
  const links = (Array.isArray(v.entities?.urls) ? v.entities.urls : [])
    .map((x: any) => outbound(x.expanded_url || x.url))
    .filter((x: string | null): x is string => !!x);
  return {
    text: typeof v.text === "string" ? v.text.slice(0, 50_000) : "",
    author:
      typeof v.user?.name === "string"
        ? `${v.user.name.slice(0, 200)}${typeof v.user.screen_name === "string" ? ` (@${v.user.screen_name.slice(0, 50)})` : ""}`
        : "",
    publishedAt:
      typeof v.created_at === "string" ? v.created_at.slice(0, 100) : null,
    media,
    links: [...new Set<string>(links)].slice(0, 3),
    metadataAvailable: true,
    incomplete: incomplete || links.length > 3 || !!v.article,
  };
}
export async function resolveTwitterPost(
  url: string,
  hints: SocialContext,
  signal: AbortSignal,
  read: PublicReader = readPublicResource,
): Promise<TwitterManifest> {
  const post = twitterPost(url);
  if (!post) throw Error("Use an X post permalink.");
  let result: TwitterManifest = {
    text: "",
    author: "",
    publishedAt: null,
    media: [],
    links: [],
    metadataAvailable: false,
  };
  try {
    // Same public embed token calculation used by the maintained yt-dlp extractor.
    const token = ((Number(post.id) / 1e15) * Math.PI)
      .toString(36)
      .replace(/(0+|\.)/g, "");
    const response = await read(
      `https://cdn.syndication.twimg.com/tweet-result?id=${post.id}&token=${token}`,
      { maxBytes: 2 * 1024 * 1024, signal, accept: "application/json" },
    );
    result = parseTwitterPost(
      JSON.parse(response.data.toString("utf8")),
      post.id,
    );
  } catch {
    signal.throwIfAborted();
  }
  const seen = new Set(result.media.map((x) => x.url));
  for (const url of hints.images)
    if (!seen.has(url) && result.media.length < 8) {
      result.media.push({ kind: "image", url });
      seen.add(url);
    }
  result.links = [...new Set([...result.links, ...hints.links])].slice(0, 3);
  return result;
}
