import type {MetadataRoute} from 'next';

export default function manifest():MetadataRoute.Manifest {
 return {
  id:'/',name:'FoundKeep',short_name:'FoundKeep',
  description:'Keep links, highlights, photos and files in one private collection.',
  start_url:'/dashboard',scope:'/',display:'standalone',
  background_color:'#f1f4f4',theme_color:'#f1f4f4',
  icons:[
   {src:'/assets/mark-192.png?v=bookmark-evolved-1',sizes:'192x192',type:'image/png',purpose:'any'},
   {src:'/assets/mark-512.png?v=bookmark-evolved-1',sizes:'512x512',type:'image/png',purpose:'any'},
   {src:'/assets/mark-maskable-512.png?v=bookmark-evolved-1',sizes:'512x512',type:'image/png',purpose:'maskable'},
  ],
 };
}
