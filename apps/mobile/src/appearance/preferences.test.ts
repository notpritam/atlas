import test from 'node:test';
import assert from 'node:assert/strict';
import { appearanceStorageKey, normalizeAppearance, resolvedAppearance } from './preferences.ts';
import palettes from '../palettes.json' with {type:'json'};
test('appearance supports explicit overrides and changing system appearance',()=>{
 assert.equal(normalizeAppearance(null),'system');assert.equal(normalizeAppearance('unexpected'),'system');
 assert.equal(resolvedAppearance('light','dark'),'light');assert.equal(resolvedAppearance('dark','light'),'dark');
 assert.equal(resolvedAppearance('system','dark'),'dark');assert.equal(resolvedAppearance('system','light'),'light');assert.equal(resolvedAppearance('system',null),'light');
 assert.notEqual(appearanceStorageKey('dev'),appearanceStorageKey('prod'));
});
test('light and dark palettes preserve readable body text contrast',()=>{
 const luminance=(hex:string)=>{const channels=[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);return channels[0]!*0.2126+channels[1]!*0.7152+channels[2]!*0.0722;};
 for(const palette of Object.values(palettes))for(const text of [palette.ink,palette.muted])for(const background of [palette.paper,palette.surface]) {
  const values=[luminance(text),luminance(background)].sort((a,b)=>b-a);assert.ok((values[0]!+0.05)/(values[1]!+0.05)>=4.5);
 }
});
