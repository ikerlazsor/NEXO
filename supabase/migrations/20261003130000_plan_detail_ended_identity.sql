-- El detalle de un plan convertido en chat fijo muestra el título y la
-- portada de cuando acabó, no el nombre ni la foto nuevos del grupo.

create or replace function public.get_plan_detail(p_plan_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $$
declare
    v_uid uuid := auth.uid();
    v_plan jsonb;
    v_creator_id uuid;
    v_accepted uuid[];
    v_card_ids uuid[];
    v_profiles jsonb;
begin
    if v_uid is null or p_plan_id is null then
        return null;
    end if;

    select to_jsonb(plan_row)
    into v_plan
    from (
        select
            pl.id,
            coalesce(nullif(btrim(pl.titulo_cierre), ''), pl.titulo) as titulo,
            coalesce(nullif(btrim(pl.imagen_cierre), ''), pl.imagen_url) as imagen_url,
            pl.imagenes_url,
            pl.recurrencia,
            pl.categoria,
            pl.tipo_deporte,
            pl.solo_chicas,
            pl.modo_privado,
            pl.fecha_evento,
            pl.nombre_ubicacion,
            pl.latitud,
            pl.longitud,
            pl.maximo_participantes,
            pl.creador_id,
            pl.requiere_aprobacion,
            pl.descripcion,
            pl.chat_eliminado_en
        from public.planes as pl
        where pl.id = p_plan_id
    ) as plan_row;

    if v_plan is null then
        return null;
    end if;

    v_creator_id := (v_plan ->> 'creador_id')::uuid;

    select coalesce(array_agg(part.usuario_id order by part.usuario_id), '{}'::uuid[])
    into v_accepted
    from public.participantes as part
    where part.plan_id = p_plan_id
      and part.estado = 'aceptado';

    with raw as (
        select v_creator_id as uid, 0 as ord
        union all
        select u, 1 from unnest(v_accepted) as u
    ),
    dedup as (
        select uid, min(ord) as ord
        from raw
        where uid is not null
        group by uid
    )
    select coalesce(array_agg(uid order by ord, uid), '{}'::uuid[])
    into v_card_ids
    from (select uid, ord from dedup order by ord, uid limit 200) as capped;

    select coalesce(jsonb_agg(to_jsonb(card)), '[]'::jsonb)
    into v_profiles
    from public.get_public_profiles(v_card_ids) as card;

    return jsonb_build_object(
        'plan', v_plan,
        'acceptedIds', to_jsonb(coalesce(v_accepted, '{}'::uuid[])),
        'profiles', v_profiles
    );
end;
$$;

revoke all on function public.get_plan_detail(uuid) from public;
revoke execute on function public.get_plan_detail(uuid) from anon;
grant execute on function public.get_plan_detail(uuid) to authenticated;
