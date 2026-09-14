import '../customer.css';
import Link from 'next/link';
import type {Metadata} from 'next';
import {BetaAccess} from '@/components/iphone-access';
export const metadata:Metadata={title:'Support',alternates:{canonical:'/support'}};
export default function Page(){return <div className="customer-body reading-body">

  <a className="skip-link" href="#main">Skip to content</a>
  <header className="site-header privacy-header wrap">
    <Link className="brand" href="/"><img src="/assets/studio-mark.svg?v=bookmark-evolved-1" width="36" height="36" alt="" /><span>FoundKeep</span></Link>
    <nav className="support-header-nav" aria-label="Support navigation"><a href="/dashboard">Open library</a><Link className="text-link" href="/">Back to FoundKeep</Link></nav>
  </header>

  <main className="support-page" id="main">
    <section className="support-hero" aria-labelledby="support-title">
      <div className="support-intro">
        <h1 id="support-title">Help, from save to sync.</h1>
        <p>Find the point where something stopped, follow the checks, and get back to your collection. FoundKeep keeps local captures available even when cloud sync is interrupted.</p>
        <div className="support-actions"><a className="button" href="#start">Start with the symptom <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14m-6-6 6 6 6-6"></path></svg></a><Link className="text-link" href="/privacy">Privacy &amp; data</Link></div>
      </div>
      <ol className="support-route" aria-label="FoundKeep capture route">
        <li><span>1</span><div><strong>Capture</strong><p>The extension saves to its local browser library first.</p></div></li>
        <li><span>2</span><div><strong>Queue</strong><p>Connected captures wait safely if your browser is offline.</p></div></li>
        <li><span>3</span><div><strong>Sync</strong><p>New items upload to the account connected in this browser.</p></div></li>
        <li><span>4</span><div><strong>Find</strong><p>Your dashboard reads that account’s private cloud library.</p></div></li>
      </ol>
    </section>

    <nav className="support-index" id="start" aria-label="Choose a support topic">
      <a href="#install"><span>Installation</span><strong>The extension will not load</strong><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg></a>
      <a href="#iphone"><span>iPhone</span><strong>FoundKeep is missing from Share</strong><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg></a>
      <a href="#connect"><span>Connection</span><strong>The browser is not connected</strong><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg></a>
      <a href="#capture"><span>Capture</span><strong>An item did not save correctly</strong><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg></a>
      <a href="#sync"><span>Sync</span><strong>A capture is missing online</strong><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg></a>
    </nav>

    <section className="support-section" id="install" aria-labelledby="install-support-title">
      <div className="support-section-heading"><h2 id="install-support-title">Install FoundKeep in the browser.</h2></div>
      <div className="support-answer">
        <ol>
          <li><strong>Install from the Chrome Web Store.</strong> Open the <a href="https://chromewebstore.google.com/detail/cficnecbdbiddngllpfbacabgbcjinmk" target="_blank" rel="noopener noreferrer">FoundKeep listing</a> in Chrome on your computer and choose <em>Add to Chrome</em>.</li>
          <li><strong>Let Chrome update it.</strong> The Store build starts at version 1.0.0 and receives approved updates automatically.</li>
          <li><strong>Pin FoundKeep.</strong> Open the browser’s extension menu and pin FoundKeep so the save controls stay within reach.</li>
          <li><strong>Using another Chromium browser?</strong> Edge, Brave, Opera and Vivaldi can use the manual ZIP from the <Link href="/#get">Get FoundKeep</Link> section when Store installation is unavailable.</li>
        </ol>
        <p className="support-note"><strong>Moving from an unpacked copy:</strong> connect it and sync wanted local-only captures before removing it. Chrome assigns separate storage to the Store build, while synced captures remain available in the same account dashboard.</p>
      </div>
    </section>

    <BetaAccess />

    <section className="support-section" id="iphone" aria-labelledby="iphone-support-title">
      <div className="support-section-heading"><h2 id="iphone-support-title">Add FoundKeep to the iPhone Share menu.</h2></div>
      <div className="support-answer">
        <ol>
          <li>Open the FoundKeep app once and create an account or sign in.</li>
          <li>In Safari, Photos, Files or another app, choose <strong>Share</strong>.</li>
          <li>Scroll through the app row. If FoundKeep is hidden, choose <strong>More</strong>, then add FoundKeep to Favorites.</li>
          <li>Choose FoundKeep, optionally add a note, and tap <strong>Save</strong>. Multiple selected items stay together in one collection group.</li>
        </ol>
        <p className="support-note">FoundKeep accepts links, selected or readable page text, images, video, audio, PDFs, documents and other files up to 50 MiB each. If the network drops, the Share Extension keeps a protected local copy and retries. Open FoundKeep to prompt an immediate retry.</p>
      </div>
    </section>

    <section className="support-section" id="connect" aria-labelledby="connect-support-title">
      <div className="support-section-heading"><h2 id="connect-support-title">Connect the right browser to the right account.</h2></div>
      <div className="support-answer">
        <ol>
          <li>Sign in at <a href="/login">foundkeep.app</a> in the browser where the extension is installed.</li>
          <li>Open <a href="/dashboard">your dashboard</a>, enter Account &amp; settings, and choose <strong>Connect FoundKeep</strong>.</li>
          <li>Approve the connection in the extension window. Its status should show the same account email as the dashboard.</li>
          <li>If it still shows another account, revoke that browser in account settings and connect it again.</li>
        </ol>
        <p className="support-note">Website sign-in and the extension connection are separate. Logging out of the website does not disconnect the extension, and revoking the extension does not delete its local captures.</p>
      </div>
    </section>

    <section className="support-section" id="capture" aria-labelledby="capture-support-title">
      <div className="support-section-heading"><h2 id="capture-support-title">Capture what the page allows FoundKeep to keep.</h2></div>
      <div className="support-answer">
        <ul>
          <li><strong>Protected browser pages:</strong> browsers block extensions on pages such as <code>chrome://</code>, extension stores, and some built-in PDF viewers. Open the original website and capture there.</li>
          <li><strong>Readable page:</strong> wait for the article to finish loading, then save it again. FoundKeep stores the useful text and available page metadata; sites may omit author, dates, images, or canonical URLs.</li>
          <li><strong>Highlight:</strong> select text on the page before choosing Save highlight. If the page replaces the selection, use Save page or add a note instead.</li>
          <li><strong>Image:</strong> allow the one-time site access prompt when FoundKeep needs to fetch the original image. Denying it prevents that image from being saved.</li>
          <li><strong>Screenshot:</strong> keep the page tab active until capture finishes. Very tall or animated pages can change while a full-page screenshot is assembled.</li>
        </ul>
        <p className="support-note">Every saved item keeps the strongest source record available, including the visited URL, canonical URL, title, site, capture method and capture time. Open the item details to return to its origin.</p>
      </div>
    </section>

    <section className="support-section" id="sync" aria-labelledby="sync-support-title">
      <div className="support-section-heading"><h2 id="sync-support-title">Sync a missing capture without losing the local copy.</h2></div>
      <div className="support-answer">
        <ol>
          <li>Open FoundKeep and confirm the capture appears in the extension’s local library.</li>
          <li>Check that the extension says <strong>Connected</strong> and that automatic sync is enabled in Capture settings.</li>
          <li>Leave the browser online for a moment. Pending uploads retry automatically after a connection returns.</li>
          <li>Refresh the web dashboard and confirm its signed-in email matches the extension.</li>
          <li>If the item predates the account connection, use the extension’s explicit import action. Older local captures are never uploaded without that choice.</li>
        </ol>
        <p className="support-note"><strong>Deletion is separate:</strong> deleting a cloud item does not remove its local browser copy, and removing a local copy does not delete an item already synced to the cloud.</p>
      </div>
    </section>

    <section className="support-section" id="account" aria-labelledby="account-support-title">
      <div className="support-section-heading"><h2 id="account-support-title">Recover account access with the code you saved.</h2></div>
      <div className="support-answer">
        <p>Choose <strong>Continue with email</strong>, then <strong>Recover your account</strong> on the <a href="/login">sign-in page</a>, then enter your account email and recovery code. FoundKeep shows the recovery code once when you create the account or change the password. It does not send password-reset emails.</p>
        <p>For Google or Apple sign-in, use the same verified email to return to your collection. Connecting the first provider to a password account asks for that password once. Apple’s Hide My Email creates a separate relay address; use your original sign-in method if you see an empty collection.</p>
        <p>Changing the password or using recovery revokes other website sessions and connected browsers. Sign in again, then reconnect each browser you still use.</p>
      </div>
    </section>

    <section className="support-section" id="settings" aria-labelledby="settings-support-title">
      <div className="support-section-heading"><h2 id="settings-support-title">Change capture behavior from your dashboard.</h2></div>
      <div className="support-answer">
        <p>Open Account &amp; settings to control capture methods, readable page extraction, metadata, note source attachment, popup order, automatic sync, OCR, summaries, and tags. In the iPhone app, Settings also controls capture-ready alerts. Connected browsers and iPhones refresh the data-only policy without a Store release.</p>
        <p>FoundKeep links can open sign-in, account recovery, the collection, Settings, a new note, or a specific capture. If the iPhone is signed out, FoundKeep asks the customer to sign in and then continues to the original safe destination. Links never contain account credentials or saved content.</p>
        <p>Browser permissions, executable extension code, iPhone native code, Share Extension capabilities and other manifest or entitlement changes arrive through signed Store updates. The iPhone interface and copy can update through EAS Update within the installed native runtime. FoundKeep’s remote policies contain data only and never download executable code.</p>
      </div>
    </section>

    <section className="support-close" aria-labelledby="more-help-title">
      <div><h2 id="more-help-title">Still stuck?</h2><p>Email FoundKeep support with your device or browser, FoundKeep version, capture type, what you expected, and what happened. Never include a password, recovery code, connection credential, private capture, or private page URL.</p><p>Contact: <a href="mailto:notpritamsharma@gmail.com">notpritamsharma@gmail.com</a></p></div>
      <div className="support-close-actions"><a className="button" href="mailto:notpritamsharma@gmail.com?subject=FoundKeep%20support">Email FoundKeep support <span aria-hidden="true">↗</span></a><a className="text-link" href="https://github.com/notpritam/foundkeep/issues" target="_blank" rel="noreferrer">View known issues</a></div>
    </section>

    <footer className="privacy-footer">FoundKeep support · version 1.0.0 · <Link href="/privacy">Privacy &amp; data</Link> · <Link href="/terms">Terms</Link> · <Link href="/#get">Get FoundKeep</Link></footer>
  </main>
</div>;}
