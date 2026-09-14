"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDashboard } from "./context";
import { fileBytes } from "../../lib/dashboard";
import "./preserved-source.css";
type Asset = {
  id: string;
  kind: string;
  title: string;
  mime: string;
  bytes: number;
  url: string;
  downloadUrl: string;
  text: string | null;
};
type Preservation = { status: string; error: string | null; assets: Asset[] };
export function PreservedSource({
  id,
  sourceUrl,
}: {
  id: string;
  sourceUrl: string | null | undefined;
}) {
  const { me, request } = useDashboard(),
    cache = useQueryClient();
  const supported =
    !!sourceUrl &&
    /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:[\w]+|i\/web)\/status\/\d+/.test(
      sourceUrl,
    );
  const key = ["preservation", me.account.id, id];
  const query = useQuery({
    queryKey: key,
    enabled: supported,
    queryFn: ({ signal }) =>
      request<{ preservation: Preservation | null }>(
        "/captures/" + encodeURIComponent(id) + "/preservation",
        { signal },
      ),
    refetchInterval: (q) =>
      ["pending", "running"].includes(q.state.data?.preservation?.status || "")
        ? 3000
        : false,
    refetchIntervalInBackground: false,
  });
  const retry = useMutation({
    mutationFn: () =>
      request("/captures/" + encodeURIComponent(id) + "/preservation", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });
  if (!supported) return null;
  const saved = query.data?.preservation,
    working = !!saved && ["pending", "running"].includes(saved.status);
  const status = !saved
    ? "Keep a server copy"
    : saved.status === "ready"
      ? "Source saved"
      : working
        ? "Saving source files…"
        : saved.status === "partial"
          ? "Some source files are unavailable"
          : "Source download interrupted";
  return (
    <section className="preserved-source" aria-label="Preserved source">
      <div className="preserved-heading">
        <h3>{status}</h3>
        {!working && (!saved || saved.status !== "ready") ? (
          <button
            type="button"
            className="button secondary compact"
            disabled={retry.isPending || query.isPending}
            onClick={() => retry.mutate()}
          >
            {retry.isPending
              ? "Queuing…"
              : saved
                ? "Retry remaining files"
                : "Save source files"}
          </button>
        ) : null}
      </div>
      <p className="muted" role="status">
        {saved?.error ||
          (working
            ? "Your post is safe. Available photos, videos and linked articles are being copied to your private library."
            : "Files below are stored by FoundKeep and stay private to your account.")}
      </p>
      {query.isError || retry.isError ? (
        <p role="alert">Source files could not be loaded. Try again.</p>
      ) : null}
      <div className="preserved-assets">
        {saved?.assets.map((asset) => (
          <section className="preserved-asset" key={asset.id}>
            {asset.kind === "image" ? (
              <img
                src={asset.url}
                alt={asset.title}
                loading="lazy"
                decoding="async"
              />
            ) : asset.kind === "video" ? (
              <video src={asset.url} controls preload="metadata" />
            ) : null}
            <div className="preserved-file">
              <span>
                {asset.title}
                <small>{fileBytes(asset.bytes)}</small>
              </span>
              <a href={asset.downloadUrl} className="button secondary compact">
                Download
              </a>
            </div>
            {asset.text ? (
              <details>
                <summary>
                  {asset.kind === "article"
                    ? "Read saved article"
                    : "Read archived post"}
                </summary>
                <p className="preserved-text">{asset.text}</p>
              </details>
            ) : null}
          </section>
        ))}
      </div>
    </section>
  );
}
