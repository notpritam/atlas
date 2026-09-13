import {createHash} from 'node:crypto';
import type {Database} from 'bun:sqlite';
import type {Hono} from 'hono';
import type {CustomerEnv} from './customer.ts';
import {moduleFail,type CustomerServices} from './customer-modules.ts';
import {foldName} from './customer-organization.ts';

export type CustomerGraphNode={id:string;kind:'save'|'tag';label:string;saveId?:string;type?:string;sourceUrl?:string|null;summary?:string|null;tags?:string[];revision?:number};
export type CustomerGraphEdge={id:string;source:string;target:string;kind:'tag'|'agent'|'hosted'|'manual';label:string};
export type CustomerGraph={nodes:CustomerGraphNode[];edges:CustomerGraphEdge[];totalSaves:number;matchingSaves:number;shownSaves:number;truncated:boolean;totalTags:number;shownTags:number;focus:string|null;query:string};
type GraphOptions={q?:string;focus?:string;limit?:number};
type Save={id:string;type:string;source_title:string|null;source_url:string|null;note_text:string|null;summary:string|null;tags:string;manual_tags:string;updated_at:number};
function tags(raw:string){try{const value:unknown=JSON.parse(raw);return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'&&item.trim().length>0).slice(0,32).map(item=>item.trim().slice(0,40)):[];}catch{return [];}}

/** Only account-owned, bounded metadata is loaded; originals/files never enter the graph. */
export function buildCustomerGraph(db:Database,owner:string,options:GraphOptions={}):CustomerGraph {
 const q=(options.q||'').trim(),focus=options.focus||null,limit=options.limit??200;
 if(q.length>100||!Number.isInteger(limit)||limit<1||limit>200)moduleFail(400,'invalid_graph_query','Use a search up to 100 characters and a limit from 1 to 200.');
 if(focus&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(focus))moduleFail(400,'invalid_graph_focus','Choose a saved item to focus.');
 if(focus&&!db.query('SELECT 1 FROM customer_captures WHERE account_id=? AND id=?').get(owner,focus))moduleFail(404,'not_found','Saved item not found.');
 const where=['c.account_id=?'],bindings:(string|number)[]=[owner];
 if(q){const pattern='%'+q.replace(/[\\%_]/g,value=>'\\'+value)+'%';where.push("(c.source_title LIKE ? ESCAPE '\\' OR c.note_text LIKE ? ESCAPE '\\' OR c.summary LIKE ? ESCAPE '\\' OR c.source_url LIKE ? ESCAPE '\\' OR c.tags LIKE ? ESCAPE '\\' OR c.manual_tags LIKE ? ESCAPE '\\')");bindings.push(...Array(6).fill(pattern));}
 if(focus){where.push(`(c.id=? OR EXISTS(SELECT 1 FROM customer_capture_links l WHERE l.account_id=? AND ((l.source_id=? AND l.target_id=c.id) OR (l.target_id=? AND l.source_id=c.id))))`);bindings.push(focus,owner,focus,focus);}
 const predicate=where.join(' AND ');
 const totalSaves=(db.query('SELECT COUNT(*) n FROM customer_captures WHERE account_id=?').get(owner) as {n:number}).n;
 const matchingSaves=(db.query(`SELECT COUNT(*) n FROM customer_captures c WHERE ${predicate}`).get(...bindings) as {n:number}).n;
 const rows=db.query(`SELECT c.id,c.type,c.source_title,c.source_url,substr(c.note_text,1,120) note_text,substr(c.summary,1,400) summary,c.tags,c.manual_tags,c.updated_at FROM customer_captures c WHERE ${predicate} ORDER BY CASE WHEN c.id=? THEN 0 ELSE 1 END,c.created_at DESC,c.id DESC LIMIT ?`).all(...bindings,focus||'',limit) as Save[];
 const nodes:CustomerGraphNode[]=[],edges:CustomerGraphEdge[]=[],tagNodes=new Map<string,CustomerGraphNode>();
 for(const row of rows){
  const rowTags=[...new Map([...tags(row.manual_tags),...tags(row.tags)].map(tag=>[foldName(tag),tag])).values()];
  nodes.push({id:'save:'+row.id,kind:'save',label:row.source_title||row.note_text||'Saved '+row.type,saveId:row.id,type:row.type,sourceUrl:row.source_url,summary:row.summary,tags:rowTags,revision:row.updated_at});
  for(const tag of rowTags){const key=foldName(tag);let node=tagNodes.get(key);if(!node){node={id:'tag:'+createHash('sha256').update(key).digest('hex').slice(0,24),kind:'tag',label:tag};tagNodes.set(key,node);}
   edges.push({id:`tag:${row.id}:${node.id}`,source:'save:'+row.id,target:node.id,kind:'tag',label:'Tagged '+node.label});
  }
 }
 if(rows.length){
  const placeholders=rows.map(()=>'?').join(','),ids=rows.map(row=>row.id);
  const links=db.query(`SELECT source_id,target_id,origin FROM customer_capture_links WHERE account_id=? AND source_id IN (${placeholders}) AND target_id IN (${placeholders}) AND origin IN ('agent','hosted','manual') ORDER BY source_id,target_id,origin`).all(owner,...ids,...ids) as {source_id:string;target_id:string;origin:'agent'|'hosted'|'manual'}[];
  for(const link of links)edges.push({id:`${link.origin}:${link.source_id}:${link.target_id}`,source:'save:'+link.source_id,target:'save:'+link.target_id,kind:link.origin,label:link.origin==='agent'?'Linked by your agent':link.origin==='hosted'?'Suggested by processing':'Linked by you'});
 }
 const frequency=new Map<string,number>();for(const edge of edges)if(edge.kind==='tag')frequency.set(edge.target,(frequency.get(edge.target)||0)+1);
 const shownTags=[...tagNodes.values()].sort((a,b)=>(frequency.get(b.id)||0)-(frequency.get(a.id)||0)||a.label.localeCompare(b.label)).slice(0,100);
 const shownTagIds=new Set(shownTags.map(tag=>tag.id));nodes.push(...shownTags);
 return {nodes,edges:edges.filter(edge=>edge.kind!=='tag'||shownTagIds.has(edge.target)),totalSaves,matchingSaves,shownSaves:rows.length,truncated:matchingSaves>rows.length,totalTags:tagNodes.size,shownTags:shownTags.length,focus,query:q};
}

export function registerCustomerGraph(app:Hono<CustomerEnv>,db:Database,services:CustomerServices){
 app.get('/graph',c=>{const owner=services.auth(c).account.id;services.rate('graph:'+owner,60,60_000);c.header('Cache-Control','private, no-store');return c.json(buildCustomerGraph(db,owner,{q:c.req.query('q'),focus:c.req.query('focus'),...(c.req.query('limit')?{limit:Number(c.req.query('limit'))}:{})}));});
}
