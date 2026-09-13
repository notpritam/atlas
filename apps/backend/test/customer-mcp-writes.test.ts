import {afterEach,beforeEach,expect,test} from 'bun:test';
import {openDb} from '../src/db.ts';
import {createAgentToken} from '../src/customer-agent-access.ts';
import {createMcpOperations} from '../src/customer-mcp.ts';
import {customerChanges} from '../src/customer-changes.ts';
import {writeSubscription} from '../src/customer-plans.ts';
import {CONSENT_VERSION,createProcessingService} from '../src/customer-processing.ts';

let db:ReturnType<typeof openDb>;
let owner:string;
let token:string;

beforeEach(()=>{
  db=openDb(':memory:');
  owner=crypto.randomUUID();
  db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,?,'MCP write test','','',0)").run(owner,owner+'@example.com');
  token=createAgentToken(db,owner,{name:'Writing agent',scopes:['library:read','library:write']}).token;
});

afterEach(()=>db.close());

test('create_save round-trips agent provenance, is idempotent per owner, and enters the change feed',async()=>{
  const ops=createMcpOperations(db,'Bearer '+token);
  const created=await ops.call('create_save',{
    clientId:'agent-save-1',type:'tweet',sourceTitle:'An agent save',sourceUrl:'https://example.com/post',
    noteText:'Useful context',articleText:'Original article',selectionText:'Original quote',userTags:['research'],
  }) as any;
  expect(created.duplicate).toBe(false);
  expect(created.capture).toMatchObject({
    clientId:'agent-save-1',type:'tweet',sourceTitle:'An agent save',sourceUrl:'https://example.com/post',
    noteText:'Useful context',articleText:'Original article',selectionText:'Original quote',userTags:['research'],
    provenance:{captureMethod:'agent-create',sourceApplication:'foundkeep-mcp'},
  });
  const read=await ops.call('read_save',{id:created.capture.id}) as any;
  expect(read.capture).toEqual(created.capture);
  expect(customerChanges(db,owner,0).changes).toContainEqual(expect.objectContaining({entity:'capture',id:created.capture.id,operation:'upsert',revision:created.capture.updatedAt}));

  const rotated=createAgentToken(db,owner,{name:'Replacement writer',scopes:['library:read','library:write']});
  const duplicate=await createMcpOperations(db,'Bearer '+rotated.token).call('create_save',{
    clientId:'agent-save-1',type:'note',noteText:'This must not replace the first save',
  }) as any;
  expect(duplicate).toEqual({capture:created.capture,duplicate:true});
  expect((db.query('SELECT COUNT(*) count FROM customer_captures WHERE account_id=?').get(owner) as any).count).toBe(1);
});

test('update_save changes explicit details with UTF-8 accounting and preserves omitted originals and tags',async()=>{
  const ops=createMcpOperations(db,'Bearer '+token);
  const created=(await ops.call('create_save',{
    clientId:'agent-save-2',type:'selection',sourceTitle:'Original',sourceUrl:'https://example.com/original',
    noteText:'é',articleText:'Original article',selectionText:'Original selection',userTags:['Personal'],
  }) as any).capture;
  db.query("UPDATE customer_captures SET tags='[\"hosted\"]',blob_data=?,blob_mime='image/png',blob_bytes=3 WHERE id=?").run(Buffer.from([1,2,3]),created.id);
  const before=db.query('SELECT * FROM customer_captures WHERE id=?').get(created.id) as any;
  const updated=(await ops.call('update_save',{
    id:created.id,expectedRevision:created.updatedAt,sourceTitle:'New 📚',noteText:'好',summary:'Résumé',category:'研究',
  }) as any).capture;
  expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
  expect(updated).toMatchObject({sourceTitle:'New 📚',noteText:'好',summary:'Résumé',category:'研究',tags:['hosted'],userTags:['Personal']});
  expect(updated).toMatchObject({sourceUrl:'https://example.com/original',articleText:'Original article',selectionText:'Original selection'});
  const after=db.query('SELECT * FROM customer_captures WHERE id=?').get(created.id) as any;
  expect(Buffer.from(after.blob_data)).toEqual(Buffer.from([1,2,3]));
  expect(after.provenance_json).toBe(before.provenance_json);
  expect(after.storage_bytes).toBe(before.storage_bytes+15);

  await expect(ops.call('update_save',{id:created.id,expectedRevision:created.updatedAt,summary:'stale'})).rejects.toMatchObject({code:'revision_conflict'});
  const organized=(await ops.call('update_save',{id:created.id,expectedRevision:updated.updatedAt,folderId:null,userTags:['Personal','Reviewed']})) as any;
  expect(organized.capture).toMatchObject({sourceTitle:'New 📚',noteText:'好',summary:'Résumé',category:'研究',userTags:['Personal','Reviewed']});
});

