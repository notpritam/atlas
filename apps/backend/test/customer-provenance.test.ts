import {expect,test} from 'bun:test';
import {normalizeProvenance} from '../src/customer-provenance.ts';

test('agent-created provenance survives normal validation and JSON round-trip',()=>{
  const provenance={
    schemaVersion:1 as const,captureMethod:'agent-create',pageUrl:'https://example.com/source',canonicalUrl:null,
    pageTitle:'Agent source',siteName:null,description:null,authors:[],publishedAt:null,modifiedAt:null,language:null,
    leadImageUrl:null,faviconUrl:null,targetUrl:'https://example.com/source',headings:[],capturedAt:1000,extractedAt:1000,
    extractorVersion:1,contentHash:null,extractionStatus:'complete' as const,extractionError:null,sourceApplication:'foundkeep-mcp',
  };
  expect(normalizeProvenance(JSON.parse(JSON.stringify(provenance)),1000)).toEqual(provenance);
});
