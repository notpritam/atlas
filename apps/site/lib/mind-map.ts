export type MindMapNode={id:string;kind:'save'|'tag';label:string;saveId?:string;type?:string;sourceUrl?:string|null;summary?:string|null;tags?:string[];revision?:number};
export type MindMapEdge={id:string;source:string;target:string;kind:'tag'|'agent'|'hosted'|'manual';label:string};
export type MindMapData={nodes:MindMapNode[];edges:MindMapEdge[];totalSaves:number;matchingSaves:number;shownSaves:number;truncated:boolean;totalTags:number;shownTags:number;focus:string|null;query:string};
