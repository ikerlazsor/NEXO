const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./helpers/loadTs.cjs');
const policy = require('../lib/externalEventPolicy.cjs');

test('discovery requires an identifiable participatory activity, even if an old import marked a concert social', () => {
  for (const title of ['Senderismo por la sierra', 'Language exchange Madrid', 'Café e intercambio de idiomas', 'Yoga en grupo', 'Pilates', 'Juegos de mesa', 'Club de lectura', 'Taller de cerámica', 'Clase de salsa', 'Pachanga de fútbol', 'Picnic en el Retiro']) assert.equal(policy.isSocialActivity(title), true, title);
  for (const title of ['Concierto social', 'Festival de yoga', 'Teatro con amigos', 'Una tarde inolvidable', 'Encuentro con un autor', 'Ajedrez escolar', 'Yoga infantil', 'Yoga online', 'Maratón', 'Exposición de fotografía']) {
    assert.equal(policy.isSocialActivity(title, 'Un meetup social para conocer gente'), false, title);
    assert.equal(policy.isPublishableEvent({ title, status:'active', starts_at:new Date(Date.now()+86400000).toISOString(), venue:'Local confirmado', latitude:40.42, longitude:-3.7, social_eligible:true }),false,title);
  }
});

test('own and joined plans precede friends, which precede taste irrespective of score', () => {
  const load=createLoader();
  const { rankUnifiedFeed, retainFeedOrder }=load('features/events/ranking.ts');
  const { buildFeedTaste }=load('lib/feedAffinity.ts');
  const context={taste:buildFeedTaste(['Deportista'],[]),friendIds:new Set(['friend']),coincidedIds:new Set(),coords:null,currentUserId:'me'};
  const row=(id,creator,category,membership)=>({id,kind:'plan',membership,plan:{id,creador_id:creator,categoria:category}});
  const rows=[row('affinity','stranger','DEPORTES'),row('friend','friend','FOODIES'),row('own','me','SHOWTIME'),row('joined','stranger','SHOWTIME','joined')];
  const ranked=rankUnifiedFeed(rows,[],context);
  const ids=Array.from(ranked,r=>r.id);
  assert.ok(ids.indexOf('own') < ids.indexOf('friend'));
  assert.ok(ids.indexOf('joined') < ids.indexOf('friend'));
  assert.ok(ids.indexOf('friend') < ids.indexOf('affinity'));
  const event={id:'external',title:'Yoga en grupo',category:'DEPORTES',status:'active',starts_at:new Date(Date.now()+86400000).toISOString(),venue:'Local confirmado',latitude:40.42,longitude:-3.7};
  const later=rankUnifiedFeed(rows,[event],context);
  assert.deepEqual(Array.from(retainFeedOrder(ids,later),r=>r.id).slice(0,ids.length),ids,'a late event page never moves a displayed card');
  const ownExternal=rankUnifiedFeed(rows,[event],{...context,joinedEvents:new Set(['external'])});
  assert.ok(ownExternal.findIndex(r=>r.id==='event:external') < ownExternal.findIndex(r=>r.id==='friend'));
});

test('map ignores invalid coordinates and bounds markers, grouping by category without changing category colors', () => {
  const { validMapCoordinates, discoveryPins }=createLoader({'./categories':{ getCategoryColor:c=>c==='DEPORTES'?'blue':'green' }} )('lib/mapDiscovery.ts');
  for(const [latitud,longitud] of [[null,-3.7],['',-3.7],[Infinity,-3.7],[91,-3.7],[40.4,181],[0,0]]) assert.equal(validMapCoordinates({latitud,longitud}),false);
  const region={latitude:40.42,longitude:-3.7,latitudeDelta:.28,longitudeDelta:.28};
  const items=Array.from({length:1000},(_,n)=>({id:String(n),categoria:n%2?'DEPORTES':'AIRE_LIBRE',latitud:40.42+n%5*.00001,longitud:-3.7}));
  const pins=discoveryPins(items,region);
  assert.equal(pins.length,2);
  assert.deepEqual(Array.from(pins,p=>p.color).sort(),['blue','green']);
  assert.equal(pins.reduce((n,p)=>n+p.members.length,0),1000);
  assert.equal(discoveryPins([...items,{id:'invalid',latitud:NaN,longitud:null}],region).length,2);
  assert.equal(discoveryPins(items,region,'24').find(p=>p.key==='pin:24').members[0].id,'24');
  assert.ok(discoveryPins(Array.from({length:200},(_,n)=>({id:n,latitud:40.3+n%20*.01,longitud:-3.8+Math.floor(n/20)*.01})),region).length<=36);
});

test('location acquisition without a distance filter cannot restart the event query', () => {
  const {eventQueryKey}=createLoader({'../../lib/diskCache':{diskGet:async()=>null,diskSet:async()=>{}}})('features/events/cache.ts');
  assert.equal(eventQueryKey({}),eventQueryKey({categories:[],query:' ',latitude:40.4,longitude:-3.7}));
  assert.notEqual(eventQueryKey({}),eventQueryKey({radius:5,latitude:40.4,longitude:-3.7}));
});

test('adult creative workshops and group walks qualify without admitting children-only activities or shows', () => {
  for (const title of ["Taller 'Fanzineitor'", "'Pintar la luz' Visita-taller para personas adultas", 'Taller de Collage para adultos', 'Paseo ornitológico', 'Taller de ROPE FLOW', 'Pon a punto tu bici. Taller de mecánica básica', 'Taller de lectura: La Odisea']) assert.equal(policy.isSocialActivity(title), true, title);
  for (const description of ['Público familiar, a partir de 5 años.', 'Dirigido a: chicos y chicas de 8 a 10 años.', 'Debe asistir solo un adulto por inscripción.', 'Taller para niños de 6 a 12 años.']) assert.equal(policy.isSocialActivity('Taller de cerámica', description), false, description);
  assert.equal(policy.isSocialActivity("Taller 'Fanzineitor'", 'Personas de entre 15 y 30 años. El profesor también imparte cómic infantil.'), true);
  assert.equal(policy.isSocialActivity('Paseo ornitológico', 'Dirigido a personas a partir de 9 años. Si el grupo familiar es de más de 4 miembros, puedes apuntar a todos.'), true);
  assert.equal(policy.isSocialActivity('Concierto de jazz', 'Taller de improvisación para socializar'), false);
  const classify = require('../lib/externalEventClassification.cjs').classifyExternalEvent;
  assert.deepEqual(classify('Taller de ROPE FLOW'), {category:'DEPORTES',subcategory:'otro'});
  assert.deepEqual(classify('Taller de Collage para adultos'), {category:'VIBES',subcategory:'otro'});
  assert.deepEqual(classify('Paseo ornitológico'), {category:'AIRE_LIBRE',subcategory:'otro'});
});
