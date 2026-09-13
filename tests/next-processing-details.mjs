import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';
// An isolated fixture HTTP boundary: no accounts, database, keys, or provider calls.
const base=process.env.FOUNDKEEP_WEB_TEST_URL||'http://127.0.0.1:18795';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
test('reader discovers newly queued work and refreshes saved video and related results on completion',async t=>{
 let state='absent',polls=0,captureReads=0,relatedReads=0;
 const capture=()=>({id:'fixture-video',type:'bookmark',sourceTitle:'Fixture video',sourceUrl:'https://example.com/video.mp4',capturedAt:1,status:'done',tags:[],...(state==='done'?{fileUrl:'/api/captures/fixture-video/file',fileMime:'video/mp4',fileName:'Preserved video.mp4',fileBytes:123}: {})});
 const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://fixture.test').pathname;
  let value={};
  if(path==='/api/me')value={account:{id:'fixture-owner',email:'fixture@example.test',name:'Fixture',createdAt:1},connections:[],usage:{captures:1,bytes:100,maxCaptures:100,maxBytes:100000}};
  else if(path==='/api/captures')value={captures:[capture()],total:1,nextCursor:null};
  else if(path==='/api/captures/fixture-video'){captureReads++;value={capture:capture()};}
  else if(path==='/api/captures/fixture-video/processing'){
   polls++;value={job:state==='absent'?null:{id:'fixture-job',status:state,error:null,updatedAt:state==='done'?2:1},processing:state==='done'?{model:'media-preservation',processedAt:2,source:null,result:{download:{status:'downloaded',sourceUrl:'https://example.com/video.mp4',notice:'A video copy is preserved.',bytes:123,mime:'video/mp4',sha256:'fixture-hash',durationSeconds:2,transcriptStatus:'unavailable'}}}:null};
  }else if(path==='/api/captures/fixture-video/related'){relatedReads++;value={items:[]};}
  else if(path==='/api/automation')value={enabled:true,available:true,pro:true,mode:'instant'};
  else if(path==='/api/plan')value={pro:true};
  else if(path==='/api/preferences')value={preferences:{capture:{},bookmark:{},notes:{},popup:{},sync:{},organization:{},feedback:{}},revision:1};
  else if(path==='/api/collections')value={collections:[]};
  else if(path==='/customer-config.json')value={extensionIds:[]};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));
 });
 await new Promise(r=>server.listen(18794,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 t.after(async()=>{await browser.close();await new Promise(r=>server.close(r));});
 const page=await browser.newPage({reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/dashboard?item=fixture-video');await page.getByRole('heading',{name:'Fixture video',exact:true}).waitFor();
 await page.getByRole('button',{name:'Organize with Foundkeep'}).waitFor();
 assert.equal(await page.locator('#detail-panel video').count(),0);
 state='running';
 await page.getByRole('status').filter({hasText:'Processing this save'}).waitFor({timeout:12000});
 const beforeCapture=captureReads,beforeRelated=relatedReads;state='done';
 await page.locator('#detail-panel video').waitFor({timeout:12000});
 assert.equal(await page.locator('#detail-panel video').getAttribute('src'),'/api/captures/fixture-video/file');
 await page.getByText('Processing & preserved source',{exact:true}).click();await page.getByText('A video copy is preserved.',{exact:true}).waitFor();
 assert.ok(captureReads>beforeCapture);assert.ok(relatedReads>beforeRelated);assert.ok(polls>=3);assert.deepEqual(errors,[]);
});
