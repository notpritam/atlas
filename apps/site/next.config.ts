import type {NextConfig} from 'next';
const backend=process.env.FOUNDKEEP_BACKEND_URL||'http://127.0.0.1:8790';
const config:NextConfig={
 poweredByHeader:false,compress:true,reactStrictMode:true,productionBrowserSourceMaps:false,
 output:'standalone',outputFileTracingRoot:process.cwd().replace(/\/apps\/site$/,''),
 experimental:{sri:{algorithm:'sha256'},inlineCss:true},
 async redirects(){return [{source:'/index.html',destination:'/',permanent:true},...['auth','dashboard','support','privacy','terms','open'].map(page=>({source:`/${page}.html`,destination:`/${page}`,permanent:true}))];},
 async rewrites(){return {beforeFiles:[...['api','v1','admin','invite','ext'].map(route=>({source:`/${route}/:path*`,destination:`${backend}/${route}/:path*`})),...['healthz','customer-config.json','extension-policy.json','mobile-policy.json','updates.xml','atlas-extension.zip','foundkeep-extension.zip','redeem.html'].map(route=>({source:`/${route}`,destination:`${backend}/${route}`})),{source:'/.well-known/:path*',destination:`${backend}/.well-known/:path*`}],afterFiles:[],fallback:[]};},
 async headers(){return [{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'X-Frame-Options',value:'DENY'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'}]},{source:'/assets/:path*',headers:[{key:'Cache-Control',value:'public, max-age=86400, stale-while-revalidate=604800'}]}];}
};export default config;
