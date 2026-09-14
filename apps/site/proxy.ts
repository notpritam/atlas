import {NextRequest,NextResponse} from 'next/server';
export async function proxy(request:NextRequest){
 if(request.nextUrl.pathname==='/'){
  const hasSession=request.cookies.has('__Host-atlas_session')||request.cookies.has('atlas_session');
  if(hasSession){
   try{
    const response=await fetch(`${process.env.FOUNDKEEP_BACKEND_URL||'http://127.0.0.1:8790'}/api/auth/session`,{headers:{cookie:request.headers.get('cookie')||''},cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(response.ok&&(await response.json()).account){const redirect=NextResponse.redirect(new URL('/dashboard',request.url));redirect.headers.set('Cache-Control','private, no-store');return redirect;}
   }catch{/* A public page remains available while the account service recovers. */}
  }
  const response=NextResponse.next();response.headers.set('Cache-Control','private, no-store');return response;
 }

 const nonce=Buffer.from(crypto.randomUUID()).toString('base64');
 const isCheckout=request.nextUrl.pathname==='/checkout';
 const directives=[
  `default-src 'self'`,
  `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV==='development'?" 'unsafe-eval'":''}`,
  `style-src 'self' 'unsafe-inline'${isCheckout?' https://*.paddle.com':''}`,
  `img-src 'self' data: blob:${isCheckout?' https://*.paddle.com':''}`,
  `font-src 'self'${isCheckout?' https://*.paddle.com data:':''}`,
  `connect-src 'self'${isCheckout?' https://*.paddle.com':''}`,
  `base-uri 'none'`,
  `form-action 'self'`,
  ...(isCheckout?[`frame-src 'self' https://*.paddle.com https://sandbox-buy.paddle.com`]:[]),
  `frame-ancestors 'none'`,
  `object-src 'none'`,
 ];
 const policy=directives.join('; ');
 const headers=new Headers(request.headers);headers.set('x-nonce',nonce);headers.set('Content-Security-Policy',policy);
 const response=NextResponse.next({request:{headers}});response.headers.set('Content-Security-Policy',policy);response.headers.set('Cache-Control','private, no-store, max-age=0, no-transform');response.headers.set('Referrer-Policy','no-referrer');return response;
}
export const config={matcher:['/','/login','/signup','/recover','/auth','/dashboard/:path*','/open','/checkout']};
