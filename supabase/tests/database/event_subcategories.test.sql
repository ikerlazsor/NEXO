begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(5);
update public.event_providers set enabled=true,license_verified_at=now(),format_verified_at=now() where id='madrid';
select is(public.sync_external_events('madrid',jsonb_build_array(jsonb_build_object(
 'source_id','synthetic-hiking','source_url','https://www.madrid.es/example','title','Synthetic hiking',
 'category','AIRE_LIBRE','subcategory','senderismo','start_date',current_date+1,'end_date',current_date+1,'status','active')),1),1,'imports existing Nexo subcategory');
select is((select subcategory from public.external_events where source_id='synthetic-hiking'),'senderismo','persists classification');
select throws_ok($$insert into public.external_events(provider_id,source_id,source_url,title,category,subcategory,start_date,end_date) values('madrid','synthetic-invalid','https://www.madrid.es/example','Synthetic','AIRE_LIBRE','futbol',current_date+1,current_date+1)$$,'23514',null,'rejects subcategory belonging to another category');
select lives_ok($$select public.sync_external_events('madrid',jsonb_build_array(jsonb_build_object('source_id','synthetic-old','source_url','https://www.madrid.es/example','title','Older importer','category','DESCUBRIR','start_date',current_date+1,'end_date',current_date+1,'status','active')),1)$$,'supports older importer without subcategory');
select is((select subcategory from public.external_events where source_id='synthetic-old'),'otro','unknown topic is not assigned an invented precise subcategory');
select * from finish();
rollback;
