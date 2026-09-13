import { AccountPage } from '../../../components/dashboard/account-page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account settings', robots: { index: false, follow: false } };
export default function Page() { return <AccountPage section="settings" />; }
