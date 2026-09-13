import Link from 'next/link';
import type {Metadata} from 'next';
import {LandingProvider,LandingHeader,HeroActions,ExtensionLink,ExtensionNote,IphoneLink,IphoneBadge,IphoneAvailability,PlatformGrid,Reveal} from '@/components/landing-interactions';
import {CaptureDemo} from '@/components/capture-demo';
import './landing.css';

const title='Foundkeep — A place for the things worth keeping';
const description='Keep links, highlights, photos and files in one private collection. Save from your browser, iPhone or the web, then find your good ideas again.';
const url='https://foundkeep.app/';
const preview={url:'https://foundkeep.app/assets/foundkeep-scenic-social.png',width:1200,height:630,alt:'Foundkeep — Found it? Keep it. A private collection for your good finds.'};
export const metadata:Metadata={
 alternates:{canonical:url},description,robots:{index:true,follow:true},
 openGraph:{type:'website',siteName:'Foundkeep',url,title,description,images:[preview]},
 twitter:{card:'summary_large_image',title,description,images:[preview]},
};
const structuredData={
 '@context':'https://schema.org',
 '@graph':[
  {'@type':'Organization','@id':`${url}#organization`,name:'Foundkeep',url,logo:'https://foundkeep.app/assets/mark-512.png?v=bookmark-evolved-1'},
  {'@type':'WebSite','@id':`${url}#website`,name:'Foundkeep',url,description,publisher:{'@id':`${url}#organization`}},
  {'@type':'SoftwareApplication',name:'Foundkeep',url,description,applicationCategory:'ProductivityApplication',operatingSystem:'Web, Chrome, iOS',publisher:{'@id':`${url}#organization`}},
 ],
};
export default function Home(){return <LandingProvider><div className="landing-body">
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(structuredData).replace(/</g,'\\u003c')}}/>
    <a className="skip-link" href="#main">Skip to content</a>
    <svg className="icon-definitions" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <symbol id="i-arrow" viewBox="0 0 24 24">
          <path d="M5 12h14m-6-6 6 6-6 6"></path>
        </symbol>
        <symbol id="i-external" viewBox="0 0 24 24">
          <path d="M14 4h6v6m0-6L10 14M10 4H4v16h16v-6"></path>
        </symbol>
        <symbol id="i-bookmark" viewBox="0 0 24 24">
          <path d="M6 3h12v18l-6-4-6 4z"></path>
        </symbol>
        <symbol id="i-highlight" viewBox="0 0 24 24">
          <path d="m7 14 9-9 4 4-9 9H7zm0 0 4 4M5 21h14M4 18l3-3"></path>
        </symbol>
        <symbol id="i-image" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="3"></rect>
          <path d="m3 17 6-6 4 4 3-3 5 5M15 7h.01"></path>
        </symbol>
        <symbol id="i-note" viewBox="0 0 24 24">
          <path d="M14 3H4v18h16V9zm0 0v6h6M8 13h8m-8 4h5"></path>
        </symbol>
        <symbol id="i-link" viewBox="0 0 24 24">
          <path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1" transform="translate(1 0) scale(.92)"></path>
        </symbol>
        <symbol id="i-folder" viewBox="0 0 24 24">
          <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"></path>
        </symbol>
        <symbol id="i-check" viewBox="0 0 24 24">
          <path d="m5 12 4 4L19 6"></path>
        </symbol>
        <symbol id="i-shield" viewBox="0 0 24 24">
          <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"></path>
          <path d="m8 12 3 3 5-6"></path>
        </symbol>
        <symbol id="i-sync" viewBox="0 0 24 24">
          <path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5"></path>
        </symbol>
        <symbol id="i-globe" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z"></path>
        </symbol>
        <symbol id="i-phone" viewBox="0 0 24 24">
          <rect x="6" y="2" width="12" height="20" rx="3"></rect>
          <path d="M10 5h4m-3 14h2"></path>
        </symbol>
        <symbol id="i-chrome" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9"></circle>
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 8h8M8.5 14 5 6m9 9-4 6"></path>
        </symbol>
        <symbol id="i-search" viewBox="0 0 24 24">
          <circle cx="10" cy="10" r="6"></circle>
          <path d="m15 15 5 5"></path>
        </symbol>
        <symbol id="i-plus" viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14"></path>
        </symbol>
        <symbol id="i-menu" viewBox="0 0 24 24">
          <path d="M4 7h16M4 12h16M4 17h16"></path>
        </symbol>
        <symbol id="i-close" viewBox="0 0 24 24">
          <path d="m6 6 12 12M6 18 18 6"></path>
        </symbol>
        <symbol id="i-tag" viewBox="0 0 24 24">
          <path d="M3 3h8l10 10-8 8L3 11V3Z"></path>
          <circle cx="7.5" cy="7.5" r="1"></circle>
        </symbol>
        <symbol id="i-share" viewBox="0 0 24 24">
          <path d="M12 15V3m-4 4 4-4 4 4M6 10H4v11h16V10h-2"></path>
        </symbol>
        <symbol id="i-download" viewBox="0 0 24 24">
          <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"></path>
        </symbol>
        <symbol id="i-sun" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"></path>
        </symbol>
      </defs>
    </svg>
    <div className="page-shell" id="top">
      <main id="main">
        <section className="hero" aria-labelledby="hero-heading">
          <div className="architecture hero-scenery">
            <picture className="scenery"><source type="image/webp" srcSet="\n                  /assets/foundkeep-alpine-800.webp   800w,\n                  /assets/foundkeep-alpine-1600.webp 1600w\n                " sizes="(max-width: 540px) 1130px, 100vw" />
              <img src="/assets/foundkeep-alpine-1600.webp" alt="" aria-hidden="true" width="1600" height="1000" decoding="async" fetchPriority="high" /></picture>
          </div>
          <LandingHeader />
          <div className="hero-copy">
            <h1 id="hero-heading">
              Found it? Keep it.<br /><span>Let your mind wander.</span>
            </h1>
            <p>
              Links, highlights, and little sparks of inspiration.<br className="desktop-break" />
              One collection. On your iPhone, in your browser, everywhere.
            </p>
            <HeroActions />


          </div>
          <div className="hero-caption">
            <span>Less scattered. More found.</span><a href="#capture">Take a look around <span aria-hidden="true">↓</span></a>
          </div>
        </section>
        <div className="trust-strip wrap" aria-label="Foundkeep features">
          <span><svg aria-hidden="true" viewBox="0 0 24 24">
              <use href="#i-shield"></use>
            </svg>
            Your collection stays private</span><span><svg aria-hidden="true" viewBox="0 0 24 24">
              <use href="#i-link"></use>
            </svg>
            Find your way back to the source</span><span><svg aria-hidden="true" viewBox="0 0 24 24">
              <use href="#i-sync"></use>
            </svg>
            Browser to pocket</span>
        </div>

        <Reveal><section className="section wrap capture-section" id="capture" aria-labelledby="capture-heading">
          <div className="section-heading">
            <h2 id="capture-heading">
              A good find deserves<br />a place to stay.
            </h2>
            <p>
              A sentence that sticks. A place to go. An idea for later.<br className="desktop-break" />
              Save it in the moment, without breaking your flow.
            </p>
          </div>
          <CaptureDemo />
        </section></Reveal>

        <Reveal><section className="section wrap library-section" id="library" aria-labelledby="library-heading">
          <div className="section-heading">
            <h2 id="library-heading">
              All your curiosities.<br />A little more connected.
            </h2>
            <p>
              Bring the things you love into one collection.<br className="desktop-break" />
              Keep the original source, so you can always go back.
            </p>
          </div>
          <div className="collection-preview library-product" aria-label="Illustrative collection showing saved links, images and notes">
            <div className="collection-top">
              <span className="preview-brand"><img src="/assets/studio-mark.svg?v=bookmark-evolved-1" width="27" height="27" alt="" aria-hidden="true" />Your collection</span><span className="preview-search"><svg aria-hidden="true" viewBox="0 0 24 24">
                  <use href="#i-search"></use>
                </svg>
                A place for your next good find</span><a href="/dashboard" className="round-link" aria-label="Open your Foundkeep dashboard"><svg aria-hidden="true" viewBox="0 0 24 24">
                  <use href="#i-arrow"></use></svg></a>
            </div>
            <div className="collection-grid">
              <article className="collection-card photo-card">
                <div className="collection-photo mountain-photo">
                  <img src="/assets/foundkeep-alpine-800.webp" width="800" height="500" alt="Saved travel inspiration: alpine mountain peaks under a clear blue sky" loading="lazy" decoding="async" />
                </div>
                <div className="collection-card-body">
                  <span className="item-kind"><svg aria-hidden="true" viewBox="0 0 24 24">
                      <use href="#i-link"></use>
                    </svg>
                    A place to go</span>
                  <h3>Take the scenic route.</h3>
                  <div className="item-tags">
                    <span>Travel</span><span>Someday</span>
                  </div>
                </div>
              </article>
              <article className="collection-card quote-card">
                <span className="item-kind"><svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-highlight"></use>
                  </svg>
                  A thought to keep</span>
                <blockquote>
                  “Pay attention.<br />The ordinary things<br />are often the<br />extraordinary
                  ones.”
                </blockquote>
                <div className="item-tags"><span>Inspiration</span></div>
              </article>
              <article className="collection-card photo-card">
                <div className="collection-photo">
                  <img src="/assets/studio-architecture-640.webp" width="640" height="427" alt="Saved architecture inspiration: a sunlit building beside an olive tree" loading="lazy" decoding="async" />
                </div>
                <div className="collection-card-body">
                  <span className="item-kind"><svg aria-hidden="true" viewBox="0 0 24 24">
                      <use href="#i-image"></use>
                    </svg>
                    A detail you noticed</span>
                  <h3>Light, space, and a little quiet.</h3>
                  <div className="item-tags">
                    <span>Design</span><span>Spaces</span>
                  </div>
                </div>
              </article>
            </div>
            <div className="collection-bottom">
              <span>Illustrative collection · sample content</span><a href="/signup">Make it yours
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <use href="#i-arrow"></use></svg></a>
            </div>
          </div>
          <div className="library-benefits">
            <div>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <use href="#i-link"></use>
              </svg>
              <h3>The story stays attached.</h3>
              <p>
                Original links, author and page details stay with your saves. A
                readable copy keeps useful article text close.
              </p>
            </div>
            <div>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <use href="#i-folder"></use>
              </svg>
              <h3>A place for every possibility.</h3>
              <p>
                Group saves into folders, add your own tags, and find the things
                you need with keyword search.
              </p>
            </div>
            <div>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <use href="#i-shield"></use>
              </svg>
              <h3>Your space. Your choice.</h3>
              <p>
                Keep browser captures local, or connect your account to bring
                new saves into your private cloud collection.
              </p>
            </div>
          </div>
          <details className="interface-disclosure">
            <summary>
              See the current browser library
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <use href="#i-plus"></use>
              </svg>
            </summary>
            <figure>
              <img src="/assets/extension-library.png" width="1440" height="1050" alt="Foundkeep browser library showing search, saved links, images, notes and filters for each capture type" loading="lazy" decoding="async" />
              <figcaption>
                Actual browser extension interface · sample collection
              </figcaption>
            </figure>
          </details>
        </section></Reveal>

        <Reveal><section className="section wrap everywhere-section" id="everywhere" aria-labelledby="everywhere-heading">
          <div className="section-heading">
            <h2 id="everywhere-heading">
              Wherever you find it.<br />Foundkeep comes along.
            </h2>
            <p>
              At your desk, on a walk, or down a rabbit hole.<br className="desktop-break" />
              There’s a simple way to keep what catches your eye.
            </p>
          </div>
          <PlatformGrid>
            <article className="platform-card">
              <div className="platform-art mint browser-art" aria-hidden="true">
                <div className="sticker sticker-browser">Stay in your flow</div>
                <div className="mini-browser">
                  <div className="mini-browser-bar">
                    <span></span><span></span><span></span>
                    <div>Something worth keeping</div>
                  </div>
                  <div className="mini-lines"><i></i><i></i><i></i></div>
                  <div className="mini-capture">
                    <img src="/assets/studio-mark.svg?v=bookmark-evolved-1" width="27" height="27" alt="" aria-hidden="true" /><strong>Save page</strong><span><svg aria-hidden="true" viewBox="0 0 24 24">
                        <use href="#i-plus"></use></svg></span>
                  </div>
                </div>
                <div className="art-label">One click. Kept.</div>
              </div>
              <div className="platform-copy">
                <div className="platform-title">
                  <h3>For your browser</h3>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-chrome"></use>
                  </svg>
                </div>
                <p>
                  Save pages, screenshots, highlights and images without leaving
                  the moment.
                </p>
                <ExtensionLink className="text-link" />
              </div>
            </article>
            <article className="platform-card phone-platform">
              <div className="platform-art sky phone-art" aria-hidden="true">
                <div className="share-phone">
                  <div className="phone-island"></div>
                  <div className="phone-page">
                    A good find,<br />on the go.
                    <div className="phone-photo"></div>
                  </div>
                  <div className="share-sheet">
                    <div className="sheet-handle"></div>
                    <span>Share this moment</span>
                    <div className="share-apps">
                      <div>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <use href="#i-note"></use>
                        </svg>
                      </div>
                      <div className="foundkeep-share">
                        <img src="/assets/studio-mark.svg?v=bookmark-evolved-1" width="38" height="38" alt="" aria-hidden="true" /><span>Foundkeep</span>
                      </div>
                      <div>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <use href="#i-link"></use>
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="sticker sticker-phone">Share. Save. Carry on.</div>
              </div>
              <div className="platform-copy">
                <div className="platform-title">
                  <h3>For your iPhone <IphoneBadge /></h3>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-phone"></use>
                  </svg>
                </div>
                <p>
                  Share links, photos and files to Foundkeep from the iPhone
                  Share menu.
                </p>
                <IphoneLink className="text-link" />
              </div>
            </article>
            <article className="platform-card">
              <div className="platform-art sky web-art" aria-hidden="true">
                <div className="web-window">
                  <div className="web-window-header">
                    <img src="/assets/studio-mark.svg?v=bookmark-evolved-1" width="22" height="22" alt="" aria-hidden="true" /><strong>All your finds.</strong><span><svg aria-hidden="true" viewBox="0 0 24 24">
                        <use href="#i-search"></use></svg></span>
                  </div>
                  <div className="web-mini-grid">
                    <div className="web-mini-photo"></div>
                    <div className="web-mini-note">
                      Little ideas.<br />Big possibilities.
                    </div>
                    <div className="web-mini-highlight">
                      <span>Keep what<br />moves you.</span>
                    </div>
                  </div>
                  <div className="web-window-footer">
                    Your collection, a little closer.
                  </div>
                </div>
                <div className="sticker sticker-web">One place to come back to</div>
              </div>
              <div className="platform-copy">
                <div className="platform-title">
                  <h3>For the bigger picture</h3>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-globe"></use>
                  </svg>
                </div>
                <p>
                  Open your web dashboard to search, revisit and manage your
                  synced saves.
                </p>
                <a className="text-link" href="/dashboard">Open your dashboard
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-arrow"></use></svg></a>
              </div>
            </article>
            <article className="platform-card">
              <div className="platform-art mint organize-art" aria-hidden="true">
                <div className="folder-illustration">
                  <div className="folder-back"></div>
                  <div className="folder-paper paper-one">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <use href="#i-image"></use>
                    </svg>
                  </div>
                  <div className="folder-paper paper-two">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <use href="#i-note"></use>
                    </svg>
                  </div>
                  <div className="folder-paper paper-three">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <use href="#i-link"></use>
                    </svg>
                  </div>
                  <div className="folder-front">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <use href="#i-folder"></use>
                    </svg>
                    <span>Good things</span>
                  </div>
                </div>
                <div className="floating-tag tag-one"># inspiration</div>
                <div className="floating-tag tag-two"># weekend plans</div>
              </div>
              <div className="platform-copy">
                <div className="platform-title">
                  <h3>For your kind of organized</h3>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-folder"></use>
                  </svg>
                </div>
                <p>
                  A reading list, a project, a someday folder. Give each find a
                  place that makes sense to you.
                </p>
                <a className="text-link" href="/signup">Create your collection
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-arrow"></use></svg></a>
              </div>
            </article>
          </PlatformGrid>
          <p className="browser-compatibility">
            The extension works with Chrome, Edge, Brave, Opera and Vivaldi.
            <IphoneAvailability />
          </p>
        </section></Reveal>

        <Reveal><section className="section wrap getting-started" id="how" aria-labelledby="how-heading">
          <div className="section-heading">
            <h2 id="how-heading">A little setup.<br />A lot less scattered.</h2>
            <p>
              Start with your browser. Connect an account when<br className="desktop-break" />
              you want your collection to come with you.
            </p>
          </div>
          <div className="start-grid" id="get">
            <article className="start-card local-start">
              <div className="start-card-heading">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <use href="#i-chrome"></use></svg><span>Keep it in your browser</span>
              </div>
              <h3>Find. Click. Keep.</h3>
              <p>Start saving locally, without an account.</p>
              <ul>
                <li>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-check"></use>
                  </svg>
                  Readable pages, highlights and screenshots
                </li>
                <li>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-check"></use>
                  </svg>
                  Images, links and quick notes
                </li>
                <li>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-check"></use>
                  </svg>
                  Search your local collection
                </li>
                <li>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-check"></use>
                  </svg>
                  Automatic Chrome Store updates
                </li>
              </ul>
              <ExtensionLink className="button" /><ExtensionNote /><a className="manual-link" data-manual-install="" href="/foundkeep-extension.zip?build=1.6.2" download="foundkeep-extension.zip">Or download the manual browser ZIP
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <use href="#i-download"></use></svg></a>
            </article>
            <article className="start-card cloud-start">
              <div className="start-card-heading">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <use href="#i-sync"></use></svg><span>Bring your collection together</span>
              </div>
              <h3>Your finds, with you.</h3>
              <p>Connect an account for your private cloud library.</p>
              <ul>
                <li>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-check"></use>
                  </svg>
                  Sync new saves from your iPhone and browsers
                </li>
                <li>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-check"></use>
                  </svg>
                  Access your collection on the web
                </li>
                <li>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-check"></use>
                  </svg>
                  Save from the iPhone Share menu
                </li>
                <li>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-check"></use>
                  </svg>
                  Control features in capture settings
                </li>
              </ul>
              <a className="button" href="/signup">Create your account
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <use href="#i-arrow"></use></svg></a>
              <p className="setup-note">
                Sign in to the iPhone app with the same account, or choose
                <strong>Apps &amp; devices</strong> in your dashboard to connect a browser.
                Existing local saves are imported only when you choose.
              </p>
            </article>
          </div>
        </section></Reveal>

        <Reveal><section className="section wrap faq-section" aria-labelledby="faq-heading">
          <div>
            <h2 id="faq-heading">A few things<br />you might wonder.</h2>
            <p>Good questions deserve clear answers.</p>
            <Link className="text-link" href="/support">Visit Foundkeep Support
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <use href="#i-arrow"></use></svg></Link>
          </div>
          <div className="faq-list">
            <details>
              <summary>
                What can I save?
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <use href="#i-plus"></use>
                </svg>
              </summary>
              <p>
                Save readable pages, links, highlights, screenshots, images and
                notes from your browser. On iPhone beta, share text, photos,
                video, audio, documents and other files into the same cloud
                collection.
              </p>
            </details>
            <details>
              <summary>
                Will I be able to find the original?
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <use href="#i-plus"></use>
                </svg>
              </summary>
              <p>
                Yes. Foundkeep retains the original source and available page
                details, including the visited and canonical URLs, title,
                author, publisher and dates. Save page also keeps a readable
                copy of useful article text. You can control what is collected
                in your dashboard’s capture settings.
              </p>
            </details>
            <details>
              <summary>
                Do I need an account?
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <use href="#i-plus"></use>
                </svg>
              </summary>
              <p>
                You can use the browser extension locally without an account.
                Create an account to sync new captures with your web dashboard
                and iPhone. Existing local captures stay local until you
                explicitly import them.
              </p>
            </details>
            <details>
              <summary>
                Where does my collection live?
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <use href="#i-plus"></use>
                </svg>
              </summary>
              <p>
                Local browser saves live in that browser installation. Connected
                accounts also store synced captures on Foundkeep’s backend.
                Cloud and local copies are separate: deleting one does not
                automatically delete the other.
                <Link href="/privacy">Read our privacy policy.</Link>
              </p>
            </details>
            <details>
              <summary>
                Can I use Foundkeep on my iPhone?
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <use href="#i-plus"></use>
                </svg>
              </summary>
              <p>
                <IphoneAvailability /> Sign in once, then choose
                Foundkeep from the Share menu in Safari, Photos, Files and other
                apps.
                <Link href="/support">Contact support about beta access.</Link>
              </p>
            </details>
            <details>
              <summary>
                How do I recover or delete my account?
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <use href="#i-plus"></use>
                </svg>
              </summary>
              <p>
                Save the recovery code shown when you create your password
                account. Use it with your email to reset your password;
                Foundkeep does not send password-reset emails. Your account
                settings let you export cloud captures, revoke devices and
                permanently delete your account.
              </p>
            </details>
            <details>
              <summary>
                Already using a manual extension build?
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <use href="#i-plus"></use>
                </svg>
              </summary>
              <p>
                Sync your local-only captures before switching installations.
                Then install the
                <a href="https://chromewebstore.google.com/detail/cficnecbdbiddngllpfbacabgbcjinmk" target="_blank" rel="noopener noreferrer">Chrome Web Store version</a>
                for automatic updates. Unsynced captures belong to the
                installation that created them.
              </p>
            </details>
          </div>
        </section></Reveal>

        <section className="closing-banner wrap" aria-labelledby="closing-heading">
          <picture className="scenery"><source type="image/webp" srcSet="\n                /assets/foundkeep-coastal-800.webp   800w,\n                /assets/foundkeep-coastal-1600.webp 1600w\n              " sizes="100vw" />
            <img src="/assets/foundkeep-coastal-1600.webp" alt="" aria-hidden="true" width="1600" height="1000" decoding="async" loading="lazy" /></picture>
          <div>
            <h2 id="closing-heading">Keep a little wonder.</h2>
            <p>
              Your next good find is out there.<br />Give it a place to call
              home.
            </p>
            <a className="button button-white" href="/signup">Start collecting
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <use href="#i-arrow"></use></svg></a>
          </div>
        </section>
      </main>
      <footer className="site-footer wrap">
        <picture className="scenery"><source type="image/webp" srcSet="\n              /assets/foundkeep-alpine-800.webp   800w,\n              /assets/foundkeep-alpine-1600.webp 1600w\n            " sizes="100vw" />
          <img src="/assets/foundkeep-alpine-1600.webp" alt="" aria-hidden="true" width="1600" height="1000" decoding="async" loading="lazy" /></picture>
        <div className="footer-main">
          <div>
            <a className="brand" href="#top"><img src="/assets/studio-mark.svg?v=bookmark-evolved-1" width="32" height="32" alt="" aria-hidden="true" /><span>Foundkeep</span></a>
            <p>A place for the things worth keeping.</p>
          </div>
          <nav aria-label="Product">
            <span>Make yourself at home</span><a href="#capture">How it works</a><a href="#library">Your collection</a><a href="#everywhere">Get Foundkeep</a>
          </nav>
          <nav aria-label="Help and information">
            <span>A few useful links</span><IphoneLink className="" /><Link href="/support">Support</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link>
          </nav>
          <nav aria-label="Account">
            <span>Your little corner</span><a href="/signup">Create account</a><a href="/login">Log in</a><a href="https://github.com/notpritam/foundkeep" target="_blank" rel="noopener noreferrer">Open source
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <use href="#i-external"></use></svg></a>
          </nav>
        </div>
        <div className="footer-bottom">
          <span>© 2026 NotPritam</span><span>Made for curious minds.</span><a href="#top">Back to the top ↑</a>
        </div>
      </footer>
    </div>
  </div></LandingProvider>;}
