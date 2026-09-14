import {useCallback,useRef,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {AppState,View} from 'react-native';
import {Button,Message} from '../components/ui.tsx';
import {useSession} from '../session/SessionProvider.tsx';
import {observeProcessing,processingMessage} from './processingObserver.ts';
import type {AutomationState,ProcessingState} from './types.ts';

export function ProcessCapture({id,status,onProcessed}:{id:string;status:string;onProcessed():void}) {
  const {client,account,token,refresh}=useSession();
  const [settings,setSettings]=useState<AutomationState|null>(null);
  const [state,setState]=useState<ProcessingState|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const observer=useRef<ReturnType<typeof observeProcessing>|null>(null);
  const epoch=useRef(0),completed=useRef(onProcessed);
  completed.current=onProcessed;
  useFocusEffect(useCallback(()=>{
    let live=true;
    setSettings(null);setState(null);setBusy(false);setError('');
    const stop=()=>{epoch.current++;observer.current?.stop();observer.current=null;};
    const start=()=>{
      stop();const current=epoch.current;
      const valid=()=>live&&current===epoch.current;
      setBusy(false);
      const loadSettings=()=>void client.automation().then(value=>{if(valid())setSettings(value);}).catch(()=>{});
      loadSettings();
      observer.current=observeProcessing({client,id,
        onState:value=>{if(valid()){setState(value);setError('');}},
        onTerminal:()=>{if(valid()){completed.current();loadSettings();void refresh().catch(()=>{});}},
        onError:()=>{if(valid())setError('Processing status could not load. Reopen this save to try again.');},
      });
    };
    if(AppState.currentState==='active')start();
    const subscription=AppState.addEventListener('change',value=>{if(value==='active')start();else stop();});
    return()=>{live=false;stop();subscription.remove();};
  },[client,account?.id,token,id,refresh]));
  const paused=settings?.mode==='paused';
  const active=state?.job?.status==='pending'||state?.job?.status==='running';
  const canProcess=settings?.enabled&&settings.available&&(settings.canProcess??settings.pro);
  const message=processingMessage(state);
  if(!canProcess&&!message&&!error)return null;
  return <View style={{gap:8}}>
    {canProcess?<Button secondary label={paused?'Processing paused':active?'Processing save':'Process save'} disabled={busy||paused||active||status==='pending'||status==='processing'} loading={busy} onPress={()=>{
      const current=epoch.current;setBusy(true);setError('');
      void client.processCapture(id).then(job=>{
        if(current!==epoch.current)return;
        setState({job:{...job,error:null,updatedAt:0},processing:null});
        // POST 202 is only a queue acknowledgment. Completion comes from the read observer.
        observer.current?.restart();
      }).catch(value=>{if(current===epoch.current)setError(value instanceof Error?value.message:'Processing could not start.');})
        .finally(()=>{if(current===epoch.current)setBusy(false);});
    }}/>:null}
    <Message>{message}</Message><Message error>{error}</Message>
  </View>;
}
