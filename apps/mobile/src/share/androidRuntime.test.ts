import test from 'node:test';
import assert from 'node:assert/strict';
import { createAndroidRuntime, shareMetadata, type AndroidRecord, type AndroidStorage, type Credential } from './androidRuntime.ts';
import { DEFAULT_MOBILE_POLICY } from '../policy/mobilePolicy.ts';
function fixture() {
  let credential: Credential|null = null, counter=0;
  const records = new Map<string,AndroidRecord>(); const copies:string[]=[]; const uploads:{record:AndroidRecord;token:string}[]=[];
  const storage:AndroidStorage={
    credential:async()=>credential,setCredential:async value=>{credential=value;},records:async()=>[...records.values()],save:async record=>{records.set(record.id,structuredClone(record));},remove:async record=>{records.delete(record.id);},
    copy:async(uri,id)=>{copies.push(uri);return {path:id,name:'image.jpg',bytes:10};},removePayload:async()=>{},policy:async()=>null,setPolicy:async()=>{},
    upload:async(record,token)=>{uploads.push({record,token});return {status:201};},download:async(_,name,token)=>`${token}/${name}`,uuid:()=>`id-${++counter}`,
  };
  return {storage,records,copies,uploads,runtime:createAndroidRuntime(storage)};
}
const account=(id:string)=>JSON.stringify({id});
test('Android securely binds queues to their original owner across switches and logout',async()=>{
  const f=fixture();await f.runtime.setSession('token-a',account('a'));
  await f.runtime.enqueueShares([{shareType:'text',value:'Private A'}],'a');
  await f.runtime.setSession('token-b',account('b'));
  assert.equal(await f.runtime.pendingCount(),0);assert.equal(await f.runtime.retryPending(),0);assert.equal(f.uploads.length,0);
  await assert.rejects(f.runtime.enqueueShares([{shareType:'text',value:'Stale screen'}],'a'),/account changed/);
  await f.runtime.clearSession();await f.runtime.refreshSession('token-a',account('a'));assert.equal(await f.runtime.getToken(),null);
  await f.runtime.setSession('token-a2',account('a'));assert.equal(await f.runtime.retryPending(),1);assert.equal(f.uploads[0]?.token,'token-a2');
});
test('Android copies all incoming files before queue commit and never fetches link previews',async()=>{
 const f=fixture();await f.runtime.setSession('a',account('a'));
 await f.runtime.enqueueShares([{shareType:'image',value:'content://photos/1',mimeType:'image/jpeg'},{shareType:'url',value:'https://example.com/article'},{shareType:'text',value:'Remember this'}],'a');
 assert.equal(f.records.size,3);assert.deepEqual(f.copies,['content://photos/1']);assert.equal(f.uploads.length,0);
 assert.deepEqual([...f.records.values()].map(r=>r.metadata.type),['image','bookmark','selection']);
 const provenance=[...f.records.values()].map(r=>r.metadata.provenance as Record<string,unknown>);
 assert.deepEqual(provenance.map(value=>value?.captureMethod),['android-share-image','android-share-url','android-share-text']);
 assert.deepEqual(provenance.map(value=>value.capturedAt),[provenance[0]?.extractedAt,provenance[1]?.extractedAt,provenance[2]?.extractedAt]);
 assert.equal(provenance[0]?.originalFileName,'image.jpg');assert.equal(provenance[0]?.declaredMime,'image/jpeg');assert.equal(provenance[0]?.byteSize,10);
 const bad=fixture();await bad.runtime.setSession('a',account('a'));bad.storage.copy=async()=>{throw Error('Unreadable');};
 await assert.rejects(bad.runtime.enqueueShares([{shareType:'text',value:'First'},{shareType:'file',value:'content://file/1'}],'a'),/Unreadable/);assert.equal(bad.records.size,0);
});
test('Android rejects unsafe payload URLs, policy limits and missing owner credentials',async()=>{
 for(const value of ['javascript:alert(1)','file:///private','https://name:password@example.com']) assert.throws(()=>shareMetadata({shareType:'url',value},DEFAULT_MOBILE_POLICY));
 assert.throws(()=>shareMetadata({shareType:'file',value:'https://example.com/file'},DEFAULT_MOBILE_POLICY));
 assert.throws(()=>shareMetadata({shareType:'text',value:'x'.repeat(50_001)},DEFAULT_MOBILE_POLICY));
 const f=fixture();await assert.rejects(f.runtime.enqueueShares([{shareType:'text',value:'test'}],'a'),/Sign in/);
 await f.runtime.setSession('a',account('a'));await assert.rejects(f.runtime.refreshSession('a',account('b')),/binding/);
});
test('missing folder needs explicit owner-only resolution; failed uploads retain payloads and back off',async()=>{
 const f=fixture();await f.runtime.setSession('a',account('a'));await f.runtime.enqueueShares([{shareType:'text',value:'test'}],'a');
 f.storage.upload=async()=>({status:404,error:'folder_not_found'});assert.equal(await f.runtime.retryPending(),0);assert.equal(await f.runtime.blockedPendingCount(),1);
 await f.runtime.setSession('b',account('b'));assert.equal(await f.runtime.resolveBlockedPendingToUnfiled(),0);
 await f.runtime.setSession('a',account('a'));assert.equal(await f.runtime.resolveBlockedPendingToUnfiled(),1);
 f.storage.upload=async()=>({status:500});await f.runtime.retryPending();const record=[...f.records.values()][0]!;assert.equal(record.attempts,1);assert.ok(record.nextAttemptAt>Date.now());assert.equal(record.metadata.folderId,null);
});
test('account switch serializes behind an in-flight upload and never substitutes its credential',async()=>{
 const f=fixture();await f.runtime.setSession('a',account('a'));await f.runtime.enqueueShares([{shareType:'text',value:'a'}],'a');
 let finish!:()=>void;let start!:()=>void;const started=new Promise<void>(r=>{start=r;});
 f.storage.upload=async(_record,token)=>{assert.equal(token,'a');start();await new Promise<void>(r=>{finish=r;});return {status:201};};
 const retry=f.runtime.retryPending();await started;const switchAccount=f.runtime.setSession('b',account('b'));finish();await retry;await switchAccount;assert.equal(await f.runtime.getToken(),'b');
});
test('original downloads require a session and sanitize the display filename',async()=>{
 const f=fixture();await assert.rejects(f.runtime.downloadCaptureFile('id','x'),/Sign in/);await f.runtime.setSession('a',account('a'));
 assert.equal(await f.runtime.downloadCaptureFile('id','../../secret\n.txt'),'a/secret.txt');await assert.rejects(f.runtime.downloadCaptureFile('../other','x'),/Invalid capture/);
});

