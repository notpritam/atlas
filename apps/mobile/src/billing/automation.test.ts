import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAutomation } from './automation.ts';
import type { AutomationState } from './types.ts';
test('older timing fields default safely without changing explicit consent',()=>{
 const result=normalizeAutomation({enabled:false,images:false,usage:{used:3,reserved:2,limit:200}} as AutomationState);
 assert.equal(result.mode,'instant');assert.equal(result.intervalHours,24);assert.equal(result.monthlyLimit,200);assert.equal(result.nextRunAt,null);assert.equal(result.enabled,false);
});
test('server timing, pause and zero monthly cap survive normalization',()=>{
 const result=normalizeAutomation({mode:'paused',intervalHours:6,monthlyLimit:0,nextRunAt:null,usage:{used:3,reserved:2,limit:200,monthlyLimit:0}} as AutomationState);
 assert.equal(result.mode,'paused');assert.equal(result.intervalHours,6);assert.equal(result.monthlyLimit,0);assert.equal(result.usage.monthlyLimit,0);
});
