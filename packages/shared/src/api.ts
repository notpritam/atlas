import { z } from "zod";
import { Capture, CaptureStatus, CaptureType } from "./capture.js";

/**
 * Token scopes. A token carries a subset of these; routes are scope-gated.
 *  - ingest : create captures (the browser extension)
 *  - read   : list/search/get captures + blobs (the bb plugin, the future web app)
 *  - enrich : claim the queue + write enrichment results (the bb worker)
 */
export const Scope = z.enum(["ingest", "read", "enrich"]);
export type Scope = z.infer<typeof Scope>;

/** Query params for the list/search endpoint. */
export const ListQuery = z.object({
  type: CaptureType.nullish(),
  status: CaptureStatus.nullish(),
  tag: z.string().nullish(),
  category: z.string().nullish(),
  q: z.string().nullish(), // FTS MATCH query
  cursor: z.string().nullish(), // keyset cursor "<createdAt>_<id>"
  limit: z.number().int().min(1).max(100).nullish(),
});
export type ListQuery = z.infer<typeof ListQuery>;

export const ListResponse = z.object({
  captures: z.array(Capture),
  nextCursor: z.string().nullable(),
});
export type ListResponse = z.infer<typeof ListResponse>;

export const ClaimRequest = z.object({
  owner: z.string(),
  limit: z.number().int().min(1).max(10).default(2),
});
export type ClaimRequest = z.infer<typeof ClaimRequest>;

export const FacetCount = z.object({ name: z.string(), count: z.number() });
export type FacetCount = z.infer<typeof FacetCount>;

export const HealthResponse = z.object({
  ok: z.boolean(),
  service: z.literal("atlas"),
  device: z.string().nullable(),
  pending: z.number(),
  total: z.number(),
  diskBytes: z.number(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** API route paths, centralized so clients never hardcode strings. */
export const routes = {
  health: "/v1/health",
  captures: "/v1/captures",
  capture: (id: string) => `/v1/captures/${id}`,
  blob: (id: string) => `/v1/captures/${id}/blob`,
  thumb: (id: string) => `/v1/captures/${id}/thumb`,
  enrichment: (id: string) => `/v1/captures/${id}/enrichment`,
  claim: "/v1/captures/claim",
  tags: "/v1/tags",
  categories: "/v1/categories",
  graph: "/v1/graph",
  // Admin (mint/list/revoke tokens) — guarded by ATLAS_ADMIN_TOKEN, not a
  // device token, so it sits outside the /v1 Bearer-auth group.
  devices: "/admin/devices",
} as const;
