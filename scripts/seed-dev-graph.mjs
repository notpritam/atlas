import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {demoCollections} from './fixtures/dev-collections.mjs';

export async function seedDemoGraph({state,persist,curator,origin}) {
 state.graph||={saves:{},links:{}};
 const fixtures=demoCollections.filter(collection=>collection.visibility==='public').flatMap(collection=>collection.entries.slice(0,3).map(entry=>({...entry,key:collection.slug+'-'+entry.key})));
 if(fixtures.every(entry=>state.graph.saves[entry.key]&&state.graph.links[entry.key]))return Object.keys(state.graph.saves).length;
 const credential=await curator('/agents','POST',{name:'Temporary dev demo seeder',days:1,scopes:['library:read','library:write']});
 const client=new Client({name:'FoundKeep dev demo seeder',version:'1.0.0'});
 try {
  if(credential.endpoint!==origin+'/api/mcp')throw new Error('Demo MCP endpoint is in a different environment.');
  await client.connect(new StreamableHTTPClientTransport(new URL(credential.endpoint),{requestInit:{headers:{Authorization:'Bearer '+credential.token}}}));
  const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});if(result.isError)throw new Error('Demo agent operation failed: '+name);return JSON.parse(result.content.find(part=>part.type==='text').text);};
  for(const entry of fixtures){
   if(state.graph.saves[entry.key])continue;
   const result=await call('create_save',{clientId:'fk-demo-graph-v1-'+entry.key,type:entry.url?'bookmark':'note',sourceTitle:entry.title,sourceUrl:entry.url||null,noteText:entry.body,userTags:entry.tags});
   state.graph.saves[entry.key]=result.capture.id;await persist();
  }
  const graph=await curator('/graph'),visible=new Set(graph.nodes.filter(node=>node.kind==='save').map(node=>node.saveId));
  for(const [index,entry] of fixtures.entries()){
   if(state.graph.links[entry.key])continue;
   const source=state.graph.saves[entry.key],next=state.graph.saves[fixtures[(index+1)%fixtures.length].key];
   if(visible.has(source)&&visible.has(next)){
    const current=await call('read_save',{id:source});await call('link_saves',{id:source,expectedRevision:current.capture.updatedAt,relatedIds:[next]});
   }
   // A deleted fixture is intentional; never recreate it or restore its connections.
   state.graph.links[entry.key]=true;await persist();
  }
  return Object.keys(state.graph.saves).length;
 } finally {await client.close().catch(()=>{});await curator('/agents/'+credential.id,'DELETE');}
}
