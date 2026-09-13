import type {FoundkeepClient} from '../api/client.ts';
import type {ProcessingState} from './types.ts';

type Options = {
  client: Pick<FoundkeepClient,'processingState'>;
  id: string;
  onState(state: ProcessingState): void;
  onTerminal(): void;
  onError?(): void;
};
/** One foreground/focus lifetime: briefly discover automatic jobs, then follow active work. */
export function observeProcessing({client,id,onState,onTerminal,onError}: Options) {
  let generation=0, stopped=false, reads=0, terminal='';
  let timer:ReturnType<typeof setTimeout>|undefined, request:AbortController|undefined;
  function cancel() { generation++;clearTimeout(timer);request?.abort(); }
  async function read(current:number) {
    request=new AbortController();reads++;
    try {
      const value=await client.processingState(id,request.signal);
      if(stopped||current!==generation)return;
      onState(value);
      const job=value.job;
      if(job&&!['pending','running'].includes(job.status)){
        const signature=JSON.stringify([job.id,job.status,job.updatedAt,value.processing?.processedAt]);
        if(signature!==terminal){terminal=signature;onTerminal();}
        return;
      }
      // Six discovery reads (~25s), at most 360 active reads (~30min).
      if(reads<(job?360:6))timer=setTimeout(()=>void read(current),5000);
    }catch{
      if(stopped||current!==generation)return;
      onError?.();
      if(reads<6)timer=setTimeout(()=>void read(current),5000);
    }
  }
  function restart(){if(stopped)return;cancel();reads=0;void read(generation);}
  restart();
  return {restart,stop(){stopped=true;cancel();}};
}

/** Display only known customer copy, never raw provider/download errors. */
export function processingMessage(state:ProcessingState|null):string {
  const status=state?.job?.status;
  if(status==='pending')return 'Queued for processing. Your saved copy and details will update when ready.';
  if(status==='running')return 'Processing this save. Your saved copy and details will update when ready.';
  if(status==='paused')return 'Processing is paused. Resume it in processing settings.';
  if(status==='cancelled')return 'Processing was cancelled. Your original is safe.';
  if(status==='failed')return 'Processing could not finish. Your original is safe. The source may be unavailable; add saved text or a note and retry.';
  const download=state?.processing?.result.download;
  if(download?.status==='downloaded')return 'A video copy is preserved.'+(download.transcriptStatus==='available'?' Supplied subtitles were available.':' No subtitles were supplied.');
  if(download)return 'A video copy was unavailable. No video was downloaded; your original source is safe.';
  if(state?.processing?.result.sourceError)return 'The source did not expose readable public content. Only your saved content was used.';
  return status==='done'?'Processing finished.':'';
}
