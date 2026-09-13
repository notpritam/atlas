import {expect,test} from 'bun:test';
import {customerNativeUrl} from '../src/customer-native.ts';
test('all server environments reuse the canonical app scheme',()=>{
 expect(customerNativeUrl('oauth/complete','https://dev.foundkeep.app')).toBe('foundkeep://oauth/complete');
 expect(customerNativeUrl('capture/abc','https://dev.foundkeep.app')).toBe('foundkeep://capture/abc');
 expect(customerNativeUrl('oauth/complete','https://foundkeep.app')).toBe('foundkeep://oauth/complete');
 expect(customerNativeUrl('oauth/complete','https://dev.foundkeep.app.evil.test')).toBe('foundkeep://oauth/complete');
});

test('association documents advertise only the current environment identity and configured signing certificates',async()=>{
 const {openDb}=await import('../src/db.ts'),{createApp}=await import('../src/app.ts'),{config}=await import('../src/config.ts');const db=openDb(':memory:'),original=config.customerOrigin,team=process.env.ATLAS_APPLE_TEAM_ID,fingerprints=process.env.ATLAS_ANDROID_SHA256_CERT_FINGERPRINTS;
 try{
  config.customerOrigin='https://dev.foundkeep.app';process.env.ATLAS_APPLE_TEAM_ID='A1B2C3D4E5';process.env.ATLAS_ANDROID_SHA256_CERT_FINGERPRINTS=Array(32).fill('AA').join(':');const app=createApp(db);
  expect(await(await app.request('https://dev.foundkeep.app/.well-known/apple-app-site-association')).json()).toMatchObject({applinks:{details:[{appIDs:['A1B2C3D4E5.app.foundkeep.ios']}]}});
  expect(await(await app.request('https://dev.foundkeep.app/.well-known/assetlinks.json')).json()).toEqual([{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:'app.foundkeep.android',sha256_cert_fingerprints:[Array(32).fill('AA').join(':')]}}]);
  process.env.ATLAS_ANDROID_SHA256_CERT_FINGERPRINTS='invalid';expect(await(await app.request('https://dev.foundkeep.app/.well-known/assetlinks.json')).json()).toEqual([]);
 }finally{db.close();config.customerOrigin=original;if(team===undefined)delete process.env.ATLAS_APPLE_TEAM_ID;else process.env.ATLAS_APPLE_TEAM_ID=team;if(fingerprints===undefined)delete process.env.ATLAS_ANDROID_SHA256_CERT_FINGERPRINTS;else process.env.ATLAS_ANDROID_SHA256_CERT_FINGERPRINTS=fingerprints;}
});
