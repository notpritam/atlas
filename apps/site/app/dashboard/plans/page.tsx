import { AccountPage } from '../../../components/dashboard/account-page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Plans & usage', robots: { index: false, follow: false } };
export default function Page() { return <AccountPage section="plans" />; }
