'use client';
import {useCallback,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {masonryLayout} from '../../../../packages/shared/src/collection-presentation';
/** The same shortest-column layout as the saved dashboard; DOM order stays chronological. */
export function useEntryMasonry(items:{id:string}[],enabled:boolean){
 const grid=useRef<HTMLDivElement>(null),cells=useRef(new Map<string,HTMLElement>());
 const [measurement,setMeasurement]=useState({width:0,columns:1,heights:new Map<string,number>()});
 const measure=useCallback(()=>{if(!enabled||!grid.current)return;const width=grid.current.clientWidth,minimum=matchMedia('(max-width:680px)').matches?155:260,columns=Math.max(1,Math.floor((width+18)/(minimum+18))),heights=new Map<string,number>();for(const [id,cell]of cells.current)heights.set(id,Math.ceil(cell.offsetHeight));setMeasurement(old=>old.width===width&&old.columns===columns&&old.heights.size===heights.size&&[...heights].every(([id,h])=>old.heights.get(id)===h)?old:{width,columns,heights});},[enabled]);
 useLayoutEffect(()=>{if(!enabled)return;let frame=0;const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);});if(grid.current)observer.observe(grid.current);for(const el of cells.current.values())observer.observe(el);measure();return()=>{observer.disconnect();cancelAnimationFrame(frame);};},[items,enabled,measure]);
 const ready=enabled&&measurement.width>0&&items.length>0,layout=masonryLayout(items.map(item=>measurement.heights.get(item.id)||260),measurement.width,measurement.columns,18);
 return {grid,ready,style:ready?{display:'block',position:'relative',height:layout.height} as CSSProperties:undefined,cell:(id:string,el:HTMLElement|null)=>{if(el)cells.current.set(id,el);else cells.current.delete(id);},position:(index:number):CSSProperties|undefined=>ready?{position:'absolute',width:layout.items[index]!.width,left:layout.items[index]!.left,top:layout.items[index]!.top}:undefined};
}
