import type { Database } from "bun:sqlite";

export type GraphNodeKind = "capture" | "tag" | "category";
export type GraphEdgeKind = "tag" | "category" | "assoc";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  refId: string;
  degree: number;
}
export interface GraphEdge {
  source: string;
  target: string;
  kind: GraphEdgeKind;
}
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function safeArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/** Capture ↔ tag ↔ category ↔ association graph (for the future web app). */
export function buildCaptureGraph(db: Database): Graph {
  const rows = db
    .query(
      "SELECT id, source_title, note_text, selection_text, category, tags, associations FROM captures",
    )
    .all() as {
    id: string;
    source_title: string | null;
    note_text: string | null;
    selection_text: string | null;
    category: string | null;
    tags: string | null;
    associations: string | null;
  }[];

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const degree = new Map<string, number>();
  const seen = new Set<string>();

  const addNode = (
    id: string,
    kind: GraphNodeKind,
    label: string,
    refId: string,
  ) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, refId, degree: 0 });
  };
  const addEdge = (source: string, target: string, kind: GraphEdgeKind) => {
    if (source === target) return;
    const key = `${source}|${target}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, kind });
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  };

  for (const r of rows) {
    const cid = `c:${r.id}`;
    const label =
      r.source_title ||
      (r.note_text ?? r.selection_text ?? "").slice(0, 40) ||
      r.id;
    addNode(cid, "capture", label, r.id);
    for (const tag of safeArray<string>(r.tags)) {
      addNode(`t:${tag}`, "tag", `#${tag}`, tag);
      addEdge(cid, `t:${tag}`, "tag");
    }
    if (r.category) {
      addNode(`cat:${r.category}`, "category", r.category, r.category);
      addEdge(cid, `cat:${r.category}`, "category");
    }
    for (const a of safeArray<{ targetId?: string | null }>(r.associations)) {
      if (a?.targetId) addEdge(cid, `c:${a.targetId}`, "assoc");
    }
  }

  return {
    nodes: [...nodes.values()].map((n) => ({
      ...n,
      degree: degree.get(n.id) ?? 0,
    })),
    edges,
  };
}