test('create_save and update_save reject folders owned by another account',async()=>{
  const other=crypto.randomUUID(),folder=crypto.randomUUID();
  db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,?,'Other','','',0)").run(other,other+'@example.com');
  db.query("INSERT INTO customer_folders(id,account_id,name,normalized_name,created_at,updated_at) VALUES(?,?,'Private','private',0,0)").run(folder,other);
  const ops=createMcpOperations(db,'Bearer '+token);
  await expect(ops.call('create_save',{clientId:'private-folder',type:'note',noteText:'No access',folderId:folder})).rejects.toThrow('Folder not found');
  const created=(await ops.call('create_save',{clientId:'owned-save',type:'note',noteText:'Owned'})) as any;
  await expect(ops.call('update_save',{id:created.capture.id,expectedRevision:created.capture.updatedAt,folderId:folder})).rejects.toThrow('Folder not found');
});

test('write tools require library write scope and recheck revocation inside their transaction',async()=>{
  const reader=createAgentToken(db,owner,{name:'Reader',scopes:['library:read']});
  const readonly=createMcpOperations(db,'Bearer '+reader.token);
  expect(readonly.list().some(tool=>tool.name==='create_save'||tool.name==='update_save')).toBe(false);
  await expect(readonly.call('create_save',{clientId:'denied',type:'note',noteText:'No'})).rejects.toMatchObject({code:'agent_scope'});

  const writer=createAgentToken(db,owner,{name:'One-shot writer',scopes:['library:read','library:write']});
  db.query(`CREATE TRIGGER revoke_writer_after_seen AFTER UPDATE OF last_seen_at ON customer_agent_tokens
    WHEN NEW.id='${writer.id}' BEGIN DELETE FROM customer_agent_tokens WHERE id=NEW.id; END`).run();
  await expect(createMcpOperations(db,'Bearer '+writer.token).call('create_save',{clientId:'revoked',type:'note',noteText:'No'})).rejects.toMatchObject({code:'agent_unauthorized'});
  expect(db.query("SELECT 1 FROM customer_captures WHERE client_id='revoked'").get()).toBeNull();
});

test('create_save enforces account and global capture and UTF-8 byte quotas',async()=>{
  const input={clientId:'quota-save',type:'note' as const,noteText:'content'};
  await expect(createMcpOperations(db,'Bearer '+token,2*1024**3,{globalMaxCaptures:0}).call('create_save',input)).rejects.toMatchObject({code:'storage_unavailable'});

  const existing=(await createMcpOperations(db,'Bearer '+token).call('create_save',{clientId:'existing',type:'note',noteText:'already stored'})) as any;
  db.query('UPDATE customer_captures SET storage_bytes=? WHERE account_id=?').run(200*1024**2,owner);
  await expect(createMcpOperations(db,'Bearer '+token).call('update_save',{id:existing.capture.id,expectedRevision:existing.capture.updatedAt,noteText:'already stored 📚'})).rejects.toMatchObject({code:'quota_exceeded'});
  await expect(createMcpOperations(db,'Bearer '+token).call('create_save',input)).rejects.toMatchObject({code:'quota_exceeded'});

  db.query('UPDATE customer_captures SET storage_bytes=1 WHERE account_id=?').run(owner);
  await expect(createMcpOperations(db,'Bearer '+token,1).call('update_save',{id:existing.capture.id,expectedRevision:existing.capture.updatedAt,noteText:'already stored with global growth'})).rejects.toMatchObject({code:'storage_unavailable'});
  await expect(createMcpOperations(db,'Bearer '+token,1).call('create_save',input)).rejects.toMatchObject({code:'storage_unavailable'});

  db.query(`WITH RECURSIVE count(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM count WHERE value<9999)
    INSERT INTO customer_captures(id,account_id,client_id,type,status,storage_bytes,captured_at,created_at,updated_at)
    SELECT printf('00000000-0000-4000-8000-%012d',value),?,'bulk-'||value,'note','done',0,value,value,value FROM count`).run(owner);
  await expect(createMcpOperations(db,'Bearer '+token,2*1024**3,{globalMaxCaptures:20_000}).call('create_save',input)).rejects.toMatchObject({code:'quota_exceeded'});
});

test('write schemas allow only supported text kinds, safe URLs, and documented field sizes',async()=>{
  const ops=createMcpOperations(db,'Bearer '+token);
  for(const [index,type] of ['note','bookmark','tweet','selection'].entries()){
    const result=await ops.call('create_save',{clientId:'kind-'+index,type,noteText:'supported'}) as any;
    expect(result.capture.type).toBe(type);
  }
  await expect(ops.call('create_save',{clientId:'image',type:'image',noteText:'unsupported'})).rejects.toMatchObject({code:'invalid_tool_input'});
  await expect(ops.call('create_save',{clientId:'unsafe-url',type:'bookmark',sourceUrl:'https://user:secret@example.com'})).rejects.toMatchObject({code:'invalid_tool_input'});
  await expect(ops.call('create_save',{clientId:'long-note',type:'note',noteText:'x'.repeat(50_001)})).rejects.toMatchObject({code:'invalid_tool_input'});
  await expect(ops.call('create_save',{clientId:'long-article',type:'bookmark',articleText:'x'.repeat(500_001)})).rejects.toMatchObject({code:'invalid_tool_input'});
});

