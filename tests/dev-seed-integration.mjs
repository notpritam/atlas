import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {seedDemo,validateTarget} from '../scripts/seed-dev.mjs';
const origin=process.env.FOUNDKEEP_WEB_TEST_URL||'http://127.0.0.1:18791',stateDir=process.env.FOUNDKEEP_DEMO_TEST_STATE;

test('dev seed reruns preserve edits, deleted entries, moderation and unfollows',{skip:!stateDir},async t=>{
 validateTarget(origin,stateDir,true);
 await seedDemo({origin,stateDir,localTest:true});
 const state=JSON.parse(await readFile(path.join(stateDir,'state.json'),'utf8'));
 assert.equal((await stat(path.join(stateDir,'state.json'))).mode&0o777,0o600);
 async function client(key){
  const fixture=state.accounts[key],login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:fixture.email,password:fixture.password})});assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).find(v=>v.startsWith('atlas_session='));assert.ok(cookie);
  const request=async(route,method='GET',body)=>{const r=await fetch(origin+'/api'+route,{method,headers:{Origin:origin,Cookie:cookie,'X-Atlas-Account':fixture.id,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok,`${method} ${route}: ${r.status}`);return r.json();};
  t.after(()=>request('/auth/logout','POST',{}));return request;
 }
 const curator=await client('curator'),contributor=await client('contributor'),privateId=state.collections['demo-private-scratchpad'],agentId=state.collections['demo-agent-toolkit'],designId=state.collections['demo-design-that-works'];
 const initialGraph=await curator('/graph');assert.equal(initialGraph.edges.filter(edge=>edge.kind==='agent').length,9);assert.ok(initialGraph.nodes.some(node=>node.kind==='tag'));assert.equal((await curator('/agents')).agents.length,0);
 const removedGraphId=Object.values(state.graph.saves)[0];await curator('/captures/'+removedGraphId,'DELETE');
 await curator('/collections/'+privateId,'PATCH',{title:'A tester renamed this private collection'});
 const privateEntries=(await curator('/collections/'+privateId)).entries;
 for(const entry of privateEntries)await curator(`/collections/${privateId}/entries/${entry.id}`,'DELETE');
 await curator(`/collections/${agentId}/entries/${state.pendingEntry}/moderate`,'POST',{status:'rejected'});
 await contributor(`/collections/${designId}/follow`,'DELETE');
 const repeat=await seedDemo({origin,stateDir,localTest:true});assert.equal(repeat.createdCollections,0);assert.equal(repeat.createdEntries,0);
 const privateAfter=await curator('/collections/'+privateId);assert.equal(privateAfter.collection.title,'A tester renamed this private collection');assert.equal(privateAfter.entries.length,0);
 assert.equal((await curator('/collections/'+agentId)).entries.find(entry=>entry.id===state.pendingEntry).status,'rejected');
 assert.equal((await contributor('/collections/'+designId)).collection.following,false);
 const finalGraph=await curator('/graph');assert.ok(!finalGraph.nodes.some(node=>node.saveId===removedGraphId));assert.equal((await curator('/agents')).agents.length,0);
});
