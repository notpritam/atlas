import '../customer.css';
import Link from 'next/link';
import type {Metadata} from 'next';
export const metadata:Metadata={title:'Terms',alternates:{canonical:'/terms'}};
export default function Page(){return <div className="customer-body reading-body">
  <a className="skip-link" href="#main">Skip to content</a>
  <header className="site-header privacy-header wrap"><Link className="brand" href="/"><img src="/assets/studio-mark.svg?v=bookmark-evolved-1" width="36" height="36" alt="" /><span>Foundkeep</span></Link><Link className="text-link" href="/">Back to Foundkeep</Link></header>
  <main className="privacy-document" id="main">
    <h1>Terms of use.</h1>
    <p className="updated">Updated 12 September 2026</p>
    <p className="privacy-lead">These terms govern your use of Foundkeep's website, cloud account, browser extension, iPhone app and Share Extension. By creating an account or using the service, you agree to them.</p>
    <h2>Your account</h2>
    <p>Provide accurate account information, keep your password and recovery code private, and tell Foundkeep promptly if you believe your account has been compromised. You are responsible for activity performed through your account and connected devices.</p>
    <h2>Your collection and content rights</h2>
    <p>You keep ownership of content you save. You give Foundkeep the limited permission needed to receive, store, process, display, export and delete that content at your direction so the service can work.</p>
    <p>You may save content only when you own it, have permission, or are otherwise allowed to do so under applicable law and the source service's terms. Do not use Foundkeep to infringe intellectual-property or privacy rights, distribute unlawful material, abuse the service, bypass access controls, or harm other people or systems.</p>
    <h2>Private use</h2>
    <p>Foundkeep is designed as a private personal collection. It does not publish your captures to other customers. Source links can take you to third-party sites and apps; their content, availability and terms remain the responsibility of those third parties.</p>
    <h2>Optional Pro subscription</h2>
    <p>The core collection, imports and customer-connected MCP agents are available on Free. Pro includes 500 managed processing credits per calendar month in UTC and 2 GiB of storage. Credits reserve when work is queued and are consumed only when a result is applied. Failed or cancelled work releases its reservation. Unused monthly credits do not roll over. Subscriptions are optional; limits are shown in your account.</p>
    <p>Web Pro costs USD $5 per month. The iPhone app displays the localized App Store price before purchase. Subscriptions renew automatically unless cancelled through the provider. Manage web subscriptions from account settings and App Store subscriptions through your Apple Account. Apple controls App Store billing and refund requests. Cancelling renewal normally retains access until the paid period ends. If a subscription expires, existing saves remain, but new uploads can be limited if storage exceeds the Free allowance. Deleting your Foundkeep account does not cancel App Store billing.</p>
    <h2>Processing and connected agents</h2>
    <p>Managed processing is enabled only with your permission and can produce inaccurate summaries, tags or relationships. Public-source and media extraction depend on source availability and processing limits. Foundkeep does not promise access to private social posts or complete video transcripts. Your original saved content and personal tags are preserved. You control which external agents can access your collection and are responsible for their instructions and any provider costs.</p>
    <h2>Service changes and availability</h2>
    <p>Foundkeep may improve, limit or discontinue features and may use data-only policy updates, EAS Update and Store releases as described in the <Link href="/privacy">Privacy Policy</Link>. Keep a separate copy of anything you cannot afford to lose. Reasonable efforts are made to keep the service available, but uninterrupted or error-free operation is not guaranteed.</p>
    <h2>Suspension</h2>
    <p>Foundkeep may restrict or terminate access when reasonably necessary to protect the service or other people, respond to law, or address a material violation of these terms. Where practical, you will have an opportunity to export your collection first.</p>
    <h2>Deleting your account</h2>
    <p>You may export or permanently delete your cloud account from the web dashboard. Deletion removes active cloud captures, uploaded files, preferences and credentials as described in the Privacy Policy. Local browser copies and files you exported remain under your control.</p>
    <h2>Warranty and responsibility</h2>
    <p>Foundkeep is provided as available. To the extent permitted by law, Foundkeep disclaims implied warranties and is not responsible for indirect, incidental or consequential loss. Nothing in these terms limits rights or remedies that cannot legally be limited.</p>
    <h2>Changes to these terms</h2>
    <p>If these terms materially change, the updated date will change and reasonable notice will be provided where required. Continuing to use Foundkeep after the change takes effect means you accept the revised terms.</p>
    <h2>Contact</h2>
    <p>Questions about these terms or Foundkeep can be sent to <a href="mailto:notpritamsharma@gmail.com">notpritamsharma@gmail.com</a>. For product help, visit <Link href="/support">Foundkeep Support</Link>.</p>
    <footer className="privacy-footer">Foundkeep terms · <Link href="/support">Support</Link> · <Link href="/privacy">Privacy &amp; data</Link> · <Link href="/">Home</Link></footer>
  </main>
</div>;}