test('summary updates cancel an awaiting hosted job without allowing overwrite or charging credit',async()=>{
  const ops=createMcpOperations(db,'Bearer '+token);
  const created=(await ops.call('create_save',{clientId:'hosted-race',type:'note',noteText:'Original input'})) as any;
  writeSubscription(db,owner,'revenuecat',{status:'active',expiresAt:Date.now()+60_000,renews:true,sandbox:true});
  let entered!:()=>void,finish!:(value:{summary:string;category:string;tags:string[];relatedIds:string[]})=>void;
  const providerStarted=new Promise<void>(resolve=>entered=resolve);
  const processing=createProcessingService(db,{ai:{available:true,model:'deferred-test',organize:()=>{entered();return new Promise(resolve=>finish=resolve);}}});
  processing.configure(owner,{enabled:true,fetchLinks:false,images:false,consentVersion:CONSENT_VERSION});
  processing.enqueue(owner,created.capture.id,'manual');
  const running=processing.tick();await providerStarted;

  const updated=await ops.call('update_save',{id:created.capture.id,expectedRevision:created.capture.updatedAt,summary:'Agent summary'}) as any;
  expect(updated.capture.summary).toBe('Agent summary');
  expect(processing.settings(owner).usage).toMatchObject({reserved:0,used:0});
  expect(db.query('SELECT status,credit,lease_token FROM customer_processing_jobs WHERE capture_id=?').get(created.capture.id)).toEqual({status:'cancelled',credit:0,lease_token:null});

  finish({summary:'Late hosted summary',category:'Hosted',tags:['hosted'],relatedIds:[]});
  await running;
  expect((await ops.call('read_save',{id:created.capture.id}) as any).capture).toMatchObject({summary:'Agent summary',category:null,tags:[]});
  expect(processing.settings(owner).usage).toMatchObject({reserved:0,used:0});
});

test('summary and category updates wait until basic processing no longer owns generated fields',async()=>{
  const ops=createMcpOperations(db,'Bearer '+token);
  const created=(await ops.call('create_save',{clientId:'basic-race',type:'note',noteText:'Original input'})) as any;
  for(const status of ['pending','processing']){
    db.query('UPDATE customer_captures SET status=? WHERE id=?').run(status,created.capture.id);
    await expect(ops.call('update_save',{id:created.capture.id,expectedRevision:created.capture.updatedAt,summary:'Too early'})).rejects.toMatchObject({code:'capture_busy'});
    await expect(ops.call('update_save',{id:created.capture.id,expectedRevision:created.capture.updatedAt,category:'Too early'})).rejects.toMatchObject({code:'capture_busy'});
  }
  const edited=await ops.call('update_save',{id:created.capture.id,expectedRevision:created.capture.updatedAt,noteText:'Updated before basic processing'}) as any;
  expect(edited.capture.noteText).toBe('Updated before basic processing');
});

test('personal organization preserves queued hosted work until source details change',async()=>{
  const ops=createMcpOperations(db,'Bearer '+token);
  const created=(await ops.call('create_save',{clientId:'queued-hosted',type:'note',noteText:'Original input'})) as any;
  writeSubscription(db,owner,'revenuecat',{status:'active',expiresAt:Date.now()+60_000,renews:true,sandbox:true});
  const processing=createProcessingService(db,{ai:{available:true,model:'queued-test',organize:async()=>({summary:'Hosted',category:'Notes',tags:[],relatedIds:[]})}});
  processing.configure(owner,{enabled:true,fetchLinks:false,images:false,consentVersion:CONSENT_VERSION});
  processing.enqueue(owner,created.capture.id,'manual');

  const tagged=await ops.call('update_save',{id:created.capture.id,expectedRevision:created.capture.updatedAt,userTags:['Keep']}) as any;
  expect(db.query('SELECT status,credit FROM customer_processing_jobs WHERE capture_id=?').get(created.capture.id)).toEqual({status:'pending',credit:1});
  expect(processing.settings(owner).usage).toMatchObject({reserved:1,used:0});

  await ops.call('update_save',{id:created.capture.id,expectedRevision:tagged.capture.updatedAt,noteText:'Changed input'});
  expect(db.query('SELECT status,credit FROM customer_processing_jobs WHERE capture_id=?').get(created.capture.id)).toEqual({status:'cancelled',credit:0});
  expect(processing.settings(owner).usage).toMatchObject({reserved:0,used:0});
});
