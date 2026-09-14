import {test} from 'node:test';
import assert from 'node:assert/strict';
import {libraryOperation,trustedLibrarySender} from '../apps/extension/src/library-api.js';
test('sidebar operations cannot choose remote origins, credentials or arbitrary paths',()=>{
 assert.throws(()=>libraryOperation('fetch',{url:'https://evil.test'}));
 for(const id of ['../connections','x?secret=true','https://evil.test','a/b'])assert.throws(()=>libraryOperation('detail',{id}));
 const request=libraryOperation('list',{q:'hello&folderId=foreign',folderId:'owned',url:'https://evil.test'});
 const url=new URL(request.path,'https://foundkeep.app');assert.equal(url.searchParams.get('q'),'hello&folderId=foreign');assert.equal(url.searchParams.get('folderId'),'owned');assert.equal(request.method,'GET');
 assert.equal(libraryOperation('preview',{id:'owned-id'}).path,'/api/mobile/captures/owned-id/preview');
});
test('only packaged library and popup pages can proxy customer content',()=>{
 const runtime={id:'own-extension',getURL:path=>'chrome-extension://own-extension/'+path};
 assert.equal(trustedLibrarySender({id:runtime.id,url:runtime.getURL('src/library.html')},runtime),true);
 for(const sender of [{id:'other',url:runtime.getURL('src/library.html')},{id:runtime.id,url:'https://foundkeep.app/dashboard'},{id:runtime.id,url:runtime.getURL('src/twitter.js')},{id:runtime.id,url:runtime.getURL('src/library.html/evil')}])assert.equal(trustedLibrarySender(sender,runtime),false);
});

test('private asset chunks use fixed owned routes and bounded ranges',()=>{
 assert.deepEqual(libraryOperation('asset-chunk',{id:'save',asset:'photo',offset:4194304}),{method:'GET',path:'/api/mobile/captures/save/assets/photo',binary:true,range:'bytes=4194304-8388607'});
 for(const offset of [-1,0.5,50*1024*1024,'0'])assert.throws(()=>libraryOperation('asset-chunk',{id:'save',asset:'photo',offset}));
 assert.throws(()=>libraryOperation('asset-chunk',{id:'save',asset:'../private'}));
});

test('save details keep manual tags bounded and normalize equivalent names',async()=>{
 const {normalizeSaveDetails,normalizeSaveTags}=await import('../apps/extension/src/save-details.js');
 assert.deepEqual(normalizeSaveDetails({sourceTitle:' My title ',noteText:' Private note ',folderId:'folder-a',userTags:['#UI','ui','React']}),{sourceTitle:'My title',noteText:'Private note',folderId:'folder-a',userTags:['UI','React']});
 assert.throws(()=>normalizeSaveTags(Array.from({length:21},(_,i)=>'tag'+i)));
 assert.throws(()=>normalizeSaveTags(Array.from({length:11},(_,i)=>'tag'+i),10));
 assert.throws(()=>normalizeSaveTags(['one\ntwo']));assert.throws(()=>normalizeSaveDetails({folderId:'../other'}));assert.throws(()=>normalizeSaveDetails({noteText:'x'.repeat(50001)}));assert.throws(()=>normalizeSaveDetails({sourceUrl:'https://evil.example'}));
});
