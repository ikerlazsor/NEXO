const {test}=require('node:test');
const assert=require('node:assert/strict');
const {jsonLdSnapshot}=require('../scripts/events/publisher-jsonld.cjs');
const {prepareSocialSnapshot}=require('../scripts/events/social-snapshot.cjs');
const {eventLinks,SOURCES,reviewSource}=require('../scripts/events/public-source-review.cjs');
const now=new Date('2026-11-08T12:00:00Z');
const source='https://organizer.example/activities';
const event={ '@type':'SocialEvent',name:'Language exchange Madrid',url:'https://organizer.example/event/1',startDate:'2026-11-15T19:00:00+01:00',location:{'@type':'Place',name:'Bar confirmado',address:{streetAddress:'Calle de prueba 1',addressLocality:'Madrid'},geo:{latitude:40.42,longitude:-3.7}} };
const html=rows=>`<script type="application/ld+json">${JSON.stringify({'@graph':rows})}</script>`;
test('publisher structured facts retain their own source and go through the same social, location and time policy',async()=>{
 const raw=jsonLdSnapshot(html([event,{...event,name:'Concierto infantil',url:'https://organizer.example/event/2'},{...event,name:'Yoga',url:'https://organizer.example/event/3',location:{name:'Madrid'}}]),source);
 const ready=await prepareSocialSnapshot(raw,{now});
 assert.equal(ready.events.length,1);
 assert.equal(ready.events[0].starts_at,'2026-11-15T18:00:00.000Z');
 assert.equal(ready.events[0].source_url,event.url);
 assert.equal(ready.events[0].subcategory,'idiomas');
 assert.equal(ready.excluded.social,1);
 assert.equal(ready.excluded.location,1);
});
test('source pages cannot invent sessions from floating clocks, recurring calendars or online meetings',()=>{
 const raw=jsonLdSnapshot(html([{...event,startDate:'2026-11-15T19:00:00'},{...event,eventSchedule:{repeatFrequency:'P1W'}},{...event,eventAttendanceMode:'https://schema.org/OnlineEventAttendanceMode'}]),source);
 assert.equal(raw.events.length,0);
 assert.equal(raw.excludedStructured,3);
 assert.throws(()=>jsonLdSnapshot('<script type="application/ld+json">broken</script>',source),/Invalid/);
 assert.throws(()=>jsonLdSnapshot('<h1>No event data</h1>',source),/No structured/);
 assert.throws(()=>jsonLdSnapshot(html([event]),'http://127.0.0.1/'),/Invalid/);
});
test('repeated metadata creates a single occurrence and explicit cancellation stays cancelled',()=>{
 const raw=jsonLdSnapshot(html([event,event]),source);
 assert.equal(raw.events.length,1); assert.equal(raw.duplicates,1);
 assert.equal(jsonLdSnapshot(html([{...event,eventStatus:'https://schema.org/EventCancelled'}]),source).events[0].status,'cancelled');
});
test('public publisher venue facts must match the exact occurrence and never bring external members into Nexo', async()=>{
 const url='https://www.meetup.com/sample/events/123/';
 const item={...event,url,location:{name:'Bar confirmado'}};
 const facts={title:item.name,eventUrl:url,dateTime:item.startDate,venue:{lat:40.42,lng:-3.7},goingCount:999,token:'not-an-import-field'};
 const page=value=>html([item])+`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{event:value}}})}</script>`;
 const row=jsonLdSnapshot(page(facts),url).events[0];
 assert.equal((await prepareSocialSnapshot({events:[row]},{now})).events.length,1);
 assert.equal(row.latitude,40.42);
 assert.equal('goingCount' in row,false); assert.equal('token' in row,false);
 assert.equal(jsonLdSnapshot(page({...facts,dateTime:'2026-11-16T19:00:00+01:00'}),url).events[0].latitude,null);
 assert.equal(jsonLdSnapshot(page(facts),'https://organizer.example/event').events[0].latitude,null);
 assert.equal(jsonLdSnapshot(html([{...item,startDate:'2026-11-16T19:00:00+01:00'}]),url).events[0].source_id,row.source_id);
});
test('source discovery follows public event links on the reviewed host only, removes trackers and never labels a partial review as an import', async()=>{
 const good='https://www.meetup.com/group/events/123/';
 assert.deepEqual(eventLinks(`<a href="${good}?tracking=1"></a><a href="${good}"></a><a href="https://other.example/group/events/123/"></a><a href="https://www.meetup.com/group/members/123/"></a>`,SOURCES.meetup),[good]);
 const report=await reviewSource('meetup',{now,wait:async()=>{},fetchImpl:async url=>new Response(url===good?html([{...event,url:good}]):`<a href="${good}"></a>`)});
 assert.equal(report.events.length,1);assert.equal(report.reuse_approved,false);assert.equal(report.complete_import_snapshot,false);
 await assert.rejects(()=>reviewSource('https://other.example'),/Unknown/);
});
