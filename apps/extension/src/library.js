import {bindCollections} from './collections-ui.js';
import {bindSidebarDestination} from './sidebar-destination.js';
import {bindSidebarCapture} from './sidebar-capture.js';
import {bindSidebarLocal} from './sidebar-local.js';
import {bindConnections} from './connections.js';
import { $,icon,hydrateIcons,domain,ago,sourceUrl,openDialog,wireDialog } from './ui.js';
import { parseBookmarkHtml,flattenBookmarkTree,IMPORT_MAX_BYTES } from './bookmark-import.js';
import { CUSTOMER_ORIGIN } from './product.js';

let accountId=null,organization={folders:[],tags:[]},rows=[],cursor=null,type='',epoch=0,detail=null,preview=null;
let refreshTimer,searchTimer,mode='list';const images=new Map();let imageQueue=[],imageWorkers=0;
hydrateIcons();document.querySelectorAll('dialog').forEach(dialog=>{wireDialog(dialog);dialog.querySelectorAll('.close-dialog').forEach(button=>button.onclick=()=>dialog.close());});
function notice(text=''){ $('notice').hidden=!text;$('notice').textContent=text; }
async function message(kind,args={}){const result=await chrome.runtime.sendMessage({kind,accountId,...args});if(!result?.ok)throw new Error(result?.error||'FoundKeep could not respond. Try again.');return result.data;}
const api=(operation,args={})=>message('library-request',{operation,args});
function options(select,empty,items){const selected=select.value;select.replaceChildren(new Option(empty,''));for(const item of items)select.add(new Option(item.displayName||item.name,item.id??item.name));if([...select.options].some(option=>option.value===selected))select.value=selected;}
function renderOrganization(){
  options($('folder'),'All folders',[{id:'unfiled',name:'Unfiled'},...organization.folders]);
  options($('tag'),'All tags',organization.tags);
  options($('editFolder'),'Unfiled',organization.folders);options($('folderParent'),'Top level',organization.folders);
}
const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);imageQueue.push({target:entry.target,id:entry.target.dataset.id,owner:accountId});void loadImages();}},{rootMargin:'150px'});
async function loadImages(){
  if(imageWorkers>=3)return;imageWorkers++;
  try{while(imageQueue.length){const job=imageQueue.shift();if(job.owner!==accountId||!job.target.isConnected)continue;
    try{
      let url=images.get(job.id);if(!url){url=(await api('preview',{id:job.id})).dataUrl;if(job.owner!==accountId)continue;images.set(job.id,url);while(images.size>40)images.delete(images.keys().next().value);}
      if(job.owner!==accountId||!job.target.isConnected)continue;const img=new Image();img.alt='';img.src=url;job.target.replaceChildren(img);
    }catch{/* Original source and type stay visible when an image is unavailable. */}
  }}finally{imageWorkers--;}
}
const cardSizes=new ResizeObserver(entries=>{for(const {target} of entries)target.style.gridRowEnd=mode==='gallery'?`span ${Math.ceil(target.getBoundingClientRect().height+10)}`:'';});
function renderRows(){
  cardSizes.disconnect();
  observer.disconnect();imageQueue=[];$('items').replaceChildren();$('items').classList.toggle('gallery',mode==='gallery');
  for(const save of rows){
    const button=document.createElement('button');button.className='save-card';button.type='button';button.dataset.id=save.id;
    button.innerHTML=`<span class="save-preview">${icon(save.type)}</span><span class="save-copy"><span class="save-title"></span><span class="save-meta"></span><span class="save-folder"></span></span>`;
    button.querySelector('.save-title').textContent=save.sourceTitle||save.noteText||save.selectionText||'Untitled save';
    button.querySelector('.save-meta').textContent=`${domain(save.sourceUrl)} · ${ago(save.createdAt)}`;
    const folder=organization.folders.find(folder=>folder.id===save.folderId);
    const tags=(save.userTags||[]).slice(0,2).map(tag=>'#'+tag).join(' ');
    const meta=button.querySelector('.save-folder');meta.textContent=folder?.displayName||folder?.name||tags||({iphone:'Saved from iPhone',browser:'Saved from browser',dashboard:'Saved on the web'}[save.savedVia])||'';meta.hidden=!meta.textContent;
    button.onclick=()=>void openSave(save.id);$('items').append(button);cardSizes.observe(button);
    const target=button.querySelector('.save-preview');target.dataset.id=save.id;if(save.previewUrl||save.blobUrl)observer.observe(target);
  }
}
async function loadCollection(append=false){
  if(!accountId)return;const owner=accountId,revision=++epoch;notice();$('more').disabled=true;
  if(!append){rows=[];cursor=null;observer.disconnect();$('items').innerHTML='<div class="shimmer"></div>'.repeat(3);$('empty').hidden=true;}
  try{
    const result=await api('list',{q:$('q').value.trim(),type,folderId:$('folder').value,tag:$('tag').value,...(append&&cursor?{cursor}:{})});
    if(owner!==accountId||revision!==epoch)return;
    rows=append?[...rows,...result.captures]:result.captures;cursor=result.nextCursor;
    $('total').textContent=`${result.total.toLocaleString()} ${result.total===1?'save':'saves'}`;renderRows();
    $('empty').hidden=rows.length>0;$('empty').textContent=$('q').value||type||$('folder').value||$('tag').value?'No saves match these filters.':'Your next good find starts here. Save a page or import your bookmarks.';
    $('more').hidden=!cursor;$('more').disabled=false;
  }catch(error){if(owner===accountId&&revision===epoch){notice(error.message);if(!append)$('items').replaceChildren();$('more').disabled=false;}}
}
async function refresh(){
  try{
    const state=await chrome.runtime.sendMessage({kind:'cloud-status'});if(!state?.ok)throw new Error(state?.error||'Could not load the connection.');
    const next=state.account?.id||null;
    if(next!==accountId){sharedCollections.reset();epoch++;images.clear();rows=[];preview=null;detail=null;$('detail').hidden=true;for(const id of ['importDialog','folderDialog','deleteDialog'])$(id).close();}
    accountId=next;const connected=!!accountId&&state.status!=='reconnect';
    $('accountLabel').textContent=state.account?`${state.account.name||'Your collection'} · ${state.status==='reconnect'?'Reconnect this browser':'Connected'}`:'Your own little corner of the internet';
    $('connect').hidden=connected;$('collection').hidden=!connected||!$('detail').hidden;
    $('openImport').disabled=!connected;
    if(!connected)return;
    const owner=accountId;const data=await api('organization');if(owner!==accountId)return;organization=data;renderOrganization();await loadCollection();await updateImportProgress();
  }catch(error){notice(error.message);}
}
function back(){detail=null;$('detail').hidden=true;$('collection').hidden=false;$('q').focus();}
async function openSave(id){
  const owner=accountId;notice();
  try{const result=await api('detail',{id});if(owner!==accountId)return;showEditor(result.capture);}
  catch(error){notice(error.message);}
}
function showEditor(save=null){
  sharedCollections.reset();
  detail=save;renderOrganization();$('collection').hidden=true;$('detail').hidden=false;
  $('detailKind').textContent=save?`${save.type} · ${ago(save.createdAt)}`:'A new note';
  $('editTitle').value=save?.sourceTitle||'';$('editNote').value=save?.noteText||'';$('editFolder').value=save?.folderId||'';$('editTags').value=(save?.userTags||[]).join(', ');
  $('saveEdit').textContent=save?'Save changes':'Save note';$('deleteSave').hidden=!save;$('expand').hidden=!save;
  if(save)$('expand').href=CUSTOMER_ORIGIN+'/dashboard/saved/'+encodeURIComponent(save.id);
  const origin=sourceUrl(save?.sourceUrl);$('origin').hidden=!origin;if(origin)$('origin').href=origin;
  $('content').textContent=save?.articleText||save?.selectionText||save?.summary||'';$('provenance').replaceChildren();
  for(const item of save?.importOrigins||[]){const paragraph=document.createElement('p');paragraph.textContent=`Imported from ${item.source}${item.folderPath?.length?' · '+item.folderPath.join(' / '):''}${item.addedAt?' · Bookmarked '+new Date(item.addedAt).toLocaleDateString():''}`;$('provenance').append(paragraph);}
  if(save?.provenance?.pageUrl){const p=document.createElement('p');p.textContent=save.provenance.pageUrl;$('provenance').append(p);}
  $('sourceDetails').hidden=!$('provenance').childElementCount;$('editTitle').focus();
}
$('editor').onsubmit=async event=>{
  event.preventDefault();const owner=accountId;const save=detail;$('saveEdit').disabled=true;notice();
  try{
    const userTags=[...new Set($('editTags').value.split(',').map(tag=>tag.trim()).filter(Boolean))];
    if(userTags.length>20||userTags.some(tag=>tag.length>40))throw new Error('Use up to 20 tags, with at most 40 characters each.');
    const value={sourceTitle:$('editTitle').value.trim()||null,noteText:$('editNote').value.trim()||null,folderId:$('editFolder').value||null,userTags};
    if(save)await api('update',{id:save.id,value:{...value,expectedUpdatedAt:save.updatedAt}});
    else {if(!value.noteText)throw new Error('Write something to keep in this note.');await api('create-note',{clientId:crypto.randomUUID(),title:value.sourceTitle,noteText:value.noteText,folderId:value.folderId,tags:userTags});}
    if(owner===accountId){back();await refresh();notice('Saved to your collection.');}
  }catch(error){if(owner===accountId)notice(error.message);}finally{$('saveEdit').disabled=false;}
};
async function previewImport(parsed){
  preview=null;$('confirmImport').disabled=true;$('importError').textContent='';$('importPreview').hidden=false;$('importPreview').textContent='Checking your bookmarks…';
  const owner=accountId,source=$('importSource').value;
  try{
    const result=await api('import-preview',{source,entries:parsed.entries});if(owner!==accountId)return;
    preview={accountId:owner,source,entries:parsed.entries};
    $('importPreview').textContent=`${result.newBookmarks.toLocaleString()} new bookmarks · ${result.duplicates.toLocaleString()} already saved · ${result.folders.toLocaleString()} folders. ${parsed.skipped+result.skipped} unsupported entries skipped.${!result.fitsCaptureLimit?' This exceeds your remaining library allowance. Import a smaller export.':''}`;
    $('confirmImport').disabled=!result.fitsCaptureLimit||!parsed.entries.length;
  }catch(error){$('importPreview').hidden=true;$('importError').textContent=error.message;}
}
$('readBrowser').onclick=async()=>{
  // Permission request is the first call from this direct user gesture.
  const permission=chrome.permissions.request({permissions:['bookmarks']});
  $('readBrowser').disabled=true;$('importError').textContent='';
  try{if(!await permission)throw new Error('Bookmark access was not granted. You can import an HTML export instead.');const tree=await chrome.bookmarks.getTree();await previewImport(flattenBookmarkTree(tree));}
  catch(error){$('importError').textContent=error.message;}finally{$('readBrowser').disabled=false;}
};
$('importFile').onchange=async()=>{
  const file=$('importFile').files[0];if(!file)return;
  try{if(file.size>IMPORT_MAX_BYTES)throw new Error('Choose a bookmark export smaller than 8 MB.');await previewImport(parseBookmarkHtml(await file.text()));}
  catch(error){preview=null;$('confirmImport').disabled=true;$('importError').textContent=error.message;}
};
$('importSource').onchange=()=>{preview=null;$('confirmImport').disabled=true;$('importPreview').hidden=true;$('importFile').value='';};
$('confirmImport').onclick=async()=>{
  if(!preview||preview.accountId!==accountId)return;$('confirmImport').disabled=true;
  try{await message('bookmark-import-start',preview);preview=null;await updateImportProgress();}
  catch(error){$('importError').textContent=error.message;$('confirmImport').disabled=!preview;}
};
async function updateImportProgress(){
  if(!accountId)return;try{const progress=await message('bookmark-import-status');const el=$('importProgress');el.hidden=!progress;if(!progress)return;
    el.replaceChildren();const text=document.createElement('p');
    text.textContent=progress.otherAccount?'An unfinished import belongs to another connected account. Reconnect that account to resume it.':progress.status==='complete'?`Done. ${progress.imported} bookmarks imported; ${progress.duplicates} existing saves kept.`:`${progress.offset} of ${progress.total} bookmarks checked${progress.status==='paused'?' · Paused':''}`;el.append(text);
    if(!progress.otherAccount){const bar=document.createElement('progress');bar.max=progress.total||1;bar.value=progress.offset;bar.setAttribute('aria-label','Bookmark import progress');el.append(bar);}
    $('retryImport').hidden=progress.status!=='paused'||!!progress.otherAccount;$('cancelImport').hidden=progress.status==='complete';
    if(progress.error)$('importError').textContent=progress.error;
  }catch(error){$('importError').textContent=error.message;}
}
$('retryImport').onclick=()=>void message('bookmark-import-retry').then(updateImportProgress).catch(error=>{$('importError').textContent=error.message;});
$('cancelImport').onclick=()=>void message('bookmark-import-cancel').then(()=>{preview=null;$('confirmImport').disabled=true;return updateImportProgress();});
$('openImport').onclick=()=>{openDialog($('importDialog'));void updateImportProgress();};
$('q').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>void loadCollection(),220);};
$('folder').onchange=$('tag').onchange=()=>void loadCollection();
$('types').onclick=event=>{const button=event.target.closest('[data-type]');if(!button)return;type=button.dataset.type;for(const item of $('types').children)item.setAttribute('aria-current',String(item===button));void loadCollection();};
$('toggleView').onclick=()=>{mode=mode==='gallery'?'list':'gallery';$('toggleView').setAttribute('aria-label',`Switch to ${mode==='gallery'?'list':'gallery'} view`);renderRows();void chrome.storage.local.set({foundkeepLibraryView:mode});};
$('back').onclick=back;$('refresh').onclick=()=>void refresh();$('more').onclick=()=>void loadCollection(true);
$('newFolder').onclick=()=>{renderOrganization();$('folderName').value='';$('folderError').textContent='';openDialog($('folderDialog'));};
$('folderForm').onsubmit=async event=>{event.preventDefault();$('saveFolder').disabled=true;try{await api('create-folder',{name:$('folderName').value,parentId:$('folderParent').value||null});$('folderDialog').close();await refresh();}catch(error){$('folderError').textContent=error.message;}finally{$('saveFolder').disabled=false;}};
$('deleteSave').onclick=()=>openDialog($('deleteDialog'));
$('confirmDelete').onclick=async()=>{if(!detail)return;$('confirmDelete').disabled=true;try{await api('delete',{id:detail.id});$('deleteDialog').close();back();await refresh();}catch(error){$('deleteDialog').close();notice(error.message);}finally{$('confirmDelete').disabled=false;}};
chrome.runtime.onMessage.addListener(message=>{
  if(message.kind==='atlas-import-changed')void updateImportProgress();
  if(message.kind==='atlas-changed'){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>void refresh(),350);}
});
window.addEventListener('focus',()=>void refresh());
document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!document.querySelector('dialog[open]')){event.preventDefault();$('q').focus();}});
void chrome.storage.local.get('foundkeepLibraryView').then(value=>{mode=value.foundkeepLibraryView==='gallery'?'gallery':'list';}).then(refresh);

const sharedCollections=bindCollections(document.getElementById('library-collections'),{getAccountId:()=>accountId,getSource:async()=>detail||{title:document.getElementById('editTitle').value}});

const localLibrary=bindSidebarLocal();
const settings=bindConnections($('connections'),{showDashboard:false});
$('openSettings').onclick=()=>{openDialog($('settingsDialog'));void settings.load();};
bindSidebarCapture({onSaved:()=>{void localLibrary.refresh();setTimeout(()=>void refresh(),1000);}});
chrome.runtime.onMessage.addListener(event=>{if(event.kind==='atlas-changed'&&$('settingsDialog').open)void settings.load();});

bindSidebarDestination();
