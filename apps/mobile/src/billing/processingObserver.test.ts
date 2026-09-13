import test from 'node:test';
import assert from 'node:assert/strict';
import {createFoundkeepClient} from '../api/client.ts';
import {observeProcessing,processingMessage} from './processingObserver.ts';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const snapshot=(status:string,updatedAt=1)=>({job:{id:'job',status,error:null,updatedAt},processing:null});

test('queued processing of a done URL capture refreshes cached file, summary, organization, relations and usage only after delayed completion',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let state:any={job:null,processing:null},finished=false;
 const client=createFoundkeepClient({getToken:async()=> 'owner',fetcher:async(input,init)=>{
  const path=new URL(String(input)).pathname;
  if(path.endsWith('/process')){state=snapshot('pending');return Response.json({id:'job',status:'pending'},{status:202});}
  if(path.endsWith('/processing'))return Response.json(state);
  if(path.endsWith('/related'))return Response.json({items:finished?[{capture:{id:'related'}}]:[]});
  if(path.endsWith('/organization'))return Response.json({suggestedTags:finished?['video']:[]});
  if(path.endsWith('/me'))return Response.json({usage:{bytes:finished?900:20}});
  return Response.json({capture:{id:'save',status:'done',fileName:finished?'original.mp4':null,summary:finished?'Organized':null}});
 }});
 await client.getCapture('save');await client.relatedCaptures('save');await client.organization();
 const observed:string[]=[];let refreshes=0;let refreshed:any;
 const watcher=observeProcessing({client,id:'save',onState:value=>{if(value.job)observed.push(value.job.status);},onTerminal:()=>{
  refreshes++;client.invalidate();void Promise.all([client.getCapture('save'),client.relatedCaptures('save'),client.organization(),client.me()]).then(values=>{refreshed=values;});
 }});
 await flush();await client.processCapture('save');watcher.restart();await flush();
 assert.equal(refreshes,0);assert.ok(observed.includes('pending'));
 state=snapshot('running',2);t.mock.timers.tick(5000);await flush();assert.equal(refreshes,0);
 finished=true;state={...snapshot('done',3),processing:{processedAt:3,result:{download:{status:'downloaded'}}}};
 t.mock.timers.tick(5000);await flush();
 assert.equal(refreshes,1);assert.equal(refreshed[0].capture.fileName,'original.mp4');assert.equal(refreshed[0].capture.summary,'Organized');
 assert.equal(refreshed[1].items[0].capture.id,'related');assert.deepEqual(refreshed[2].suggestedTags,['video']);assert.equal(refreshed[3].usage.bytes,900);
 t.mock.timers.tick(60000);await flush();assert.equal(refreshes,1);watcher.stop();
});

test('automatic jobs are discovered, failed remote evidence refreshes once, and paused/cancelled copy stays safe',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let state:any={job:null,processing:null};let latest:any;let refreshed=0;
 const client=createFoundkeepClient({getToken:async()=> 'owner',fetcher:async()=>Response.json(state)});
 const watcher=observeProcessing({client,id:'save',onState:value=>{latest=value;},onTerminal:()=>{refreshed++;}});
 await flush();state=snapshot('running');t.mock.timers.tick(5000);await flush();assert.equal(latest.job.status,'running');
 state={...snapshot('failed',2),job:{...snapshot('failed',2).job,error:'provider secret stderr /private/file'}};
 t.mock.timers.tick(5000);await flush();assert.equal(refreshed,1);
 assert.match(processingMessage(latest),/could not finish/i);assert.doesNotMatch(processingMessage(latest),/secret|stderr|private/);
 assert.match(processingMessage(snapshot('paused')),/paused/i);assert.match(processingMessage(snapshot('cancelled')),/cancelled/i);
 assert.match(processingMessage({job:snapshot('done').job,processing:{processedAt:2,result:{download:{status:'unavailable',notice:'private unsafe provider content'}}}}),/unavailable/i);
 watcher.stop();
});

test('discovery and active polling stop at finite limits and explicit restart observes fresh work',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let state:any={job:null,processing:null};let reads=0;
 const client=createFoundkeepClient({getToken:async()=> 'owner',fetcher:async()=>{reads++;return Response.json(state);}});
 const watcher=observeProcessing({client,id:'save',onState:()=>{},onTerminal:()=>{}});await flush();
 for(let i=0;i<15;i++){t.mock.timers.tick(5000);await flush();}const discoveryReads=reads;assert.ok(discoveryReads<=8);
 t.mock.timers.tick(60000);await flush();assert.equal(reads,discoveryReads);
 state=snapshot('running');watcher.restart();await flush();assert.equal(reads,discoveryReads+1);
 for(let i=0;i<370;i++){t.mock.timers.tick(5000);await flush();}const activeReads=reads;
 t.mock.timers.tick(60000);await flush();assert.equal(reads,activeReads);assert.ok(activeReads<=discoveryReads+361);watcher.stop();
});

test('stopping on background/unmount cancels pending fetch and discards late results; account switches never publish old evidence',async()=>{
 let token='first',release!:(value:Response)=>void,signal:AbortSignal|undefined;let states=0,refreshes=0;
 const client=createFoundkeepClient({getToken:async()=>token,fetcher:async(_input,init)=>{signal=init?.signal as AbortSignal;return new Promise(resolve=>{release=resolve;});}});
 const watcher=observeProcessing({client,id:'save',onState:()=>{states++;},onTerminal:()=>{refreshes++;}});
 await flush();watcher.stop();assert.equal(signal?.aborted,true);release(Response.json(snapshot('done')));await flush();assert.equal(states,0);assert.equal(refreshes,0);
 const other=observeProcessing({client,id:'save',onState:()=>{states++;},onTerminal:()=>{refreshes++;}});
 await flush();token='second';release(Response.json(snapshot('done')));await flush();assert.equal(states,0);assert.equal(refreshes,0);other.stop();
});