test('opaque content-provider URI keeps the local display filename in queued metadata',async()=>{
 const {localFileName}=await import('./androidIO.ts');const f=fixture();await f.runtime.setSession('a',account('a'));
 f.storage.copy=async(uri,id)=>({path:id,name:await localFileName(uri,async queried=>{assert.equal(queried,'content://media/external/images/media/12345');return 'photo.jpg';},'12345'),bytes:10});
 await f.runtime.enqueueShares([{shareType:'image',value:'content://media/external/images/media/12345',mimeType:'image/jpeg'}],'a');
 assert.equal([...f.records.values()][0]?.metadata.fileName,'photo.jpg');
});
test('stalled upload response body times out, cancels, retains queue, and releases logout',async()=>{
 const {withTransferTimeout,consumeUploadResponse}=await import('./androidIO.ts');const f=fixture();let cancelled=0;
 await f.runtime.setSession('a',account('a'));await f.runtime.enqueueShares([{shareType:'text',value:'Keep me'}],'a');
 f.storage.upload=async()=>withTransferTimeout(10,async(signal,wait)=>consumeUploadResponse({status:201,body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:()=>{cancelled++;return new Promise(()=>{});},releaseLock:()=>{}})}},signal,wait));
 const upload=f.runtime.retryPending();const logout=f.runtime.clearSession();await Promise.all([upload,logout]);
 assert.ok(cancelled>0);assert.equal(await f.runtime.getToken(),null);assert.equal(f.records.size,1);assert.equal([...f.records.values()][0]?.attempts,1);
});
test('stalled download body removes partial file and releases the session serializer',async()=>{
 const {withTransferTimeout,saveDownloadedBody}=await import('./androidIO.ts');const f=fixture();let reads=0,written=0,closed=false,removed=false,cancelled=false;
 await f.runtime.setSession('a',account('a'));
 f.storage.download=async()=>withTransferTimeout(10,async(signal,wait)=>saveDownloadedBody({ok:true,body:{getReader:()=>({read:async()=>{if(reads++===0)return {done:false,value:new Uint8Array([1,2])};return new Promise(()=>{});},cancel:async()=>{cancelled=true;},releaseLock:()=>{}})}},signal,wait,{uri:'private/partial',open:()=>({writeBytes:bytes=>{written+=bytes.length;},close:()=>{closed=true;}}),remove:()=>{removed=true;}}));
 const download=f.runtime.downloadCaptureFile('capture','photo.jpg');const logout=f.runtime.clearSession();await assert.rejects(download,/transfer took too long/);await logout;
 assert.equal(written,2);assert.equal(closed,true);assert.equal(removed,true);assert.equal(cancelled,true);assert.equal(await f.runtime.getToken(),null);
});
