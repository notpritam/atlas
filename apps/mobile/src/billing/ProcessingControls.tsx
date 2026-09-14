import {useEffect,useRef,useState} from 'react';
import {Alert,Pressable,Switch,View} from 'react-native';
import {AdaptiveText as Text} from '../components/AdaptiveText.tsx';
import {FrostedPanel} from '../components/ScenicSurface.tsx';
import {Button,Field,Message} from '../components/ui.tsx';
import {useSession} from '../session/SessionProvider.tsx';
import {useAppearance} from '../appearance/AppearanceProvider.tsx';
import {palettes,typography} from '../theme.ts';
import type {AutomationState} from './types.ts';
export function ProcessingControls(){
 const {client,account}=useSession();const [settings,setSettings]=useState<AutomationState|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const {scheme}=useAppearance();const palette=palettes[scheme];
 const generation=useRef(0); const [limit,setLimit]=useState('');
 useEffect(()=>{if(settings)setLimit(String(settings.monthlyLimit));},[settings?.monthlyLimit]);
 useEffect(()=>{const current=++generation.current;setSettings(null);setBusy(false);void client.automation().then(value=>{if(current===generation.current)setSettings(value);}).catch(()=>{});return()=>{generation.current++;};},[client,account?.id]);
 const update=async(value:Partial<AutomationState>,expected=generation.current)=>{if(expected!==generation.current||busy)return;setBusy(true);setError('');try{const next=await client.updateAutomation(value);if(expected===generation.current)setSettings(next);}catch(e){if(expected===generation.current)setError(e instanceof Error?e.message:'Preferences could not be saved.');}finally{if(expected===generation.current)setBusy(false);}};
 const change=(key:'enabled'|'fetchLinks'|'images',checked:boolean)=>{
  const expected=generation.current;
  if(checked&&(key==='enabled'||key==='images'))Alert.alert(key==='enabled'?'Organize your saves with OpenAI?':'Include images?',key==='enabled'?'Selected saved text, titles and source URLs will be sent to OpenAI for summaries, tags and connections. Originals and personal tags are preserved.':'Saved images and video previews can be sent to OpenAI to understand their contents.',[{text:'Cancel',style:'cancel'},{text:'Allow',onPress:()=>void update({[key]:checked,consentVersion:settings?.consentVersion},expected)}]);
  else void update({[key]:checked},expected);
 };
 if(!settings)return null;
 return <FrostedPanel><Text style={typography.heading}>Processing, on your terms.</Text><Text style={typography.small}>New saves are organized after you enable this. You can turn it off anytime.</Text>
  {([{key:'enabled',title:'Managed processing',detail:'Summaries, tags and related saves'},{key:'fetchLinks',title:'Read public links',detail:'Accessible articles and post metadata'},{key:'images',title:'Understand images',detail:'Share image and video previews with OpenAI'}] as const).map(item=><View key={item.key} style={{flexDirection:'row',alignItems:'center',gap:14,paddingVertical:12}}><View style={{flex:1,gap:4}}><Text style={typography.label}>{item.title}</Text><Text style={typography.small}>{item.detail}</Text></View><Switch accessibilityLabel={item.title} value={settings[item.key]} disabled={busy||!settings.available||(!(settings.canProcess??settings.pro)&&!settings.enabled)||(item.key!=='enabled'&&!settings.enabled)} trackColor={{true:palette.accent}} onValueChange={value=>change(item.key,value)}/></View>)}
  <Text style={typography.label}>When to process</Text>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{([{value:'instant',label:'Instant'},{value:'scheduled',label:'Scheduled'},{value:'manual',label:'Manual'},{value:'paused',label:'Paused'}] as const).map(mode=><Pressable key={mode.value} accessibilityRole="radio" accessibilityState={{checked:settings.mode===mode.value,disabled:busy}} disabled={busy} onPress={()=>void update({mode:mode.value})} style={{minHeight:44,padding:12,borderRadius:12,backgroundColor:settings.mode===mode.value?palette.accentSoft:palette.surface}}><Text style={typography.label}>{mode.label}</Text></Pressable>)}</View>
  <Text style={typography.small}>{settings.mode==='paused'?'All processing is paused, including requests to process individual saves.':settings.mode==='manual'?'Choose Process save on an individual save when you want it organized.':settings.mode==='scheduled'?'New saves wait for your chosen schedule.':'New saves are processed as they arrive.'} These preferences do not grant consent.</Text>
  {settings.mode==='scheduled'?<View style={{gap:8}}><Text style={typography.label}>Run every</Text><View style={{flexDirection:'row',gap:8}}>{([1,6,24] as const).map(hours=><Pressable key={hours} accessibilityRole="radio" accessibilityState={{checked:settings.intervalHours===hours}} disabled={busy} onPress={()=>void update({intervalHours:hours})} style={{minHeight:44,padding:12,borderRadius:12,backgroundColor:settings.intervalHours===hours?palette.accentSoft:palette.surface}}><Text style={typography.label}>{hours} {hours===1?'hour':'hours'}</Text></Pressable>)}</View>{settings.nextRunAt?<Text style={typography.small}>Next run: {new Date(settings.nextRunAt).toLocaleString()}</Text>:null}</View>:null}
  <Field label="Monthly processing limit" help="0 to 500 saves. Your plan's included allowance still applies." keyboardType="number-pad" value={limit} onChangeText={setLimit} editable={!busy} />
  <Button label="Save monthly limit" secondary disabled={busy||!/^\d{1,3}$/.test(limit)||Number(limit)>500||Number(limit)===settings.monthlyLimit} onPress={()=>void update({monthlyLimit:Number(limit)})}/>
  <Text style={typography.small}>{settings.usage.used} used · {settings.usage.reserved} queued · {settings.usage.limit} included · {settings.monthlyLimit} monthly limit.</Text>{!settings.available?<Text style={typography.small}>Managed processing is awaiting provider setup. Your free collection remains available.</Text>:null}<Message error>{error}</Message>
 </FrostedPanel>;
}
