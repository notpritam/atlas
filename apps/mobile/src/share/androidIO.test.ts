import test from 'node:test';
import assert from 'node:assert/strict';
import * as androidIO from './androidIO.ts';
const {localFileName,safeDisplayName,withTransferTimeout,consumeUploadResponse,saveDownloadedBody}=androidIO;
test('filenames use local content metadata and sanitize path/control characters',async()=>{
 assert.equal(await localFileName('content://documents/opaque',async()=> '../folder/photo\n.jpg','opaque'),'photo.jpg');
 assert.equal(await localFileName('content://documents/opaque',async()=> null,'opaque'),'Shared file');
 assert.equal(await localFileName('file:///cache/photo.jpg',async()=>{throw Error('must not query provider');},'photo.jpg'),'photo.jpg');
 await assert.rejects(localFileName('https://external.example/photo',async()=>{throw Error('must not fetch');},'photo'),'Only local files');
 assert.equal(safeDisplayName('..\\photo.jpg'),'photo.jpg');
});
test('local file copy finishes before the private payload is validated',async()=>{
 const copyIncomingFile=(androidIO as unknown as {copyIncomingFile?: (sourceSize:number,target:{exists:boolean;size:number},limit:number,copy:()=>Promise<void>)=>Promise<number>}).copyIncomingFile;
 assert.equal(typeof copyIncomingFile,'function');
 const target={exists:false,size:0};
 const source={size:11_455,copy:async()=>{await Promise.resolve();target.exists=true;target.size=11_455;}};
 assert.equal(await copyIncomingFile?.(source.size,target,50_000,()=>source.copy()),11_455);
});
test('content-provider payloads use the bounded native stream adapter instead of File.copy',async()=>{
 const copySharedPayload=(androidIO as unknown as {copySharedPayload?: (uri:string,sourceSize:number,target:{exists:boolean;size:number},limit:number,fileCopy:()=>Promise<void>,contentCopy:(uri:string,limit:number)=>Promise<number>)=>Promise<number>}).copySharedPayload;
 assert.equal(typeof copySharedPayload,'function');
 const target={exists:false,size:0};let fileCopies=0,nativeCopies=0;
 const bytes=await copySharedPayload?.('content://media/external/images/media/20',11_455,target,50_000,async()=>{fileCopies++;},async(uri,limit)=>{nativeCopies++;assert.equal(uri,'content://media/external/images/media/20');assert.equal(limit,50_000);target.exists=true;target.size=11_455;return 11_455;});
 assert.equal(bytes,11_455);assert.equal(fileCopies,0);assert.equal(nativeCopies,1);
});
test('upload response parsing retains folder errors and consumes UTF-8 chunks',async()=>{
 const bytes=new TextEncoder().encode('{"error":"folder_not_found"}');let read=false;
 const result=await withTransferTimeout(100,async(signal,wait)=>consumeUploadResponse({status:404,body:{getReader:()=>({read:async()=>read?{done:true,value:undefined}:(read=true,{done:false,value:bytes}),cancel:async()=>{},releaseLock:()=>{}})}},signal,wait));
 assert.deepEqual(result,{status:404,error:'folder_not_found'});
});
test('a failed local download write cancels its reader and removes the partial file',async()=>{
 let cancel=false,close=false,remove=false;
 await assert.rejects(withTransferTimeout(100,async(signal,wait)=>saveDownloadedBody({ok:true,body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array([1])}),cancel:async()=>{cancel=true;},releaseLock:()=>{}})}},signal,wait,{uri:'private',open:()=>({writeBytes:()=>{throw Error('disk full');},close:()=>{close=true;}}),remove:()=>{remove=true;}})),/disk full/);
 assert.equal(cancel,true);assert.equal(close,true);assert.equal(remove,true);
});
