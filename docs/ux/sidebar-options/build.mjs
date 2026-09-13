import { readFile, writeFile } from 'node:fs/promises';
const here=new URL('./',import.meta.url);
const root=new URL('../../../',import.meta.url);
const data=async(path,mime)=>'data:'+mime+';base64,'+(await readFile(new URL(path,root))).toString('base64');
const replacements={
  __GEIST__:await data('apps/web/assets/fonts/geist-latin.woff2','font/woff2'),
  __CLARITY__:await data('apps/web/assets/fonts/ClarityCity-Medium.woff2','font/woff2'),
  __MARK__:await data('apps/web/assets/mark.svg','image/svg+xml'),
  __MOUNTAIN__:await data('apps/web/assets/scenic-mountains-800.webp','image/webp'),
};
let surface=await readFile(new URL('surface.html',here),'utf8');
for(const [key,value]of Object.entries(replacements))surface=surface.replaceAll(key,value);
let gallery=await readFile(new URL('gallery.html',here),'utf8');
for(const [key,value]of Object.entries(replacements))gallery=gallery.replaceAll(key,value);
gallery=gallery.replace('__SURFACE_JSON__',JSON.stringify(surface).replaceAll('<','\\u003c'));
await writeFile(new URL('explore.html',here),gallery);
await writeFile(new URL('library-first.html',here),surface);
console.log('Built self-contained sidebar exploration ('+Buffer.byteLength(gallery)+' bytes).');
