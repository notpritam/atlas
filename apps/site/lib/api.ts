export class ApiError extends Error {
  constructor(message:string, public status=0, public code='') { super(message); }
}
export interface ApiOptions { method?:string; body?:unknown; signal?:AbortSignal; accountId?:string; download?:boolean }
export async function api<T = unknown>(path:string,{method='GET',body,signal,accountId,download=false}:ApiOptions={}):Promise<T> {
  const timeout=AbortSignal.timeout(download?120000:30000);
  let response:Response;
  try {
    response=await fetch(`/api${path}`,{method,credentials:'same-origin',cache:'no-store',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(accountId?{'X-Atlas-Account':accountId}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,timeout]):timeout});
  } catch(error) { if(signal?.aborted)throw error;throw new ApiError(typeof navigator!=='undefined'&&!navigator.onLine?'You’re offline. Reconnect to continue.':'FoundKeep could not be reached. Please try again.'); }
  if(!response.ok){const data=await response.json().catch(()=>({}));if(typeof window!=='undefined'&&((response.status===401&&!['invalid_credentials','invalid_pairing'].includes(data.error))||data.error==='account_changed'))window.dispatchEvent(new CustomEvent('atlas-session-expired',{detail:{code:data.error}}));throw new ApiError(typeof data.message==='string'?data.message.replace(/\bFoundkeep\b/g,'FoundKeep'):'That request could not be completed.',response.status,data.error);}
  if(download)return await response.blob() as T;
  return await response.json() as T;
}
export function downloadBlob(blob:Blob,filename:string){const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
