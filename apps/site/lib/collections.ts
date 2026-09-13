import type {ApiOptions} from './api';
export interface SharedCollection {
 id:string;slug:string;title:string;description:string;tags:string[];rules:string;kind:'personal'|'group';visibility:'public'|'private';submissionPolicy:'owner'|'members'|'anyone';requireApproval:boolean;createdAt:number;updatedAt:number;ownerName:string;entries:number;followers:number;role:'owner'|'moderator'|'contributor'|'viewer'|null;canSubmit:boolean;canModerate:boolean;following:boolean;
}
export interface SharedEntry {id:string;title:string;url:string|null;body:string;tags:string[];status:'pending'|'approved'|'rejected';createdAt:number;updatedAt:number;authorName:string;imageUrl:string|null;canRemove:boolean;canMove:boolean}
export interface CollectionDetail {collection:SharedCollection;entries:SharedEntry[];nextCursor:string|null;pending:number;total?:number;availableTags?:string[]}
export interface CollectionList {collections:SharedCollection[];invitations:{id:string;title:string;slug:string;role:string}[];canCreateGroup:boolean}
export type CollectionRequest=<T>(path:string,options?:ApiOptions)=>Promise<T>;
export function slugFor(title:string) {return title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,64).replace(/-$/,'');}
export const splitTags=(text:string)=>[...new Set(text.split(',').map(s=>s.trim()).filter(Boolean))];
