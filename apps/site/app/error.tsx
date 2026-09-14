'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="route-error"><h1>Let’s try that again.</h1><p>FoundKeep couldn’t load this page. Your collection is safe. Please try again.</p><button onClick={reset}>Try again</button><a href="/">Back to FoundKeep</a></main>;}
