import {randomBytes} from 'node:crypto';
import {existsSync,realpathSync} from 'node:fs';
import {mkdir,readFile,writeFile,rename,open,unlink,chmod} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {demoCollections} from './fixtures/dev-collections.mjs';
import {seedDemoGraph} from './seed-dev-graph.mjs';

function canonicalDestination(input) {
 let existing=path.isAbsolute(input)?input:process.cwd()+'/'+input;const suffix=[];
 while(!existsSync(existing)){suffix.unshift(path.basename(existing));existing=path.dirname(existing);}
 return path.join(realpathSync.native(existing),...suffix);
}
export function validateTarget(origin,stateDir,localTest=false) {
 const url=new URL(origin);
 if(url.origin!==origin||url.username||url.password)throw new Error('Use an exact origin without paths or credentials.');
 if(localTest){if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||Number(url.port)<18000||Number(url.port)>19999||!path.resolve(stateDir).startsWith('/tmp/foundkeep-collections'))throw new Error('Local seed tests require a disposable loopback server on ports 18000–19999 and /tmp/foundkeep-collections state.');}
 else if(origin!=='https://dev.foundkeep.app')throw new Error('Demo seeding is restricted to https://dev.foundkeep.app. Production is never a seed target.');
 const destination=canonicalDestination(stateDir),repo=realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
 if(destination===repo||destination.startsWith(repo+path.sep))throw new Error('Demo credentials must be stored outside the repository.');
 if(destination===path.parse(destination).root||destination===realpathSync(homedir()))throw new Error('Use a dedicated private directory for demo credentials.');
 if(localTest&&!destination.startsWith('/tmp/foundkeep-collections'))throw new Error('Local seed state must resolve to a disposable /tmp/foundkeep-collections directory.');
 return destination;
}
export async function seedDemo({origin='https://dev.foundkeep.app',stateDir=path.join(homedir(),'.local/share/foundkeep-dev-demo'),localTest=false}={}) {
 stateDir=validateTarget(origin,stateDir,localTest);
 if(!localTest){const config=await fetch(origin+'/customer-config.json',{redirect:'error',signal:AbortSignal.timeout(15000)});if(!config.ok||(await config.json()).extensionEnvironment!=='dev')throw new Error('The dev environment marker could not be verified. No demo writes were made.');}
 await mkdir(stateDir,{recursive:true,mode:0o700});await chmod(stateDir,0o700);
 const lockPath=path.join(stateDir,'seed.lock'),lock=await open(lockPath,'wx',0o600);
 const stateFile=path.join(stateDir,'state.json');
 let state;
 const sessions=[];
 try {
  try{state=JSON.parse(await readFile(stateFile,'utf8'));if(state.version!==1||state.origin!==origin)throw new Error('This demo state belongs to a different environment.');await chmod(stateFile,0o600);}
  catch(error){if(error.code!=='ENOENT')throw error;state={version:1,origin,accounts:{curator:{email:'curator@demo.foundkeep.invalid',name:'FoundKeep Demo',password:randomBytes(32).toString('base64url')},contributor:{email:'contributor@demo.foundkeep.invalid',name:'Demo Contributor',password:randomBytes(32).toString('base64url')}},collections:{}};}
  async function persist(){const temp=stateFile+'.pending';await writeFile(temp,JSON.stringify(state,null,2)+'\n',{mode:0o600});await rename(temp,stateFile);}
  state.entries||={};state.followed||={};state.captures||={};
  await persist();
  async function call(route,{method='GET',body,cookie,accountId}={}) {
   const response=await fetch(origin+'/api'+route,{method,redirect:'error',headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(accountId?{'X-Atlas-Account':accountId}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
   const data=await response.json().catch(()=>({}));return {response,data};
  }
  function checked(result,route){if(!result.response.ok)throw new Error(`Demo request ${route} returned HTTP ${result.response.status} (${result.data.error||'request_failed'}).`);return result.data;}
  async function connect(key){
   const fixture=state.accounts[key];let result=await call('/auth/login',{method:'POST',body:{email:fixture.email,password:fixture.password}});
   if(result.response.status===401&&!fixture.id){result=await call('/auth/register',{method:'POST',body:{email:fixture.email,name:fixture.name,password:fixture.password}});}
   const data=checked(result,'/auth/login or register');if(fixture.id&&fixture.id!==data.account.id)throw new Error('Demo account identity changed; refusing to write.');
   fixture.id=data.account.id;if(data.recoveryCode)fixture.recoveryCode=data.recoveryCode;await persist();
   const cookie=result.response.headers.getSetCookie().map(value=>value.split(';')[0]).find(value=>value.startsWith('atlas_session=')||value.startsWith('__Host-atlas_session='));
   if(!cookie)throw new Error('Demo session cookie is missing.');
   const session={accountId:fixture.id,cookie};sessions.push(session);
   return async(route,method='GET',body)=>checked(await call(route,{...session,method,body}),route);
  }
  const curator=await connect('curator'),contributor=await connect('contributor');
  const owned=await curator('/collections');let createdCollections=0,createdEntries=0;
  const publicPages=[],preservedRemovals=[];
  for(const fixture of demoCollections){
   let collection=owned.collections.find(item=>item.slug===fixture.slug);
   if(collection&&collection.role!=='owner')throw new Error(`Demo slug ${fixture.slug} belongs to another curator.`);
   if(state.collections[fixture.slug]&&collection&&state.collections[fixture.slug]!==collection.id)throw new Error('A demo collection identity changed; refusing to overwrite it.');
   if(!collection&&state.collections[fixture.slug]){preservedRemovals.push(fixture.slug);continue;}
   if(!collection){const {entries,...fields}=fixture;collection=(await curator('/collections','POST',{...fields,kind:'personal'})).collection;createdCollections++;}
   state.collections[fixture.slug]=collection.id;await persist();
   for(const entry of [...fixture.entries].reverse()){
    const {key,...fields}=entry,clientId=`fk-demo-v1-${fixture.slug}-${key}`;
    // Recorded fixtures are left alone, including entries a tester moved or removed.
    if(state.entries[clientId])continue;
    const result=await curator(`/collections/${collection.id}/entries`,'POST',{...fields,clientId});
    state.entries[clientId]=result.entry.id;createdEntries++;await persist();
   }
   if(collection.visibility==='public'){
    publicPages.push({title:collection.title,url:origin+'/collection/'+fixture.slug});
    if(!state.followed[collection.id]){await contributor(`/collections/${collection.id}/follow`,'POST',{});state.followed[collection.id]=true;await persist();}
   }
  }
  const agentId=state.collections['demo-agent-toolkit'];
  if(agentId&&!state.pendingEntry&&!preservedRemovals.includes('demo-agent-toolkit')){
   const result=await contributor(`/collections/${agentId}/entries`,'POST',{clientId:'fk-demo-v1-community-suggestion',title:'A demo suggestion waiting for review',body:'This is a deliberately pending demo entry. The curator can approve or decline it from the collection’s approval queue.',tags:['demo','review']});
   state.pendingEntry=result.entry.id;await persist();
  }
  for(const [index,note] of ['Welcome to your demo library. The public collections are ready to explore, follow, and share.','Use the private demo scratchpad to check visibility without adding real personal information.','Try the community suggestion in The agent toolkit: submissions stay private until the curator approves them.'].entries()){
   const clientId=`fk-demo-v1-library-note-${index}`;if(state.captures[clientId])continue;
   const result=await curator('/captures','POST',{clientId,type:'note',sourceTitle:'FoundKeep demo',noteText:note,capturedAt:Date.now(),processingOptions:{ocr:false,summaries:false,tags:false}});
   state.captures[clientId]=result.capture.id;await persist();
  }
  const graphSaves=await seedDemoGraph({state,persist,curator,origin});
  const report={origin,graphSaves,seededAt:new Date().toISOString(),createdCollections,createdEntries,publicPages,privateCollection:'/dashboard/collections/'+state.collections['demo-private-scratchpad'],starterNotes:Object.keys(state.captures).length,preservedRemovals,credentialsFile:stateFile};
  await writeFile(path.join(stateDir,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  return report;
 } finally {
  for(const session of sessions)await fetch(origin+'/api/auth/logout',{method:'POST',redirect:'error',headers:{Origin:origin,Cookie:session.cookie,'X-Atlas-Account':session.accountId,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)}).catch(()=>{});
  await lock.close();await unlink(lockPath);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2),value=name=>{const index=args.indexOf(name);return index===-1?undefined:args[index+1];};
 try{const report=await seedDemo({origin:value('--origin'),stateDir:value('--state-dir'),localTest:args.includes('--local-test')});console.log(JSON.stringify(report,null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
