import 'server-only';
import {cookies} from 'next/headers';
import {cache} from 'react';
import {ApiError} from './api';
import type {Me} from './types';
const backend=process.env.FOUNDKEEP_BACKEND_URL||'http://127.0.0.1:8790';
export async function serverApi<T>(path:string,accountId?:string):Promise<T> {
  if(!path.startsWith('/')||path.startsWith('//'))throw new Error('Invalid internal API path');
  const cookie=(await cookies()).toString();
  const response=await fetch(`${backend}/api${path}`,{cache:'no-store',headers:{cookie,...(accountId?{'X-Atlas-Account':accountId}:{})},signal:AbortSignal.timeout(15000)});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new ApiError(typeof data.message==='string'?data.message.replace(/\bFoundkeep\b/g,'FoundKeep'):'FoundKeep is temporarily unavailable.',response.status,data.error);}
  return await response.json() as T;
}
export const getSession=cache(async():Promise<Me|null>=>{try{return await serverApi<Me>('/me');}catch(error){if(error instanceof ApiError&&error.status===401)return null;throw error;}});
