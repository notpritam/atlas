import {NextRequest,NextResponse} from 'next/server';
export function proxy(request:NextRequest){
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
export const config={matcher:['/login','/signup','/recover','/auth','/dashboard/:path*','/open','/checkout']};
