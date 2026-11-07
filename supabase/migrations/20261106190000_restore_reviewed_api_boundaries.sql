begin;

-- Restore the reviewed Data API boundary undone by the blanket grants in
-- 20261027120000. Keep existing authenticated application CRUD/RPC grants;
-- remove anonymous table access and maintenance powers, never application data.
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke truncate, references, trigger, maintain on all tables in schema public from authenticated;

-- Future objects require explicit client grants in their own migrations.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

-- Preserve the event-trigger object while removing its blanket public grants.
create or replace function public.grant_data_api_on_new_relation()
returns event_trigger language plpgsql security definer set search_path=pg_catalog as $$
declare obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE','CREATE TABLE AS','CREATE VIEW','CREATE MATERIALIZED VIEW','CREATE FOREIGN TABLE')
  loop
    if obj.schema_name='public' and obj.object_type in ('table','view','materialized view','foreign table') then
      execute format('grant all on %s to postgres, service_role',obj.object_identity);
    end if;
  end loop;
end;
$$;

-- Anonymous clients use only the current reviewed registration/feed/share APIs.
-- Authenticated grants remain as they were, except the specifically retired or
-- server-only functions below and trigger functions, which are not RPCs.
do $permissions$
declare fn record;
begin
  for fn in select p.oid,p.prorettype,
    format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) as identity
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  loop
    execute format('revoke execute on function %s from public, anon',fn.identity);
    execute format('grant execute on function %s to service_role',fn.identity);
    if fn.prorettype in ('trigger'::regtype,'event_trigger'::regtype) then
      execute format('revoke execute on function %s from authenticated',fn.identity);
    end if;
  end loop;
  for fn in select p.oid,p.proname,
    format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) as identity
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in (
        'admin_delete_user','admin_delete_plan','consume_ai_search_quota',
        'delete_own_account','borrar_propia_cuenta','get_user_storage_cleanup_paths',
        'get_plan_storage_cleanup_paths','prepare_account_deletion',
        'service_delete_plan','service_delete_account','get_login_email_by_username','is_email_taken',
        'claim_push_message','claim_push_message_delivery','claim_push_outbox_event',
        'complete_push_message_delivery','complete_push_outbox_event','consume_push_dispatch_quota',
        'get_due_push_outbox_event_ids','invoke_push_outbox_dispatcher'
      )
  loop
    execute format('revoke execute on function %s from authenticated',fn.identity);
  end loop;
end;
$permissions$;
grant execute on function public.is_username_taken_public(text),
 public.get_guest_feed(double precision,double precision,integer),
 public.get_guest_plan(uuid),public.search_feed_plans(text),
 public.get_external_events_page(date,uuid,text[],text,double precision,double precision,double precision,date,date),
 public.get_external_event(uuid) to anon;

-- Restore the reviewed column grants, including later organizer/directory
-- additions and language writes, without the blanket table-wide grants.
revoke select,insert,update,delete on public.perfiles from authenticated;
grant select(id,nombre,nombre_usuario,avatar_url,descripcion,creado_en,es_organizador,organizador,cover_url,registro_completado) on public.perfiles to authenticated;
grant insert(id,nombre,nombre_usuario,avatar_url,descripcion,fecha_nacimiento,genero,ambientes_preferidos,etiquetas,habitos_consumo,perfil_gustos,registro_completado,notificaciones_push,notif_messages,notif_social,notif_reminders) on public.perfiles to authenticated;
grant update(nombre,nombre_usuario,avatar_url,descripcion,fecha_nacimiento,genero,ambientes_preferidos,etiquetas,habitos_consumo,perfil_gustos,registro_completado,notificaciones_push,notif_messages,notif_social,notif_reminders,organizador,cover_url,idioma) on public.perfiles to authenticated;
revoke insert,update,delete on public.reportes_mensajes from authenticated;

