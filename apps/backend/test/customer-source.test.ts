import {expect,test} from 'bun:test';
import {createSourceFetcher,extractSource} from '../src/customer-source.ts';
const html='<html><head><title>A useful page</title><meta property="og:image" content="/image.jpg"><meta name="author" content="Alex"></head><body><nav>Do not include navigation</nav><article><h1>A useful page</h1><p>The original article has useful details.</p><script>throw new Error("Never execute");</script></article></body></html>';
test('public extraction preserves traceable article details and removes executable/navigation content',()=>{
 const result=extractSource(html,'https://example.com/article');expect(result.text).toContain('original article');expect(result.text).not.toContain('Never execute');expect(result.text).not.toContain('navigation');expect(result.imageUrl).toBe('https://example.com/image.jpg');expect(result.author).toBe('Alex');
});
test('source fetching pins public addresses and records original URL, final URL and a content hash',async()=>{
 let calls=0;const fetcher=createSourceFetcher({resolve:async()=>[{address:'1.1.1.1',family:4}],transport:async target=>{
  expect(target.address).toBe('1.1.1.1');calls++;return{status:calls===1?302:200,headers:new Headers(calls===1?{location:'/article'}:{'content-type':'text/html'}),body:(async function*(){yield new TextEncoder().encode(html);})(),cancel(){}};
 }});const result=await fetcher('https://example.com/first');expect(result.requestedUrl).toBe('https://example.com/first');expect(result.url).toBe('https://example.com/article');expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
});
test('private DNS answers and redirects to local addresses never reach the transport',async()=>{
 let calls=0;const fetcher=createSourceFetcher({resolve:async()=>[{address:'127.0.0.1',family:4}],transport:async()=>{calls++;throw new Error('Must not connect.');}});
 await expect(fetcher('https://example.com')).rejects.toThrow('not a public');expect(calls).toBe(0);
 const redirect=createSourceFetcher({resolve:async()=>[{address:'1.1.1.1',family:4}],transport:async()=>({status:302,headers:new Headers({location:'http://169.254.169.254/latest/meta-data/'}),body:(async function*(){})(),cancel(){}})});
 await expect(redirect('https://example.com')).rejects.toThrow('unsupported address');
});

test('social metadata is useful context without pretending to be a full post or transcript',()=>{
 const result=extractSource('<html><head><meta property="og:title" content="A lesson on agents"><meta property="og:description" content="Three ways to organize an agent library"><meta property="og:image" content="https://i.ytimg.com/vi/abc/hqdefault.jpg"></head><body><main><p>Sign in to confirm you are not a bot</p></main></body></html>','https://www.youtube.com/watch?v=abc');
 expect(result).toMatchObject({platform:'youtube',contentKind:'video',extractionStatus:'metadata-only',transcriptStatus:'unavailable'});expect(result.text).toContain('Three ways');expect(result.text).not.toContain('Sign in');expect(result.notice).toContain('transcript');
 const post=extractSource('<meta name="twitter:title" content="Alex on X"><meta name="twitter:description" content="A useful tweet about reading habits">','https://x.com/alex/status/123');expect(post).toMatchObject({platform:'x',contentKind:'post',extractionStatus:'metadata-only'});expect(post.text).toContain('reading habits');
 const instagram=extractSource('<meta property="og:description" content="A reel about capturing ideas">','https://www.instagram.com/reel/123/');expect(instagram).toMatchObject({platform:'instagram',contentKind:'video',transcriptStatus:'unavailable'});
});
test('JSON-LD article and social bodies are extracted as data, bounded and never executed',()=>{
 const body='This article explains how to keep references connected and useful.';
 const article=extractSource('<html><head><script type="application/ld+json">'+JSON.stringify({'@graph':[{'@type':'Organization',name:'Noise'},{'@type':'Article',headline:'Connected references',articleBody:body,author:{name:'Mira'},datePublished:'2026-09-01'}]})+'</script></head><body><main>Enable JavaScript</main></body></html>','https://example.com/articles/connected');
 expect(article).toMatchObject({title:'Connected references',text:body,author:'Mira',extractionStatus:'readable',contentKind:'article'});
 const video=extractSource('<script type="application/ld+json">'+JSON.stringify({'@type':'VideoObject',name:'Saved videos',description:'A short guide',transcript:'First save an idea. Then connect it to another reference.'})+'</script>','https://www.youtube.com/watch?v=abc');expect(video).toMatchObject({extractionStatus:'readable',transcriptStatus:'available'});expect(video.text).toContain('Then connect');
});
test('gated shells are unavailable and similar-looking hosts are not trusted platforms',()=>{
 expect(extractSource('<html><body><main><h1>Log in to continue</h1><p>Please enable JavaScript</p></main></body></html>','https://instagram.com/p/1')).toMatchObject({text:'',extractionStatus:'unavailable'});
 expect(extractSource('<article><p>An independent article.</p></article>','https://youtube.com.example.org/article').platform).toBe('web');
});

