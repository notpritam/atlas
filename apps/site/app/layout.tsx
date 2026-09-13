import type {Metadata,Viewport} from 'next';
import type {ReactNode} from 'react';
import './global.css';
export const metadata:Metadata={metadataBase:new URL('https://foundkeep.app'),title:{default:'Foundkeep — A place for the things worth keeping',template:'%s — Foundkeep'},description:'Keep links, highlights, photos and files in one private collection. Save from your browser, iPhone or the web.',icons:{icon:'/assets/studio-mark.svg?v=bookmark-evolved-1',apple:[{url:'/assets/apple-touch-icon.png?v=bookmark-evolved-1',sizes:'180x180',type:'image/png'}]},openGraph:{type:'website',siteName:'Foundkeep',images:[{url:'/assets/foundkeep-scenic-social.png',width:1200,height:630}]},twitter:{card:'summary_large_image'}};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#f1f4f4'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><head><link rel="preload" href="/assets/fonts/geist-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/><link rel="preload" href="/assets/fonts/ClarityCity-Medium.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/></head><body>{children}</body></html>;}
