import {lstatSync,opendirSync,unlinkSync,type Dir} from 'node:fs';
import {join} from 'node:path';
import type {Database} from 'bun:sqlite';
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const fileName=new RegExp('^'+UUID+'$'),temporaryName=new RegExp('^'+UUID+'\\.upload$');
const directoryName=/^(?:\d{4}-(?:0[1-9]|1[0-2])|\.tmp)$/;
/** At most two open directory cursors; retained between bounded pages so committed files cannot hide orphans. */
export function createRemoteFileSweeper(db:Database,root:string){
 const base=join(root,'customer-files','remote');
 let directories:Dir|undefined,files:Dir|undefined,directory='';
 const close=()=>{try{files?.closeSync();}catch{}try{directories?.closeSync();}catch{}files=undefined;directories=undefined;};
 function sweep(now:number,limit=100):number{
  let visited=0;
  try{
   if(!lstatSync(join(root,'customer-files')).isDirectory()||!lstatSync(base).isDirectory()){close();return 0;}
   directories??=opendirSync(base);
   while(visited<Math.min(100,Math.max(1,limit))){
    if(!files){
     const entry=directories.readSync();if(!entry){close();break;}visited++;
     if(!entry.isDirectory()||!directoryName.test(entry.name))continue;
     directory=entry.name;
     if(!lstatSync(join(base,directory)).isDirectory())continue;
     files=opendirSync(join(base,directory));continue;
    }
    const entry=files.readSync();visited++;
    if(!entry){files.closeSync();files=undefined;continue;}
    if(!entry.isFile()||!(directory==='.tmp'?temporaryName:fileName).test(entry.name))continue;
    const relativePath=['customer-files','remote',directory,entry.name].join('/'),path=join(root,relativePath);
    // No await between reference protection and unlink, including across backend workers.
    db.transaction(()=>{
     if(!lstatSync(join(root,'customer-files')).isDirectory()||!lstatSync(base).isDirectory()||!lstatSync(join(base,directory)).isDirectory())return;
     const info=lstatSync(path);if(!info.isFile()||info.mtimeMs>=now-3600_000)return;
     if(db.query('SELECT 1 FROM customer_captures WHERE file_path=? LIMIT 1').get(relativePath))return;
     unlinkSync(path);
    }).immediate();
   }
  }catch{close();} // Missing directories/files or a competing sweep are harmless; retry next cadence.
  return visited;
 }
 return {sweep,close};
}
