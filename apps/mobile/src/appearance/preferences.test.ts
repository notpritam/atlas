import test from 'node:test';
import assert from 'node:assert/strict';
import * as appearance from './preferences.ts';
import palettes from '../palettes.json' with {type:'json'};
const { appearanceStorageKey, normalizeAppearance, resolvedAppearance } = appearance;
test('appearance supports explicit overrides and changing system appearance',()=>{
 assert.equal(normalizeAppearance(null),'system');assert.equal(normalizeAppearance('unexpected'),'system');
 assert.equal(resolvedAppearance('light','dark'),'light');assert.equal(resolvedAppearance('dark','light'),'dark');
 assert.equal(resolvedAppearance('system','dark'),'dark');assert.equal(resolvedAppearance('system','light'),'light');assert.equal(resolvedAppearance('system',null),'light');
 assert.notEqual(appearanceStorageKey('dev'),appearanceStorageKey('prod'));
});
test('native theme revisions change when appearance or text scale changes',()=>{
 const revision=(appearance as unknown as {nativeThemeRevision?: (scheme:'light'|'dark',fontScale?:number)=>string}).nativeThemeRevision;
 assert.equal(typeof revision,'function');
 assert.notEqual(revision?.('light',1),revision?.('dark',1));
 assert.notEqual(revision?.('dark',1),revision?.('dark',1.2));
});
test('Android resource colors resolve from the selected scheme before native configuration catches up',()=>{
 const resolve=(appearance as unknown as {resolvedThemeColor?: (value:unknown,scheme:'light'|'dark')=>unknown}).resolvedThemeColor;
 assert.equal(typeof resolve,'function');
 const ink={resource_paths:['@color/foundkeep_ink']};
 assert.equal(resolve?.(ink,'light'),palettes.light.ink);
 assert.equal(resolve?.(ink,'dark'),palettes.dark.ink);
 assert.equal(resolve?.('#123456','dark'),'#123456');
});
test('mounted surface styles receive concrete backgrounds and borders for each scheme',()=>{
 const resolve=(appearance as unknown as {resolvedThemeStyle?: (value:unknown,scheme:'light'|'dark')=>unknown}).resolvedThemeStyle;
 assert.equal(typeof resolve,'function');
 const source={backgroundColor:{resource_paths:['@color/foundkeep_surface']},borderColor:{resource_paths:['@color/foundkeep_line']},borderRadius:12};
 assert.deepEqual(resolve?.(source,'light'),{backgroundColor:palettes.light.surface,borderColor:palettes.light.line,borderRadius:12});
 assert.deepEqual(resolve?.(source,'dark'),{backgroundColor:palettes.dark.surface,borderColor:palettes.dark.line,borderRadius:12});
});
test('light and dark palettes preserve readable body text contrast',()=>{
 const luminance=(hex:string)=>{const channels=[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);return channels[0]!*0.2126+channels[1]!*0.7152+channels[2]!*0.0722;};
 for(const palette of Object.values(palettes))for(const text of [palette.ink,palette.muted])for(const background of [palette.paper,palette.surface]) {
  const values=[luminance(text),luminance(background)].sort((a,b)=>b-a);assert.ok((values[0]!+0.05)/(values[1]!+0.05)>=4.5);
 }
});
