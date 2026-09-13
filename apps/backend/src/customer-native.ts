/** Both beta and released binaries reuse the existing app identity. API realms,
 * pending PKCE handshakes and native storage namespaces enforce environment isolation. */
export function customerNativeIdentity(_origin?:string){
 return {scheme:'foundkeep',iosBundleId:'app.foundkeep.ios',androidPackage:'app.foundkeep.android'};
}
export function customerNativeUrl(path:string,origin?:string){return customerNativeIdentity(origin).scheme+'://'+path;}
