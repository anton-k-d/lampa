import test from 'node:test';
import assert from 'node:assert/strict';
import {createMetadataCatalog} from '../../src/recommendations/metadata.mjs';

const proposal=(title,year=2020,media_type='movie',original_title=title)=>({title,original_title,year,media_type,reason:'reason',sources:['https://example.com']});
const film=(id,title,year=2020)=>({id,title,original_title:title,release_date:`${year}-01-01`,adult:false,genres:[{id:18}]});
const response=data=>new Response(JSON.stringify(data),{status:200});

test('resolves exact search results, hydrates unique cards, and caches search',async()=>{
 const calls=[];const p=proposal('Фильм',2020,'movie','Film');
 const catalog=createMetadataCatalog({baseUrl:'https://proxy.test/tmdb-proxy.js',fetchImpl:async url=>{const u=new URL(url);calls.push(u);return response(u.pathname.includes('/search/')?{results:[film(4,'  FILM! ')]}:film(4,'Film'));}});
 const result=await catalog.resolveTitles([p,p]);
 assert.equal(result.items.length,2);assert.equal(result.items[0].proposal,p);assert.equal(result.items[0].card.key,'tmdb:movie:4');assert.deepEqual(result.items[0].card.genre_ids,[18]);assert.deepEqual(result.unresolved,[]);
 const search=calls.find(u=>u.pathname==='/3/search/movie');assert.equal(search.searchParams.get('query'),'Film');assert.equal(search.searchParams.get('year'),'2020');assert.equal(search.searchParams.get('language'),'ru-RU');assert.equal(search.searchParams.get('include_adult'),'false');
 await catalog.resolveTitles([p]);assert.equal(calls.filter(u=>u.pathname.includes('/search/')).length,2); // concurrent first lookups may both request
});

test('reports ambiguous, wrong year and network errors independently',async()=>{
 const catalog=createMetadataCatalog({baseUrl:'https://proxy.test',fetchImpl:async url=>{const u=new URL(url);const q=u.searchParams.get('query');if(q==='Error')throw Error('offline');if(q==='Ambiguous')return response({results:[film(1,q),film(2,q)]});return response({results:[film(3,q,2019)]});}});
 const result=await catalog.resolveTitles([proposal('Ambiguous'),proposal('Missing'),proposal('Error')]);
 assert.deepEqual(result,{items:[],unresolved:[{index:0,status:'ambiguous'},{index:1,status:'not_found'},{index:2,status:'error',errorCode:'METADATA_UNAVAILABLE'}]});
});

test('falls back to localized title and rejects changed hydrated identity',async()=>{
 const queries=[];const catalog=createMetadataCatalog({baseUrl:'https://proxy.test',fetchImpl:async url=>{const u=new URL(url);if(u.pathname.includes('/search/')){queries.push(u.searchParams.get('query'));assert.equal(u.searchParams.get('first_air_date_year'),'2021');return response({results:u.searchParams.get('query')==='Локальное'?[{id:7,name:'Локальное',original_name:'Original',first_air_date:'2021-02-03',adult:false}]:[]});}return response({id:7,name:'Different',original_name:'Different',first_air_date:'2021-01-01'});}});
 const result=await catalog.resolveTitles([proposal('Локальное',2021,'tv','Original')]);assert.deepEqual(queries,['Original','Локальное']);assert.deepEqual(result.unresolved,[{index:0,status:'not_found'}]);
});