-- Interest discovery must not filter private table columns from the client.
-- Each indexed branch keeps the former 60-candidate bound; only visible public
-- interests participate, and the response contains IDs rather than private tags.
create index if not exists perfiles_discovery_ambientes_gin on public.perfiles using gin(ambientes_preferidos) where es_organizador=false and registro_completado=true;
create index if not exists perfiles_discovery_etiquetas_gin on public.perfiles using gin(etiquetas) where es_organizador=false and registro_completado=true;
create or replace function public.get_profile_interest_candidates(p_tags text[],p_limit integer default 120)
returns table(id uuid) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare tags text[]; requested integer := least(120,greatest(1,coalesce(p_limit,120)));
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if public.current_user_banned() then raise exception 'account_banned' using errcode='42501'; end if;
  if coalesce(cardinality(p_tags),0)>20 then raise exception 'too_many_tags'; end if;
  select array_agg(distinct left(btrim(value),64)) into tags from unnest(p_tags) value where nullif(btrim(value),'') is not null;
  if coalesce(cardinality(tags),0)=0 then return; end if;
  return query
    with candidates as (
      (select p.id from public.perfiles p where p.es_organizador=false and p.registro_completado=true
        and not coalesce(p.baneado,false) and p.id<>auth.uid()
        and coalesce(p.perfil_gustos #> '{privacidad,mostrar_aficiones}'='true'::jsonb,true)
        and p.ambientes_preferidos && tags and public.can_view_profile_identity(p.id) order by p.id limit least(60,requested))
      union
      (select p.id from public.perfiles p where p.es_organizador=false and p.registro_completado=true
        and not coalesce(p.baneado,false) and p.id<>auth.uid()
        and coalesce(p.perfil_gustos #> '{privacidad,mostrar_aficiones}'='true'::jsonb,true)
        and p.etiquetas && tags and public.can_view_profile_identity(p.id) order by p.id limit least(60,requested))
    ) select c.id from candidates c order by c.id limit requested;
end;
$$;
revoke execute on function public.get_profile_interest_candidates(text[],integer) from public,anon;
grant execute on function public.get_profile_interest_candidates(text[],integer) to authenticated,service_role;

-- A provider kill-switch must revoke social reads as well as hide feed cards.
-- Verification gates apply equally to public pages, participant lists and chat.
create or replace function public.event_provider_available(p_event uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.external_events e join public.event_providers p on p.id=e.provider_id
    where e.id=p_event and p.enabled and p.license_verified_at is not null and p.format_verified_at is not null);
$$;
revoke execute on function public.event_provider_available(uuid) from public,anon;
grant execute on function public.event_provider_available(uuid) to authenticated,service_role;

create or replace function public.event_is_member(p_event uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.event_viewer_allowed() and public.event_provider_available(p_event) and exists(
    select 1 from public.external_event_participants where event_id=p_event and user_id=auth.uid());
$$;
alter policy provider_read on public.event_providers using(enabled and license_verified_at is not null and format_verified_at is not null);
alter policy event_read on public.external_events using(public.event_provider_available(id));
alter policy participant_read on public.external_event_participants using(public.event_provider_available(event_id) and public.event_users_visible(user_id));
create or replace function public.set_event_membership(p_event uuid,p_join boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.external_events;
begin
  if not public.event_viewer_allowed() then raise exception 'account_required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,12));
  select * into e from public.external_events where id=p_event for update;
  if not found then raise exception 'event_not_found'; end if;
  if not p_join then
    delete from public.external_event_participants where event_id=p_event and user_id=auth.uid();
    return;
  end if;
  if e.status <> 'active' or e.end_date < (now() at time zone 'Europe/Madrid')::date
    or not public.event_provider_available(p_event) then
    raise exception 'event_unavailable';
  end if;
  if (select count(*) from public.external_event_participants where user_id=auth.uid()) >= 100
    and not public.event_is_member(p_event) then raise exception 'event_membership_limit'; end if;
  insert into public.external_event_participants(event_id,user_id) values(p_event,auth.uid()) on conflict do nothing;
  insert into public.external_event_interactions(user_id,event_id,kind) values(auth.uid(),p_event,'join') on conflict do nothing;
end;
$$;


create or replace function public.track_event_interaction(p_event uuid,p_kind text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.event_viewer_allowed() then raise exception 'account_required' using errcode='42501'; end if;
  if p_kind not in ('view','official') then raise exception 'invalid_interaction'; end if;
  if not public.event_provider_available(p_event) then raise exception 'event_not_found'; end if;
  insert into public.external_event_interactions(user_id,event_id,kind) values(auth.uid(),p_event,p_kind) on conflict do nothing;
end;
$$;


create or replace function public.send_event_message(p_event uuid,p_client uuid,p_body text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid; original_event uuid; original_body text;
begin
  -- Same lock as leave: once leaving completes, sending is denied.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,12));
  if not public.event_is_member(p_event) then raise exception 'membership_required' using errcode='42501'; end if;
  if not exists(select 1 from public.external_events e join public.event_providers p on p.id=e.provider_id
    where e.id=p_event and e.status='active' and e.end_date >= (now() at time zone 'Europe/Madrid')::date and p.enabled and p.license_verified_at is not null and p.format_verified_at is not null) then raise exception 'event_unavailable'; end if;
  select id,event_id,body into result,original_event,original_body from public.external_event_messages where sender_id=auth.uid() and client_id=p_client;
  if found then
    if original_event<>p_event or original_body<>trim(p_body) then raise exception 'message_client_conflict' using errcode='23505'; end if;
    return result;
  end if;
  if (select count(*) from public.external_event_messages where sender_id=auth.uid() and created_at>now()-interval '1 minute') >= 20 then raise exception 'message_rate_limit'; end if;
  insert into public.external_event_messages(event_id,sender_id,client_id,body) values(p_event,auth.uid(),p_client,trim(p_body)) returning id into result;
  return result;
end;
$$;


create or replace function public.get_external_events_page(
  p_after_date date default null,p_after_id uuid default null,p_categories text[] default null,
  p_query text default null,p_lat double precision default null,p_lon double precision default null,
  p_radius double precision default null,p_from date default null,p_until date default null
) returns setof public.external_events language sql stable security definer set search_path=public,pg_temp as $$
  select e.* from public.external_events e where e.status='active' and exists(select 1 from public.event_providers p where p.id=e.provider_id and p.enabled and p.license_verified_at is not null and p.format_verified_at is not null)
    and e.end_date >= (now() at time zone 'Europe/Madrid')::date
    and (p_after_date is null or (e.start_date,e.id)>(p_after_date,p_after_id))
    and (coalesce(cardinality(p_categories),0)=0 or e.category=any(p_categories))
    and (nullif(trim(p_query),'') is null or e.title ilike '%'||left(p_query,100)||'%' or e.venue ilike '%'||left(p_query,100)||'%')
    and (p_from is null or e.end_date>=p_from) and (p_until is null or e.start_date<=p_until)
    and (p_radius is null or (p_lat between -90 and 90 and p_lon between -180 and 180 and
      e.latitude between p_lat-least(greatest(p_radius,0),200)/111.0 and p_lat+least(greatest(p_radius,0),200)/111.0 and
      6371*2*asin(sqrt(least(1.0,power(sin(radians(e.latitude-p_lat)/2),2)+cos(radians(p_lat))*cos(radians(e.latitude))*power(sin(radians(e.longitude-p_lon)/2),2))))<=least(greatest(p_radius,0),200)))
  order by e.start_date,e.id limit 30;
$$;


create or replace function public.get_external_event(p_event uuid) returns setof public.external_events
language sql stable security definer set search_path=public,pg_temp as $$
  select e.* from public.external_events e join public.event_providers p on p.id=e.provider_id where e.id=p_event and p.enabled and p.license_verified_at is not null and p.format_verified_at is not null;
$$;

create or replace function public.get_profile_screen(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
    v_profile jsonb;
    v_stats jsonb;
    v_attended jsonb;
begin
    if uid is null then
        raise exception 'not_authenticated';
    end if;
    if p_user_id is null or not public.can_view_profile_identity(p_user_id) then
        return null;
    end if;

    if p_user_id=uid then
    select jsonb_build_object(
        'id', p.id,
        'nombre', p.nombre,
        'nombre_usuario', p.nombre_usuario,
        'avatar_url', p.avatar_url,
        'cover_url', p.cover_url,
        'descripcion', p.descripcion,
        'etiquetas', coalesce(p.etiquetas, '{}'::text[]),
        'fecha_nacimiento', p.fecha_nacimiento,
        'edad', extract(year from age(current_date,p.fecha_nacimiento))::integer,
        'genero', p.genero,
        'habitos_consumo', coalesce(p.habitos_consumo, '{}'::jsonb),
        'ambientes_preferidos', coalesce(p.ambientes_preferidos, '{}'::text[]),
        'perfil_gustos', coalesce(p.perfil_gustos, '{}'::jsonb),
        'es_organizador', coalesce(p.es_organizador, false),
        'organizador', p.organizador
    )
    into v_profile
    from public.perfiles p
    where p.id = p_user_id;

    else
        -- Reuse the same privacy switches/blocking/redaction as every other
        -- public profile RPC instead of returning the private profile row.
        select to_jsonb(card)||jsonb_build_object('fecha_nacimiento',null)
        into v_profile from public.get_public_profiles(array[p_user_id]) card;
    end if;

    if v_profile is null then
        return null;
    end if;

    select jsonb_build_object(
        'valoracion_media', s.valoracion_media,
        'porcentaje_repetiria', s.porcentaje_repetiria,
        'porcentaje_asistencia', s.porcentaje_asistencia,
        'numero_valoraciones', s.numero_valoraciones,
        'numero_evaluadores_distintos', s.numero_evaluadores_distintos,
        'numero_planes_realizados', s.numero_planes_realizados,
        'numero_amistades', s.numero_amistades,
        'aspecto_positivo_mas_votado', s.aspecto_positivo_mas_votado,
        'aspecto_negativo_mas_votado', s.aspecto_negativo_mas_votado,
        'planes_tapas', s.planes_tapas,
        'planes_deporte', s.planes_deporte,
        'planes_fiesta', s.planes_fiesta,
        'planes_estudio', s.planes_estudio,
        'planes_solo_chicas', s.planes_solo_chicas,
        'categorias_probadas', s.categorias_probadas,
        'planes_creados', s.planes_creados,
        'personas_distintas', s.personas_distintas
    )
    into v_stats
    from public.estadisticas_usuario s
    where s.usuario_id = p_user_id;

    select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
    into v_attended
    from (
        select
            pl.id,
            coalesce(nullif(btrim(pl.titulo_cierre), ''), pl.titulo) as titulo,
            coalesce(nullif(btrim(pl.imagen_cierre), ''), pl.imagen_url) as imagen_url,
            pl.fecha_evento,
            pl.nombre_ubicacion,
            pl.categoria
        from public.historial_planes hp
        join public.planes pl on pl.id = hp.plan_id
        where hp.usuario_id = p_user_id
          and coalesce(hp.oculto_perfil, false) = false
          and coalesce(pl.modo_privado, false) = false
          and coalesce(pl.is_group_chat, false) = false
          and coalesce(pl.categoria, '') <> 'Chat'
        order by coalesce(pl.fecha_evento, hp.creado_en) desc nulls last
        limit 12
    ) x;

    return jsonb_build_object(
        'profile', v_profile,
        'stats', coalesce(v_stats, '{}'::jsonb),
        'attended', coalesce(v_attended, '[]'::jsonb)
    );
end;
$$;


notify pgrst,'reload schema';
commit;
