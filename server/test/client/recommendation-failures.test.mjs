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

test('top-level API error code is not reported as an outage',async()=>{
 const originalStatus=HomeConfig.status,originalXHR=globalThis.XMLHttpRequest;
 HomeConfig.status=()=>({deviceId:'fixture'});
 globalThis.XMLHttpRequest=class {open(){} send(){this.status=429;this.responseText=JSON.stringify({code:'QUOTA_EXCEEDED',message:'Daily request limit reached',failure:{code:'QUOTA_EXCEEDED',message:'Дневной лимит запросов исчерпан.',action:'Лимит сбрасывается в 00:00 МСК; администратор также может изменить лимит в настройках.',retryable:false}});this.onload()}};
 try {
  await assert.rejects(getHome(),error=>{assert.equal(error.code,'QUOTA_EXCEEDED');const failure=failureDetails(error);assert.equal(failure.message,'Дневной лимит запросов исчерпан.');assert.equal(failure.retryable,false);return true});
 } finally {HomeConfig.status=originalStatus;globalThis.XMLHttpRequest=originalXHR}
});

test('partial selection explains the actual catalog and exclusion counts',()=>{
 assert.equal(selectionText({targetCount:10,selection:{returned:3,resolved:5,excluded:2,unresolved:3}}),'3 из 10 · найдено в каталоге: 5 · исключено: 2 · не найдено: 3');
});
