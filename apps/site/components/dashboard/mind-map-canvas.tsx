'use client';
import {useEffect,useRef,useState} from 'react';
import type {Core,StylesheetJson} from 'cytoscape';
import type {MindMapData} from '../../lib/mind-map';
import {useTheme} from '../appearance/theme';
function graphStyles(dark:boolean):StylesheetJson{return [
 {selector:'node',style:{label:'','font-family':'Inter, sans-serif','font-size':11,color:dark?'#f7f8f8':'#424242','text-wrap':'wrap','text-max-width':'150px','text-valign':'bottom','text-margin-y':7,'text-background-color':dark?'#0f1011':'#fafafa','text-background-opacity':.88,'text-background-padding':'3px','background-color':dark?'#b0b0b0':'#777777','border-width':0,width:'data(size)',height:'data(size)'}},
 {selector:'node[type="note"],node[type="selection"]',style:{'background-color':dark?'#70aff0':'#237cb4'}},
 {selector:'node[kind="tag"]',style:{'background-color':dark?'#77cbbb':'#368d78'}},
 {selector:'edge',style:{width:.7,'curve-style':'haystack','line-color':dark?'#798896':'#9aafbb',opacity:dark?.28:.4}},
 {selector:'edge[kind="tag"]',style:{width:.6,'line-color':dark?'#91a2ad':'#839da6',opacity:.25}},
 {selector:'edge[kind="agent"]',style:{width:.9,'line-color':dark?'#9b99df':'#7475b9',opacity:.48}},
 {selector:'edge[kind="hosted"]',style:{width:.8,'line-color':dark?'#70aff0':'#237cb4','line-style':'dashed',opacity:.4}},
 {selector:'node.reveal-label',style:{label:'data(displayLabel)'}},
 {selector:'.dimmed',style:{opacity:.08}},
 {selector:'node.selected,node.hovered',style:{label:'data(displayLabel)','background-color':dark?'#d0e8fc':'#145e8c','border-width':3,'border-opacity':.3,'border-color':dark?'#79bff0':'#237cb4','font-weight':600}},
 {selector:'edge.connected',style:{width:1.3,opacity:.85}},
];}
export default function MindMapCanvas({data,showTags,selected,onSelect}:{data:MindMapData;showTags:boolean;selected:string|null;onSelect:(id:string|null)=>void}) {
 const {resolved}=useTheme(),container=useRef<HTMLDivElement>(null),core=useRef<Core|null>(null),select=useRef(onSelect),lastTopology=useRef('');select.current=onSelect;
 const [ready,setReady]=useState(false),[applied,setApplied]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let disposed=false;let resize:ResizeObserver|undefined;let instance:Core|undefined;
  void import('cytoscape').then(({default:cytoscape})=>{
   if(disposed||!container.current)return;
   instance=cytoscape({container:container.current,elements:[],style:graphStyles(false),minZoom:.12,maxZoom:8,wheelSensitivity:.2,selectionType:'single',boxSelectionEnabled:false,layout:{name:'preset'}});
   core.current=instance;
   instance.on('tap','node',event=>select.current(event.target.id()));
   instance.on('tap',event=>{if(event.target===instance)select.current(null);});
   instance.on('mouseover','node',event=>{event.target.addClass('hovered');if(container.current)container.current.style.cursor='pointer';});
   instance.on('mouseout','node',event=>{event.target.removeClass('hovered');if(container.current)container.current.style.cursor='grab';});
   instance.on('zoom',()=>instance?.nodes().toggleClass('reveal-label',instance.zoom()>=1.8));
   let previousSize='';resize=new ResizeObserver(entries=>{const box=entries[0]?.contentRect;if(!instance||!box)return;const size=Math.round(box.width)+':'+Math.round(box.height);if(size===previousSize)return;previousSize=size;instance.resize();if(instance.nodes().length){instance.fit(undefined,Math.min(80,box.width/6));if(instance.zoom()>1.4)instance.zoom(1.4);instance.center();}});resize.observe(container.current);setReady(true);
  }).catch(()=>{if(!disposed)setError('The map could not load. Use List view to explore your connections.');});
  return()=>{disposed=true;resize?.disconnect();instance?.destroy();if(core.current===instance)core.current=null;};
 },[]);
 useEffect(()=>{core.current?.style(graphStyles(resolved==='dark'));},[resolved,ready]);
 useEffect(()=>{
  const cy=core.current;if(!cy||!ready)return;
  const nodes=data.nodes.filter(node=>showTags||node.kind==='save'),edges=data.edges.filter(edge=>showTags||edge.kind!=='tag');
  const degree=new Map<string,number>();for(const e of edges){degree.set(e.source,(degree.get(e.source)||0)+1);degree.set(e.target,(degree.get(e.target)||0)+1);}
  const topology=JSON.stringify([nodes.map(n=>n.id),edges.map(e=>e.id)]),changed=lastTopology.current!==topology;
  const wanted=new Set([...nodes.map(n=>n.id),...edges.map(e=>e.id)]);
  cy.batch(()=>{
   cy.elements().filter(e=>!wanted.has(e.id())).remove();
   nodes.forEach((node,index)=>{const datum={...node,displayLabel:node.label.length>72?node.label.slice(0,69)+'…':node.label,size:Math.min(18,(node.kind==='tag'?5:3.5)+Math.sqrt(degree.get(node.id)||0)*2)};const existing=cy.getElementById(node.id);if(existing.length)existing.data(datum);else{const a=index*2.399963,r=32*Math.sqrt(index+1);cy.add({group:'nodes',data:datum,position:{x:Math.cos(a)*r,y:Math.sin(a)*r}});}});
   edges.forEach(edge=>{const existing=cy.getElementById(edge.id);if(existing.length)existing.data(edge);else cy.add({group:'edges',data:edge});});
  });
  if(changed){cy.layout({name:'cose',animate:false,randomize:false,nodeDimensionsIncludeLabels:false,nodeRepulsion:()=>9000,idealEdgeLength:()=>65,edgeElasticity:()=>70,nodeOverlap:8,gravity:.45,numIter:500,componentSpacing:80,padding:80}).run();if(cy.zoom()>1.4)cy.zoom(1.4);cy.center();lastTopology.current=topology;}
  setApplied(true);
 },[data,showTags,ready]);
 useEffect(()=>{const cy=core.current;if(!cy)return;cy.elements().removeClass('dimmed selected connected');if(selected){const node=cy.getElementById(selected);if(node.length){cy.elements().difference(node.closedNeighborhood()).addClass('dimmed');node.addClass('selected');node.connectedEdges().addClass('connected');node.neighborhood('node').addClass('reveal-label');}}else cy.nodes().toggleClass('reveal-label',cy.zoom()>=1.8);},[selected,data,showTags,ready]);
 const zoom=(factor:number)=>{const cy=core.current;if(cy)cy.zoom({level:Math.min(8,Math.max(.12,cy.zoom()*factor)),renderedPosition:{x:cy.width()/2,y:cy.height()/2}});};
 return <div className="mind-map-stage"><div className="mind-map-canvas" ref={container} data-ready={ready&&applied} role="img" aria-label="Interactive canvas of saved items and tags. Drag nodes, pan and zoom. Select a connection, or use List view for keyboard access."/>{!applied&&!error?<p className="mind-map-stage-status" role="status">Arranging your connections…</p>:null}{error?<p className="mind-map-stage-status" role="alert">{error}</p>:null}<div className="mind-map-zoom" role="group" aria-label="Map zoom"><button type="button" aria-label="Zoom in" disabled={!applied} onClick={()=>zoom(1.4)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button><button type="button" aria-label="Zoom out" disabled={!applied} onClick={()=>zoom(1/1.4)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button><button type="button" disabled={!applied} onClick={()=>{core.current?.fit(undefined,80);if((core.current?.zoom()||0)>1.4)core.current?.zoom(1.4);core.current?.center();}}>Fit map</button></div><p className="mind-map-gesture-hint">Drag nodes or the canvas · Scroll to zoom · Select to explore</p></div>;
}
