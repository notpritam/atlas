import type {Metadata} from 'next';
import {AccountPage} from '@/components/dashboard/account-page';
export const metadata:Metadata={title:'Manage collection',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{id:string}>}){return <AccountPage section="collections" collectionId={(await params).id}/>;}
