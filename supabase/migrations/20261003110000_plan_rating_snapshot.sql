-- Portada y título de la valoración: los del plan cuando se quedó como chat fijo.
-- Cambiar luego el nombre o la foto del grupo no los toca.

alter table public.planes
    add column if not exists titulo_cierre text,
    add column if not exists imagen_cierre text;

update public.planes
   set titulo_cierre = coalesce(titulo_cierre, titulo),
       imagen_cierre = coalesce(imagen_cierre, imagen_url)
 where coalesce(categoria, '') = 'Grupo'
   and coalesce(is_group_chat, false) = false
   and fecha_evento is not null
   and fecha_evento <= now();

-- Fiesta ICEX: la foto de grupo ya había sustituido la portada de las bolas de discoteca.
update public.planes
   set titulo_cierre = 'Fiesta ICEX en Rubicon',
       imagen_cierre = 'nexo_cover:VIBES:fiesta:0'
 where id = '8f73c461-e9d4-48f4-8a1e-803c4cb7e163';

create or replace function public.protect_plan_cierre_snapshot()
returns trigger
language plpgsql
as $$
begin
    if old.titulo_cierre is not null then
        new.titulo_cierre := old.titulo_cierre;
    end if;
    if old.imagen_cierre is not null then
        new.imagen_cierre := old.imagen_cierre;
    end if;
    return new;
end;
$$;

drop trigger if exists planes_protect_cierre_snapshot on public.planes;
create trigger planes_protect_cierre_snapshot
    before update on public.planes
    for each row
    execute function public.protect_plan_cierre_snapshot();

create or replace function public.keep_plan_chat_forever(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_creator uuid;
    v_fecha timestamptz;
    v_cat text;
    v_chat_gone timestamptz;
begin
    if auth.uid() is null or p_plan_id is null then
        raise exception 'not_authenticated';
    end if;

    select creador_id, fecha_evento, categoria, chat_eliminado_en
      into v_creator, v_fecha, v_cat, v_chat_gone
      from public.planes
     where id = p_plan_id;

    if v_creator is null then
        raise exception 'plan_not_found';
    end if;
    if v_creator is distinct from auth.uid() then
        raise exception 'not_creator';
    end if;
    if coalesce(v_cat, '') in ('Grupo', 'Chat') then
        return;
    end if;
    if v_chat_gone is not null then
        raise exception 'chat_gone';
    end if;
    if v_fecha is null or v_fecha > now() then
        raise exception 'plan_still_active';
    end if;
    if v_fecha + interval '48 hours' <= now() then
        raise exception 'chat_gone';
    end if;

    update public.planes
       set categoria = 'Grupo',
           chat_eliminado_en = null,
           titulo_cierre = coalesce(titulo_cierre, titulo),
           imagen_cierre = coalesce(imagen_cierre, imagen_url)
     where id = p_plan_id;
end;
$$;

revoke all on function public.keep_plan_chat_forever(uuid) from public, anon;
grant execute on function public.keep_plan_chat_forever(uuid) to authenticated;
