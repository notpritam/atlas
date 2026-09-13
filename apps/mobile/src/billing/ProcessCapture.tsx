import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Message } from '../components/ui.tsx';
import { useSession } from '../session/SessionProvider.tsx';
import type { AutomationState } from './types.ts';
export function ProcessCapture({ id, status, onProcessed }: { id: string; status: string; onProcessed(): void }) {
  const { client, account } = useSession();
  const [settings,setSettings] = useState<AutomationState|null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  useEffect(()=>{ let live=true;setSettings(null);void client.automation().then(value=>{if(live)setSettings(value);}).catch(()=>{});return()=>{live=false;}; },[client,account?.id,id]);
  if (!settings?.enabled || !settings.available) return null;
  const paused = settings.mode === 'paused';
  return <View style={{gap:8}}><Button secondary label={paused?'Processing paused':'Process save'} disabled={busy||paused||status==='processing'} loading={busy} onPress={()=>{
    setBusy(true);setError('');void client.processCapture(id).then(onProcessed).catch(error=>setError(error instanceof Error?error.message:'Processing could not start.')).finally(()=>setBusy(false));
  }}/><Message error>{error}</Message></View>;
}
