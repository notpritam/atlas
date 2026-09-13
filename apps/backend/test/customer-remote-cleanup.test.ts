import {afterEach,beforeEach,expect,test} from 'bun:test';
import {mkdirSync,mkdtempSync,writeFileSync,utimesSync,existsSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDb} from '../src/db.ts';
import {createProcessingService} from '../src/customer-processing.ts';
import {createRemoteFileSweeper} from '../src/customer-remote-cleanup.ts';
let db:ReturnType<typeof openDb>,root:string;
const stamp=Date.now(),old=new Date(stamp-2*3600_000),month='2026-09';
beforeEach(()=>{db=openDb(':memory:');root=mkdtempSync(join(tmpdir(),'remote-sweep-'));db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES('owner','sweep@example.test','Test','','',0)").run();});
afterEach(()=>{db.close();rmSync(root,{recursive:true,force:true});});
function file(directory='remote/'+month,fresh=false,name:string=crypto.randomUUID()){
 const folder=join(root,'customer-files',directory);mkdirSync(folder,{recursive:true});const path=join(folder,name);writeFileSync(path,'actual orphan bytes');if(!fresh)utimesSync(path,old,old);return path;
}
function reference(path:string){const id=crypto.randomUUID();db.query("INSERT INTO customer_captures(id,account_id,client_id,type,status,file_path,storage_bytes,captured_at,created_at,updated_at) VALUES(?,'owner',?,'video','done',?,20,1,1,1)").run(id,id,path.slice(root.length+1));}
test('stale remote crash files and partial uploads are removed; referenced, fresh, uploaded and outside files remain',async()=>{
 const orphan=file(),partial=file('remote/.tmp',false,crypto.randomUUID()+'.upload'),owned=file(),fresh=file('remote/'+month,true),upload=file(month),outside=file('remote/'+month,false,'not-a-uuid');reference(owned);
 const sweeper=createRemoteFileSweeper(db,root);await sweeper.sweep(stamp);
 for(const path of [orphan,partial])expect(existsSync(path)).toBe(false);
 for(const path of [owned,fresh,upload,outside])expect(existsSync(path)).toBe(true);
});
test('bounded rotating scans eventually reach orphans behind many referenced files and ignore symlink targets',async()=>{
 const owned=Array.from({length:12},()=>file());owned.forEach(reference);const orphan=file();const outside=file(month);const link=join(root,'customer-files','remote',month,crypto.randomUUID());symlinkSync(outside,link);
 const linkedDirectory=join(root,'customer-files','remote','2026-08');symlinkSync(join(root,'customer-files',month),linkedDirectory);
 const sweeper=createRemoteFileSweeper(db,root);
 for(let i=0;i<30;i++)expect(await sweeper.sweep(stamp,3)).toBeLessThanOrEqual(3);
 expect(existsSync(orphan)).toBe(false);for(const path of [...owned,outside,link,linkedDirectory])expect(existsSync(path)).toBe(true);
});
test('processing restart sweeps abandoned remote bytes even with AI unavailable',async()=>{
 const orphan=file();const service=createProcessingService(db,{root,now:()=>stamp,ai:{available:false,model:'none',organize:async()=>{throw new Error('disabled');}}});await service.tick();expect(existsSync(orphan)).toBe(false);
});
test('a symlinked customer-files parent never lets the sweep unlink outside its namespace',async()=>{
 const folder=join(root,'outside','remote',month);mkdirSync(folder,{recursive:true});const path=join(folder,crypto.randomUUID());writeFileSync(path,'outside bytes');utimesSync(path,old,old);symlinkSync(join(root,'outside'),join(root,'customer-files'));
 createRemoteFileSweeper(db,root).sweep(stamp);expect(existsSync(path)).toBe(true);
});
