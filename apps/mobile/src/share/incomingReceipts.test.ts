import test from 'node:test';
import assert from 'node:assert/strict';
import { createIncomingReceiptDrain, type IncomingReceipt } from './incomingReceipts.ts';
function gate() { let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve}; }
function fixture() {
  let owner: string|null='account-a';
  const pending=new Map<string,IncomingReceipt>();const saved:string[]=[];const acknowledged:string[]=[];const owners:string[]=[];const discards:(()=>Promise<void>)[]=[];
  const deps={
    pending:async()=>[...pending.values()],acknowledge:async(id:string)=>{acknowledged.push(id);pending.delete(id);},owner:()=>owner,
    enqueue:async(shares:IncomingReceipt['shares'],owner:string)=>{saved.push(shares[0]!.value);owners.push(owner);},afterSaved:async()=>{},signedOut:()=>{},failed:(_error:unknown,discard:()=>Promise<void>)=>{discards.push(discard);},
  };
  const add=(id:string,value=id)=>pending.set(id,{id,shares:[{shareType:'text',value}]});
  return {pending,saved,acknowledged,owners,discards,deps,add,setOwner:(value:string|null)=>{owner=value;},drain:createIncomingReceiptDrain(deps)};
}
test('a second intent arriving during enqueue is retained and acknowledged by its own receipt',async()=>{
 const f=fixture(),started=gate(),finish=gate();const enqueue=f.deps.enqueue;
 f.deps.enqueue=async(shares,owner)=>{await enqueue(shares,owner);if(shares[0]?.value==='first'){started.resolve();await finish.promise;}};
 f.add('a','first');const running=f.drain.notify();await started.promise;
 f.add('b','second');void f.drain.notify();finish.resolve();await running;
 assert.deepEqual(f.saved,['first','second']);assert.deepEqual(f.acknowledged,['a','b']);assert.equal(f.pending.size,0);
});
test('arrivals during retry are drained afterward even without a further event',async()=>{
 const f=fixture(),started=gate(),finish=gate();let first=true;
 f.deps.afterSaved=async()=>{if(first){first=false;started.resolve();await finish.promise;}};
 f.add('a');const running=f.drain.notify();await started.promise;f.add('b');finish.resolve();await running;
 assert.deepEqual(f.saved,['a','b']);assert.equal(f.pending.size,0);
});
test('identical content in distinct intents remains distinct and delayed Discard is scoped',async()=>{
 const f=fixture();const enqueue=f.deps.enqueue;
 f.deps.enqueue=async(shares,owner)=>{if(shares[0]?.value==='broken')throw Error('unreadable');await enqueue(shares,owner);};
 f.add('old','broken');await f.drain.notify();assert.equal(f.discards.length,1);
 f.add('a','same content');f.add('b','same content');
 await f.discards[0]!();
 assert.deepEqual(f.acknowledged,['old','a','b']);assert.deepEqual(f.saved,['same content','same content']);
});
test('new intent notification snapshots its owner while an earlier retry is pending',async()=>{
 const f=fixture(),started=gate(),finish=gate();let first=true;
 f.deps.afterSaved=async()=>{if(first){first=false;started.resolve();await finish.promise;}};
 f.add('a');const running=f.drain.notify();await started.promise;f.add('b');void f.drain.notify();f.setOwner('account-b');finish.resolve();await running;
 assert.deepEqual(f.owners,['account-a','account-a']);
});
test('a transient receipt read failure does not poison future drains',async()=>{
 const f=fixture();let fail=true;f.deps.pending=async()=>{if(fail){fail=false;throw Error('temporary');}return [...f.pending.values()];};
 f.add('a');await assert.rejects(f.drain.notify(),/temporary/);await f.drain.notify();assert.deepEqual(f.saved,['a']);
});
test('an old pending snapshot resolving after acknowledgement cannot reinsert a saved receipt',async()=>{
 const f=fixture(),enqueuing=gate(),finishEnqueue=gate(),snapshotStarted=gate(),finishSnapshot=gate(),saved=gate();let reads=0;
 const pending=f.deps.pending,enqueue=f.deps.enqueue;
 f.deps.pending=async()=>{const snapshot=await pending();if(++reads===2){snapshotStarted.resolve();await finishSnapshot.promise;}return snapshot;};
 f.deps.enqueue=async(shares,owner)=>{await enqueue(shares,owner);if(shares[0]?.value==='a'){enqueuing.resolve();await finishEnqueue.promise;}};
 f.deps.afterSaved=async()=>{saved.resolve();};
 f.add('a');const running=f.drain.notify();await enqueuing.promise;f.add('b');void f.drain.notify();await snapshotStarted.promise;
 finishEnqueue.resolve();await saved.promise;finishSnapshot.resolve();await running;
 assert.deepEqual(f.saved,['a','b']);assert.deepEqual(f.acknowledged,['a','b']);
});