test.each(['https://www.facebook.com/unsupportedbrowser','https://www.instagram.com/accounts/login/','https://www.facebook.com/checkpoint/123','https://x.com/i/flow/login'])('blocked redirect %s is unavailable even when its text is not English',async destination=>{
 const requested='https://www.instagram.com/instagram/';let calls=0;
 const fetcher=createSourceFetcher({resolve:async()=>[{address:'1.1.1.1',family:4}],transport:async()=>{
  calls++;return {status:calls===1?302:200,headers:new Headers(calls===1?{location:destination}:{'content-type':'text/html'}),body:(async function*(){yield new TextEncoder().encode('<html><head><title>Обновите свой браузер</title><meta name="description" content="Обновите свой браузер для продолжения"></head><body><h1>Обновите свой браузер</h1><p>Необходимо обновить браузер.</p></body></html>');})(),cancel(){}};
 }});
 const result=await fetcher(requested);expect(result).toMatchObject({requestedUrl:requested,url:destination,platform:'instagram',extractionStatus:'unavailable',text:'',title:null,description:null});expect(result.notice).toBeTruthy();
});
test('legitimate cross-domain article redirects retain readable evidence',async()=>{
 let calls=0;const fetcher=createSourceFetcher({resolve:async()=>[{address:'1.1.1.1',family:4}],transport:async()=>{
  calls++;return {status:calls===1?302:200,headers:new Headers(calls===1?{location:'https://publisher.example/articles/login-security'}:{'content-type':'text/html'}),body:(async function*(){yield new TextEncoder().encode(html);})(),cancel(){}};
 }});expect(await fetcher('https://links.example/story')).toMatchObject({requestedUrl:'https://links.example/story',url:'https://publisher.example/articles/login-security',platform:'web',extractionStatus:'readable',text:expect.stringContaining('original article')});
});
test('blocked-route detection cannot bypass public-address validation on redirected hosts',async()=>{
 let calls=0;const fetcher=createSourceFetcher({resolve:async host=>[{address:host==='www.facebook.com'?'127.0.0.1':'1.1.1.1',family:4}],transport:async()=>{
  calls++;return {status:302,headers:new Headers({location:'https://www.facebook.com/unsupportedbrowser'}),body:(async function*(){})(),cancel(){}};
 }});await expect(fetcher('https://www.instagram.com/instagram/')).rejects.toThrow('not a public');expect(calls).toBe(1);
});
test('a web heading that only repeats the title is preview metadata, not article evidence',()=>{
 expect(extractSource('<html><head><title>Saved article</title></head><body><h1>Saved article</h1></body></html>','https://example.com/article')).toMatchObject({title:'Saved article',text:'',extractionStatus:'metadata-only'});
});

test('observed Finnish YouTube platform metadata is unavailable item evidence',async()=>{
 const html=await Bun.file(new URL('./fixtures/youtube-generic-fi.html',import.meta.url)).text();
 expect(extractSource(html,'https://www.youtube.com/watch?v=YE7VzlLtp-4')).toMatchObject({platform:'youtube',contentKind:'video',title:null,description:null,text:'',extractionStatus:'unavailable',transcriptStatus:'unavailable'});
});
test.each([
 ['https://youtube.com/watch?v=abc','— YouTube','Découvrez des vidéos et partagez vos contenus.'],
 ['https://youtube.com/watch?v=abc','YouTube','वीडियो देखें और साझा करें।'],
 ['https://instagram.com/reel/abc/','Instagram','Descubre fotos y vídeos de todo el mundo.'],
 ['https://x.com/alex/status/123','X / X','世界中で起きていることを見つけましょう。'],
])('generic platform title identifies %s shells independently of description language', (url,title,description)=>{
 expect(extractSource(`<title>${title}</title><meta name="description" content="${description}">`,url)).toMatchObject({title:null,description:null,text:'',extractionStatus:'unavailable'});
});
test('a real item title preserves item-specific metadata even without image, author or date',()=>{
 const result=extractSource('<title>How we filmed the falling leaves - YouTube</title><meta name="description" content="We used a slow shutter to capture autumn leaves.">','https://youtube.com/watch?v=abc');
 expect(result).toMatchObject({title:'How we filmed the falling leaves - YouTube',description:'We used a slow shutter to capture autumn leaves.',text:'We used a slow shutter to capture autumn leaves.',extractionStatus:'metadata-only'});
});
test('structured item metadata replaces generic platform head metadata rather than discarding actual evidence',()=>{
 const item={'@type':'VideoObject',name:'Falling leaves',description:'An autumn scene filmed in the park.',transcript:'The leaves drift down from the tree.'};
 const result=extractSource('<title>- YouTube</title><meta name="description" content="Generic platform marketing"><script type="application/ld+json">'+JSON.stringify(item)+'</script>','https://youtube.com/watch?v=abc');
 expect(result).toMatchObject({title:'Falling leaves',description:item.description,text:item.transcript,extractionStatus:'readable',transcriptStatus:'available'});
 const preview=extractSource('<title>- YouTube</title><meta name="description" content="Generic platform marketing"><script type="application/ld+json">'+JSON.stringify({...item,transcript:undefined})+'</script>','https://youtube.com/watch?v=abc');
 expect(preview).toMatchObject({title:'Falling leaves',text:item.description,extractionStatus:'metadata-only'});
});

