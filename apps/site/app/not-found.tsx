import Link from 'next/link';
export default function NotFound(){return <main className="route-error"><h1>That page wandered off.</h1><p>Return to your collection or explore FoundKeep.</p><a href="/dashboard">Open your collection</a><Link href="/">Back to FoundKeep</Link></main>;}
