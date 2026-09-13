'use client';
import {createContext,useContext,useEffect,useLayoutEffect,useState,type ReactNode} from 'react';
export type ThemePreference='light'|'dark'|'system';
const key='foundkeep.appearance';
const valid=(value:unknown):value is ThemePreference=>value==='light'||value==='dark'||value==='system';
const ThemeContext=createContext<{preference:ThemePreference;resolved:'light'|'dark';setPreference:(value:ThemePreference)=>void}>({preference:'system',resolved:'light',setPreference:()=>{}});
export function ThemeProvider({children}:{children:ReactNode}){
 const [preference,setPreferenceState]=useState<ThemePreference>('system'),[resolved,setResolved]=useState<'light'|'dark'>('light');
 useLayoutEffect(()=>{
  let stored:unknown;try{stored=localStorage.getItem(key);}catch{/* Use system appearance when browser storage is unavailable. */}
  setPreferenceState(valid(stored)?stored:'system');setResolved(document.documentElement.dataset.theme==='dark'?'dark':'light');
 },[]);
 useEffect(()=>{
  const media=matchMedia('(prefers-color-scheme: dark)');
  const apply=()=>{const next=preference==='system'?(media.matches?'dark':'light'):preference;document.documentElement.dataset.theme=next;document.documentElement.style.colorScheme=next;setResolved(next);};
  apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);
 },[preference]);
 useEffect(()=>{const sync=(e:StorageEvent)=>{if(e.key===key||e.key===null)setPreferenceState(valid(e.newValue)?e.newValue:'system');};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[]);
 const setPreference=(value:ThemePreference)=>{setPreferenceState(value);try{localStorage.setItem(key,value);}catch{/* The selection still works for this visit. */}};
 return <ThemeContext.Provider value={{preference,resolved,setPreference}}>{children}</ThemeContext.Provider>;
}
export const useTheme=()=>useContext(ThemeContext);
const icons={light:<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,dark:<path d="M20.5 13.5A8.5 8.5 0 0 1 10.5 3a9 9 0 1 0 10 10.5Z"/>,system:<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></>};
export function ThemeControl({compact=false}:{compact?:boolean}){
 const {preference,setPreference}=useTheme();
 if(compact)return <label className="theme-select" title="Appearance"><svg aria-hidden="true" viewBox="0 0 24 24">{icons[preference]}</svg><span className="sr-only">Appearance</span><select aria-label="Appearance" value={preference} onChange={e=>setPreference(e.target.value as ThemePreference)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>;
 return <div className="theme-choices" role="group" aria-label="Appearance">{(['light','dark','system'] as const).map(value=><button key={value} type="button" aria-pressed={preference===value} onClick={()=>setPreference(value)}><svg aria-hidden="true" viewBox="0 0 24 24">{icons[value]}</svg>{value[0].toUpperCase()+value.slice(1)}</button>)}</div>;
}
