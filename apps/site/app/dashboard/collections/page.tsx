import type {Metadata} from 'next';
import {AccountPage} from '@/components/dashboard/account-page';
export const metadata:Metadata={title:'Your collections',robots:{index:false,follow:false}};
export default function Page(){return <AccountPage section="collections"/>;}
