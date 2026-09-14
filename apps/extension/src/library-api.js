// Only this fixed operation vocabulary may leave the extension. Callers cannot
// choose an origin, Authorization header, or arbitrary backend route.
const id = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error('Choose a valid saved item.'); return encodeURIComponent(value); };
export function libraryOperation(operation, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid library request.');
  if (operation === 'list') {
    const query = new URLSearchParams({ view:'cards',sort:'recent' });
    for (const key of ['q','type','folderId','tag','cursor']) if (args[key]) {
      if (typeof args[key] !== 'string' || args[key].length > (key === 'q' ? 200 : 256)) throw new Error('This filter is too long.');
      query.set(key,args[key]);
    }
    return {method:'GET',path:'/api/mobile/captures?'+query};
  }
  if (operation === 'collections') return {method:'GET',path:'/api/collections'};
  if (operation === 'submit-collection') return {method:'POST',path:`/api/collections/${id(args.id)}/entries`,body:args.value};
  if (operation === 'organization') return {method:'GET',path:'/api/organization'};
  if (operation === 'detail') return {method:'GET',path:`/api/mobile/captures/${id(args.id)}`};
  if (operation === 'preservation') return {method:'GET',path:`/api/mobile/captures/${id(args.id)}/preservation`};
  if (operation === 'retry-preservation') return {method:'POST',path:`/api/mobile/captures/${id(args.id)}/preservation`,body:{}};
  if (operation === 'asset-chunk') {
    const offset=args.offset??0;
    if (!Number.isSafeInteger(offset)||offset<0||offset>=50*1024*1024) throw new Error('Invalid saved file offset.');
    return {method:'GET',path:`/api/mobile/captures/${id(args.id)}/assets/${id(args.asset)}`,binary:true,range:`bytes=${offset}-${Math.min(offset+4*1024*1024-1,50*1024*1024-1)}`};
  }
  if (operation === 'preview') return {method:'GET',path:`/api/mobile/captures/${id(args.id)}/preview`,image:true};
  if (operation === 'update') return {method:'PUT',path:`/api/mobile/captures/${id(args.id)}`,body:args.value};
  if (operation === 'delete') return {method:'DELETE',path:`/api/mobile/captures/${id(args.id)}`};
  if (operation === 'create-folder') return {method:'POST',path:'/api/mobile/folders',body:{name:args.name,parentId:args.parentId??null}};
  if (operation === 'rename-folder') return {method:'PUT',path:`/api/mobile/folders/${id(args.id)}`,body:{name:args.name}};
  if (operation === 'delete-folder') return {method:'DELETE',path:`/api/mobile/folders/${id(args.id)}`};
  if (operation === 'create-note') return {method:'POST',path:'/api/captures',body:{clientId:args.clientId,type:'note',noteText:args.noteText,sourceTitle:args.title||null,folderId:args.folderId??null,userTags:args.tags||[]}};
  if (operation === 'import-preview') return {method:'POST',path:'/api/imports/preview',body:args};
  if (operation === 'import-chunk') return {method:'POST',path:'/api/imports',body:args};
  throw new Error('Unknown library action.');
}
export function trustedLibrarySender(sender, runtime) {
  if (sender?.id !== runtime.id) return false;
  try { const url=new URL(sender.url); return ['library.html','popup.html','dashboard.html'].some(page=>`${url.protocol}//${url.host}${url.pathname}`===runtime.getURL('src/'+page)); }
  catch {return false;}
}
