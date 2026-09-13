import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { getEnvironment } from '../environment.ts';
import { appearanceStorageKey, normalizeAppearance, resolvedAppearance, type AppearancePreference } from './preferences.ts';
const Context = createContext({preference:'system' as AppearancePreference,scheme:'light' as 'light'|'dark',setPreference:async (_value:AppearancePreference)=>{}});
export function AppearanceProvider({children}:{children:ReactNode}) {
  const [preference,setValue] = useState<AppearancePreference>('system');
  const [ready,setReady] = useState(false);
  const system = useColorScheme();
  const key = appearanceStorageKey(getEnvironment().environment);
  useEffect(()=>{
    let live=true;
    void (async()=>{try { const raw=Platform.OS==='web'?localStorage.getItem(key):await SecureStore.getItemAsync(key);if(live)setValue(normalizeAppearance(raw)); } catch {} finally {if(live)setReady(true);} })();
    return()=>{live=false;};
  },[key]);
  useEffect(()=>{if(ready&&Platform.OS!=='web')Appearance.setColorScheme(preference==='system'?'unspecified':preference);},[preference,ready]);
  const setPreference=async(value:AppearancePreference)=>{
    if(Platform.OS==='web')localStorage.setItem(key,value);else await SecureStore.setItemAsync(key,value);
    setValue(value);
  };
  return <Context.Provider value={{preference,scheme:resolvedAppearance(preference,system),setPreference}}>{children}</Context.Provider>;
}
export const useAppearance=()=>useContext(Context);
