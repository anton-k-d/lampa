import {test} from 'node:test';
import assert from 'node:assert/strict';
import HomeConfig from '../../../src/core/home/config.mjs';
import {getHome,failureDetails,selectionText} from '../../../src/core/home/recommendations/client.mjs';

test('HTTP quota failure preserves code and status with an actionable safe message',async()=>{
 const originalStatus=HomeConfig.status,originalXHR=globalThis.XMLHttpRequest;
 HomeConfig.status=()=>({deviceId:'fixture'});
 globalThis.XMLHttpRequest=class {open(){} send(){this.status=429;this.responseText=JSON.stringify({error:{code:'QUOTA_EXCEEDED',message:'unsafe provider detail'}});this.onload()}};
 try {
  await assert.rejects(getHome(),error=>{assert.equal(error.code,'QUOTA_EXCEEDED');assert.equal(error.status,429);const failure=failureDetails(error);assert.equal(failure.retryable,false);assert.match(failure.action,/00:00 МСК/);assert.doesNotMatch(failure.message,/unsafe/);return true});
 } finally {HomeConfig.status=originalStatus;globalThis.XMLHttpRequest=originalXHR}
});

test('partial selection explains the actual catalog and exclusion counts',()=>{
 assert.equal(selectionText({targetCount:10,selection:{returned:3,resolved:5,excluded:2,unresolved:3}}),'3 из 10 · найдено в каталоге: 5 · исключено: 2 · не найдено: 3');
});
