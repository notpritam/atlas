import {afterEach,beforeEach,expect,test} from 'bun:test';
import {openDb} from '../src/db.ts';
import {createApp} from '../src/app.ts';
import {createAgentToken,agentAccess} from '../src/customer-agent-access.ts';
import {createMcpOperations} from '../src/customer-mcp.ts';
import {customerChanges} from '../src/customer-changes.ts';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {config} from '../src/config.ts';
let db:ReturnType<typeof openDb>;let owner:string;let capture:string;let token:string;
beforeEach(()=>{
 db=openDb(':memory:');owner=crypto.randomUUID();capture=crypto.randomUUID();
 db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,?,'Agent test','','',0)").run(owner,owner+'@example.com');
 db.query("INSERT INTO customer_captures(id,account_id,client_id,type,status,note_text,storage_bytes,captured_at,created_at,updated_at) VALUES(?,?,?,'note','done','Read me',7,1,1,1)").run(capture,owner,capture);
 token=createAgentToken(db,owner,{name:'My agent',scopes:['library:read','files:read','library:write']}).token;
});
afterEach(()=>db.close());
test('agent tokens are hashed, scoped, expiring and revocable; browser tokens are rejected',async()=>{
 expect(()=>agentAccess(db,'Bearer '+'a'.repeat(43))).toThrow('agent token');
 expect((db.query('SELECT token_hash FROM customer_agent_tokens').get() as any).token_hash).not.toBe(token);
 const reader=createAgentToken(db,owner,{name:'Reader',scopes:['library:read']});
 const ops=createMcpOperations(db,'Bearer '+reader.token);expect(ops.list().some(tool=>tool.name==='organize_save')).toBe(false);
 await expect(ops.call('organize_save',{id:capture,expectedRevision:1,userTags:['test']})).rejects.toThrow('permission');
 db.query('UPDATE customer_agent_tokens SET expires_at=0 WHERE id=?').run(reader.id);expect(()=>agentAccess(db,'Bearer '+reader.token)).toThrow('expired');
 db.query('DELETE FROM customer_agent_tokens').run();expect(()=>agentAccess(db,'Bearer '+token)).toThrow('revoked');
});
test('agent setup returns the configured environment MCP endpoint',()=>{
 const issued=createAgentToken(db,owner,{name:'Dev agent',scopes:['library:read']},'https://dev.foundkeep.app');
 expect(issued.endpoint).toBe('https://dev.foundkeep.app/api/mcp');
 expect(createAgentToken(db,owner,{name:'Default agent',scopes:['library:read']}).endpoint).toBe(config.customerOrigin+'/api/mcp');
});
test('owned reads, revision guarded writes and file chunks cannot reach another account',async()=>{
 const ops=createMcpOperations(db,'Bearer '+token);const other=crypto.randomUUID();
 await expect(ops.call('read_save',{id:other})).rejects.toThrow('not found');
 await expect(ops.call('organize_save',{id:capture,expectedRevision:0,userTags:['test']})).rejects.toThrow('changed');
 await ops.call('organize_save',{id:capture,expectedRevision:1,userTags:['Personal']});
 const save=await ops.call('read_save',{id:capture}) as any;expect(save.capture.userTags).toEqual(['Personal']);expect(save.capture.noteText).toBe('Read me');
 db.query("UPDATE customer_captures SET blob_data=?,blob_mime='image/png' WHERE id=?").run(Buffer.from('0123456789'),capture);
 expect(await ops.call('read_file',{id:capture,offset:2,length:4})).toMatchObject({total:10,nextOffset:6,base64:Buffer.from('2345').toString('base64')});
 await expect(ops.call('read_file',{id:capture,length:1_000_000})).rejects.toThrow('schema');
});
test('changes retain deletions and agent linking advances revisions without altering originals',async()=>{
 const ops=createMcpOperations(db,'Bearer '+token);const second=crypto.randomUUID();
 db.query("INSERT INTO customer_captures(id,account_id,client_id,type,storage_bytes,captured_at,created_at,updated_at) VALUES(?,?,?,'note',0,2,2,2)").run(second,owner,second);
 const first=customerChanges(db,owner,0,1);expect(first.hasMore).toBe(true);
 await ops.call('link_saves',{id:capture,expectedRevision:1,relatedIds:[second]});
 expect((await ops.call('read_save',{id:capture}) as any).links).toHaveLength(1);
 db.query('DELETE FROM customer_captures WHERE id=?').run(second);
 const changes=customerChanges(db,owner,first.cursor);expect(changes.changes.some(item=>item.id===second&&item.operation==='delete')).toBe(true);
 expect((await ops.call('read_save',{id:capture}) as any).links).toHaveLength(0);
});
test('official MCP client initializes, discovers tools, reads resources and calls the private endpoint',async()=>{
 const app=createApp(db);const transport=new StreamableHTTPClientTransport(new URL('https://foundkeep.app/api/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}},fetch:async(input,init)=>await app.fetch(input instanceof Request ? new Request(input,init as RequestInit) : new Request(String(input),init as RequestInit))});
 const client=new Client({name:'Foundkeep integration test',version:'1.0.0'});
 try{
  await client.connect(transport);const tools=await client.listTools();expect(tools.tools.some(tool=>tool.name==='list_saves')).toBe(true);expect(tools.tools.some(tool=>tool.name==='create_save')).toBe(true);
  const result=await client.callTool({name:'read_save',arguments:{id:capture}});expect(result.isError).not.toBe(true);expect(JSON.stringify(result.content)).toContain('Read me');
  const rich=await client.callTool({name:'create_save',arguments:{clientId:'sdk-rich-save',type:'bookmark',articleText:'x'.repeat(70_000)}});expect(rich.isError).not.toBe(true);
  const resource=await client.readResource({uri:'foundkeep://organization'});expect(resource.contents).toHaveLength(1);
  const request=await app.fetch(new Request('https://foundkeep.app/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'}));expect(request.status).toBe(403);
 }finally{await client.close();}
});
test('credential rotation cannot accumulate duplicate relationship buckets',async()=>{
 const target=crypto.randomUUID();db.query("INSERT INTO customer_captures(id,account_id,client_id,type,storage_bytes,captured_at,created_at,updated_at) VALUES(?,?,?,'note',0,2,2,2)").run(target,owner,target);
 for(let i=0;i<12;i++){
  const issued=createAgentToken(db,owner,{name:'Rotating agent',scopes:['library:read','library:write']});
  const revision=(db.query('SELECT updated_at FROM customer_captures WHERE id=?').get(capture) as any).updated_at;
  await createMcpOperations(db,'Bearer '+issued.token).call('link_saves',{id:capture,expectedRevision:revision,relatedIds:[target]});
  db.query('DELETE FROM customer_agent_tokens WHERE id=?').run(issued.id);
 }
 expect((db.query('SELECT COUNT(*) n FROM customer_capture_links WHERE source_id=?').get(capture) as any).n).toBe(1);
});

test('MCP exposes bounded derivative chunks under the same file scope',async()=>{
 const ops=createMcpOperations(db,'Bearer '+token);
 db.query("INSERT INTO customer_derivatives(account_id,capture_id,kind,mime,data,bytes,source_hash,created_at) VALUES(?,?,'compact','video/mp4',?,10,'hash',0)").run(owner,capture,Buffer.from('0123456789'));
 expect((await ops.call('read_save',{id:capture}) as any).derivatives).toEqual([{kind:'compact',mime:'video/mp4',bytes:10}]);
 expect(await ops.call('read_file',{id:capture,derivative:'compact',offset:3,length:2})).toMatchObject({mime:'video/mp4',total:10,nextOffset:5,base64:Buffer.from('34').toString('base64')});
 await expect(ops.call('read_file',{id:capture,derivative:'preview'})).rejects.toThrow('unavailable');
 const reader=createAgentToken(db,owner,{name:'Metadata',scopes:['library:read']});
 await expect(createMcpOperations(db,'Bearer '+reader.token).call('read_file',{id:capture,derivative:'compact'})).rejects.toThrow('permission');
});