test('a real Instagram OG caption and item preview survive a platform-only title',()=>{
 const caption='A real caption about hiking at sunrise.';
 const result=extractSource('<title>Instagram</title><meta property="og:type" content="video.other"><meta property="og:image" content="https://cdn.example.com/reels/hiking-sunrise.jpg"><meta property="og:description" content="'+caption+'">','https://www.instagram.com/reel/sunrise/');
 expect(result).toMatchObject({title:null,description:caption,text:caption,imageUrl:'https://cdn.example.com/reels/hiking-sunrise.jpg',contentKind:'video',extractionStatus:'metadata-only',transcriptStatus:'unavailable'});
});
test.each([
 ['https://instagram.com/p/sunrise/','Instagram','og:description','og:image','article'],
 ['https://x.com/alex/status/123','X','twitter:description','twitter:image','article'],
 ['https://youtube.com/watch?v=sunrise','- YouTube','og:description','og:image','video.other'],
])('explicit item type identifies caption and image evidence on %s without an item-specific title', (url,title,description,image,itemType)=>{
 const result=extractSource(`<title>${title}</title><meta property="og:type" content="${itemType}"><meta property="${description}" content="An actual caption describing a sunrise hike."><meta property="${image}" content="https://cdn.example.com/sunrise.jpg">`,url);
 expect(result).toMatchObject({description:'An actual caption describing a sunrise hike.',text:'An actual caption describing a sunrise hike.',extractionStatus:'metadata-only'});
});
test('an invalid preview or generic ordinary description does not upgrade a platform shell',async()=>{
 expect(extractSource('<title>Instagram</title><meta property="og:description" content="Generic platform marketing"><meta property="og:image" content="javascript:invalid">','https://instagram.com/reel/abc/')).toMatchObject({text:'',description:null,extractionStatus:'unavailable'});
 const observed=await Bun.file(new URL('./fixtures/youtube-generic-fi.html',import.meta.url)).text();
 expect(extractSource(observed.replace('</head>','<meta property="og:image" content="https://cdn.example.com/logo.jpg"></head>'),'https://youtube.com/watch?v=abc')).toMatchObject({text:'',description:null,extractionStatus:'unavailable'});
});
test.each(['','<meta property="og:type" content="website">'])('a generic OG caption and logo without item context are discarded, including preview evidence (%s)',type=>{
 const result=extractSource('<title>Instagram</title>'+type+'<meta property="og:image" content="https://cdn.example.com/instagram-logo.jpg"><meta property="og:description" content="Discover photos and videos from people around the world.">','https://instagram.com/reel/abc/');
 expect(result).toMatchObject({title:null,description:null,text:'',imageUrl:null,extractionStatus:'unavailable',transcriptStatus:'unavailable'});
});
test('rejected generic head previews are dropped even when they have no caption to analyze',()=>{
 expect(extractSource('<title>- YouTube</title><meta property="og:image" content="https://cdn.example.com/youtube-logo.jpg">','https://youtube.com/watch?v=abc')).toMatchObject({text:'',imageUrl:null,extractionStatus:'unavailable'});
});
test.each(['<meta property="og:type" content="video.other">','<meta property="article:published_time" content="2026-09-01">','<script type="application/ld+json">{"@type":"VideoObject","name":"A sunrise hike"}</script>'])('explicit item context retains the real caption and preview (%s)',context=>{
 const result=extractSource('<title>Instagram</title>'+context+'<meta property="og:image" content="https://cdn.example.com/reels/hiking.jpg"><meta property="og:description" content="A real caption about hiking at sunrise.">','https://instagram.com/reel/abc/');
 expect(result).toMatchObject({description:'A real caption about hiking at sunrise.',text:'A real caption about hiking at sunrise.',imageUrl:'https://cdn.example.com/reels/hiking.jpg',extractionStatus:'metadata-only'});
});
test('structured item preview takes priority over a generic platform head logo',()=>{
 const item={'@type':'VideoObject',name:'Sunrise hike',description:'A walk along the ridge.',image:'https://cdn.example.com/reels/ridge.jpg'};
 const result=extractSource('<title>Instagram</title><meta property="og:image" content="https://cdn.example.com/instagram-logo.jpg"><script type="application/ld+json">'+JSON.stringify(item)+'</script>','https://instagram.com/reel/ridge/');
 expect(result).toMatchObject({title:'Sunrise hike',description:item.description,imageUrl:item.image,extractionStatus:'metadata-only'});
});

test('a truncated blog teaser cannot be reported as a preserved readable article',()=>{
 const result=extractSource('<title>A public blog</title><meta name="description" content="Every December, we have a chance to see..."><main><div>ALT Meteor photo A public blogEvery December, we have a chance to see...</div></main>','https://nasa.tumblr.com/post/123/blog');
 expect(result.extractionStatus).toBe('metadata-only');expect(result.notice).toContain('full post or article');
});
