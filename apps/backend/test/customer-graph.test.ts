import {afterEach,beforeEach,expect,test} from 'bun:test';
import {openDb} from '../src/db.ts';
import {createApp} from '../src/app.ts';
import {buildCustomerGraph} from '../src/customer-graph.ts';
let db:ReturnType<typeof openDb>,owner:string,other:string;
function save(account:string,title:string,tags:string[]=[],time=1){const id=crypto.randomUUID();db.query("INSERT INTO customer_captures(id,account_id,client_id,type,status,source_title,manual_tags,storage_bytes,captured_at,created_at,updated_at) VALUES(?,?,?,'bookmark','done',?,?,0,?,?,?)").run(id,account,id,title,JSON.stringify(tags),time,time,time);return id;}
beforeEach(()=>{db=openDb(':memory:');owner=crypto.randomUUID();other=crypto.randomUUID();for(const id of [owner,other])db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,?,'Graph','','',0)").run(id,id+'@example.test');});
afterEach(()=>db.close());
test('graph only includes owned saves and valid owned endpoints, with real tag and link origins',()=>{
 const one=save(owner,'First',['Research','Shared']),two=save(owner,'Second',['research']),foreign=save(other,'Private foreign title',['SECRET']);
 for(const [target,origin] of [[two,'agent'],[two,'hosted'],[foreign,'agent']])db.query('INSERT INTO customer_capture_links(account_id,source_id,target_id,origin,created_at) VALUES(?,?,?,?,1)').run(owner,one,target,origin);
 const graph=buildCustomerGraph(db,owner);expect(graph.totalSaves).toBe(2);expect(graph.nodes.filter(n=>n.kind==='save')).toHaveLength(2);expect(graph.nodes.filter(n=>n.kind==='tag')).toHaveLength(2);expect(graph.edges.filter(e=>e.kind==='agent')).toHaveLength(1);expect(graph.edges.filter(e=>e.kind==='hosted')).toHaveLength(1);expect(JSON.stringify(graph)).not.toContain('SECRET');expect(JSON.stringify(graph)).not.toContain(foreign);
});
test('search applies before bounds, preserves literal wildcards, and focus finds older connected saves',()=>{
 const original=save(owner,'The original 100% reference',['older'],1),linked=save(owner,'Its companion',['older'],2);for(let i=0;i<205;i++)save(owner,'Recent '+i,['recent'],i+3);
 db.query("INSERT INTO customer_capture_links(account_id,source_id,target_id,origin,created_at) VALUES(?,?,?,'agent',1)").run(owner,original,linked);
 const bounded=buildCustomerGraph(db,owner);expect(bounded.shownSaves).toBe(200);expect(bounded.totalSaves).toBe(207);expect(bounded.truncated).toBe(true);
 const filtered=buildCustomerGraph(db,owner,{q:'100%'});expect(filtered.shownSaves).toBe(1);expect(filtered.nodes.some(n=>n.saveId===original)).toBe(true);
 const focused=buildCustomerGraph(db,owner,{focus:original});expect(focused.nodes.filter(n=>n.kind==='save')).toHaveLength(2);expect(focused.edges.some(e=>e.kind==='agent')).toBe(true);
 expect(()=>buildCustomerGraph(db,other,{focus:original})).toThrow('not found');
});
test('graph route requires authentication and does not accept an account id as authority',async()=>{
 save(owner,'Private');const response=await createApp(db).fetch(new Request('https://foundkeep.app/api/graph?accountId='+owner));expect(response.status).toBe(401);
});

test('many unique tags remain bounded and every returned edge has visible endpoints',()=>{
 for(let i=0;i<120;i++)save(owner,'Reference '+i,['shared','topic-'+i],i);
 const graph=buildCustomerGraph(db,owner);expect(graph.totalTags).toBe(121);expect(graph.shownTags).toBe(100);expect(graph.nodes).toHaveLength(220);expect(graph.nodes.some(node=>node.kind==='tag'&&node.label==='shared')).toBe(true);
 const ids=new Set(graph.nodes.map(node=>node.id));expect(graph.edges.every(edge=>ids.has(edge.source)&&ids.has(edge.target))).toBe(true);
});
