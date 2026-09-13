// Keep standalone type checks as strict as Expo's dev server after a checkout.
// These generator APIs come from the installed, SDK-pinned Expo Router packages.
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const require=createRequire(import.meta.url);
const root=fileURLToPath(new URL('../',import.meta.url));
process.env.EXPO_ROUTER_APP_ROOT=path.join(root,'src/app');
const {requireContext}=require('expo-router/internal/testing');
const {EXPO_ROUTER_CTX_IGNORE}=require('expo-router/_ctx-shared');
// The generator belongs to Expo CLI, not to the app or expo-router. Follow
// declared dependency owners so Bun's isolated installs need no hoisted packages.
const expoRequire=createRequire(require.resolve('expo/package.json'));
const cliRequire=createRequire(expoRequire.resolve('@expo/cli/package.json'));
const {getTypedRoutesDeclarationFile}=cliRequire('@expo/router-server/build/typed-routes/generate');
const types=getTypedRoutesDeclarationFile(requireContext(process.env.EXPO_ROUTER_APP_ROOT,true,EXPO_ROUTER_CTX_IGNORE),{});
if(!types)throw new Error('Expo Router did not generate route declarations.');
const output=path.join(root,'.expo/types');mkdirSync(output,{recursive:true});
writeFileSync(path.join(output,'router.d.ts'),types);
