// Demo curation uses original annotations and links to the original publishers.
export const demoCollections = [
 {
  slug:'demo-agent-toolkit',title:'The agent toolkit',tags:['agents','skills','tools'],visibility:'public',submissionPolicy:'anyone',requireApproval:true,
  description:'Good starting points for agents that do useful work. Protocols, reusable skills, and ideas worth trying. A FoundKeep demo collection you can follow and contribute to.',
  rules:'Link to the original source. Explain what someone can build or learn from it. Suggestions are reviewed before they appear; keep vendor pitches and duplicate links out.',
  entries:[
   {key:'effective-agents',title:'Start simple: building effective agents',url:'https://www.anthropic.com/engineering/building-effective-agents',body:'A useful introduction to the difference between fixed workflows and agents that choose their next step. Start here before deciding how much orchestration your project needs.',tags:['agents','architecture']},
   {key:'mcp-intro',title:'MCP: a common language for tools and context',url:'https://modelcontextprotocol.io/docs/getting-started/intro',body:'The protocol’s own introduction to connecting AI applications with tools and information. A good reference to keep beside your first integration.',tags:['agents','tools','mcp']},
   {key:'agent-skills',title:'Give an agent a skill it can reuse',url:'https://agentskills.io/home',body:'The Agent Skills overview explains the open format for packaging instructions and supporting resources. Useful when the same task keeps coming back.',tags:['skills','tools']},
   {key:'small-contract',title:'A small contract makes a better tool',body:'Before adding a tool to an agent, write down three things: what the tool changes, what success looks like, and what it returns when something goes wrong. If those answers are hard to explain, make the tool smaller.\n\nAn original demo note from the FoundKeep curator.',tags:['tools','reliability']},
   {key:'keep-provenance',title:'Keep the source attached to the answer',body:'Save the source link alongside the useful excerpt and your own explanation. The next person should be able to separate what the source said from what the curator thinks about it.\n\nAn original demo note about sharing useful agent research.',tags:['agents','research']},
   {key:'skill-checklist',title:'What makes a skill worth keeping?',body:'A clear trigger. A concrete result. One worked example. A short list of things to check before calling the task done. That is a good first version; improve it with what actually happens when you use it.\n\nAn original demo note you can use as a starting checklist.',tags:['skills','practice']},
  ],
 },
 {
  slug:'demo-design-that-works',title:'Design that works',tags:['design','product','accessibility'],visibility:'public',submissionPolicy:'owner',requireApproval:true,
  description:'Interfaces that explain themselves. Practical references for clearer navigation, thoughtful interactions, and an accessible web. Curated demo finds for your next product.',
  rules:'This collection is curated by its owner. Every link points to its original publisher. Start with one principle, try it in a real interface, and keep a note about what changed.',
  entries:[
   {key:'heuristics',title:'Ten questions to ask of any interface',url:'https://www.nngroup.com/articles/ten-usability-heuristics/',body:'Nielsen Norman Group’s usability heuristics make a practical review companion. Keep them open when you are checking navigation, feedback, error recovery, and whether a screen says too much.',tags:['design','usability']},
   {key:'wai-tutorials',title:'Build accessibility into the details',url:'https://www.w3.org/WAI/tutorials/',body:'W3C’s task-based tutorials cover familiar interface elements such as images, forms, tables, and menus. Useful when you want to move from a principle to an implementation.',tags:['accessibility','design']},
   {key:'thinking-react',title:'Think in components, then in states',url:'https://react.dev/learn/thinking-in-react',body:'React’s worked example follows an interface from its visual structure to the state it needs. A helpful shared reference for designers and developers discussing how a screen behaves.',tags:['product','react','design']},
   {key:'mdn-accessibility',title:'A working reference for the accessible web',url:'https://developer.mozilla.org/en-US/docs/Web/Accessibility',body:'MDN collects accessibility concepts and implementation guidance in one place. Keep the reference close while making keyboard, semantic HTML, and assistive-technology decisions.',tags:['accessibility','web']},
   {key:'one-clear-action',title:'Give each screen one clear next step',body:'Ask someone to look at your screen for five seconds, then tell you what they would do next. If the answer is unclear, improve the hierarchy before adding more explanation.\n\nAn original demo note from a product review checklist.',tags:['product','hierarchy']},
   {key:'empty-state',title:'An empty state can still be a useful place',body:'Explain what belongs here, show how to add the first item, and make that first action easy to find. A new collection does not need invented activity to feel welcoming.\n\nAn original demo note about first-use experiences.',tags:['design','onboarding']},
  ],
 },
 {
  slug:'demo-worth-reading',title:'Worth a slower read',tags:['reading','ideas','writing'],visibility:'public',submissionPolicy:'anyone',requireApproval:false,
  description:'Essays and small ideas to return to when there is room to think. Bring a good link, add a little context, and make this demo reading list your own.',
  rules:'Anyone signed in can add a find, and contributions appear immediately. Share the original link with your own short annotation. Be thoughtful, stay on topic, and respect the author’s work.',
  entries:[
   {key:'great-work',title:'On finding work that keeps your attention',url:'https://paulgraham.com/greatwork.html',body:'Paul Graham’s long essay about doing ambitious work rewards a slower read. A place to pause and consider which questions you want to keep working on.',tags:['reading','work','ideas']},
   {key:'learnable',title:'What would a more learnable programming environment look like?',url:'https://worrydream.com/LearnableProgramming/',body:'Bret Victor explores how a programming environment can help people understand what their code is doing. The interactive examples make this a reference worth revisiting.',tags:['reading','programming','design']},
   {key:'evergreen',title:'Notes that grow with your understanding',url:'https://notes.andymatuschak.org/Evergreen_notes',body:'Andy Matuschak describes notes as things to develop and connect over time. An inviting starting point for thinking about the relationship between reading, writing, and a personal knowledge library.',tags:['reading','notes','writing']},
   {key:'one-sentence',title:'Leave your future self one useful sentence',body:'When you save an essay, add a sentence about why you kept it. A month from now, that small piece of context can matter more than a perfect folder name.\n\nAn original demo note for thoughtful collecting.',tags:['notes','practice']},
   {key:'two-notes',title:'The interesting part might be between two notes',body:'Look for a connection between something you saved today and something you saved last month. Write down the connection in your own words. That new thought deserves a place in the collection too.\n\nAn original demo note about building a personal library.',tags:['ideas','notes']},
   {key:'reread',title:'A reading list can be a returning list',body:'Keep a few references you actually return to alongside the things you want to read next. A collection can hold a conversation with your past attention, not just another queue.\n\nAn original demo note about making room to revisit.',tags:['reading','habits']},
  ],
 },
 {
  slug:'demo-private-scratchpad',title:'Private demo scratchpad',tags:['private','notes'],visibility:'private',submissionPolicy:'owner',requireApproval:true,
  description:'Only the demo curator can open this collection. Use it to check private collection behavior without touching another account.',rules:'Private demo data. Keep personal or customer information out of these fixtures.',
  entries:[{key:'private-note',title:'Private rehearsal note',body:'This example should never appear in public search, the Explore directory, or a public collection feed.',tags:['private']}],
 },
];
