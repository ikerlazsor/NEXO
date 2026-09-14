-- Una ida y vuelta para avatares + cupo del feed autenticado.
-- No se concede a anon (el invitado ya usa get_guest_feed).

create or replace function public.get_feed_plan_people(p_plan_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_ids uuid[];
    result jsonb;
begin
    if v_uid is null then
        return '[]'::jsonb;
    end if;

    select coalesce(array_agg(distinct plan_id), '{}'::uuid[])
    into v_ids
    from (
        select x as plan_id
        from unnest(coalesce(p_plan_ids, '{}'::uuid[])) as x
        where x is not null
        limit 200
    ) as limited;

    if v_ids is null or array_length(v_ids, 1) is null then
        return '[]'::jsonb;
    end if;

    select coalesce(jsonb_agg(feed.row_json), '[]'::jsonb)
    into result
    from (
        select jsonb_build_object(
            'plan_id', pl.id,
            'joinedCount', (
                select count(*)::integer
                from public.participantes as part
                where part.plan_id = pl.id
                  and part.estado = 'aceptado'
                  and (
                      coalesce(creator.es_organizador, false) = false
                      or part.usuario_id <> pl.creador_id
                  )
            ),
            'es_organizador', coalesce(creator.es_organizador, false),
            'host', jsonb_build_object(
                'id', creator.id,
                'nombre', creator.nombre,
                'nombre_usuario', creator.nombre_usuario,
                'avatar_url', creator.avatar_url,
                'genero', creator.genero,
                'es_organizador', creator.es_organizador,
                'isCreator', true
            ),
            'participantsList', (
                select coalesce(jsonb_agg(cards.card order by cards.ord, cards.nombre), '[]'::jsonb)
                from (
                    select inner_cards.ord, inner_cards.nombre, inner_cards.card
                    from (
                        select
                            0 as ord,
                            c.nombre,
                            jsonb_build_object(
                                'id', c.id,
                                'nombre', c.nombre,
                                'nombre_usuario', c.nombre_usuario,
                                'avatar_url', c.avatar_url,
                                'genero', c.genero,
                                'es_organizador', c.es_organizador,
                                'isCreator', true
                            ) as card
                        from public.perfiles as c
                        where c.id = pl.creador_id
                          and coalesce(c.baneado, false) = false
                          and coalesce(c.es_organizador, false) = false
                        union all
                        select
                            1,
                            p.nombre,
                            jsonb_build_object(
                                'id', p.id,
                                'nombre', p.nombre,
                                'nombre_usuario', p.nombre_usuario,
                                'avatar_url', p.avatar_url,
                                'genero', p.genero,
                                'es_organizador', p.es_organizador,
                                'isCreator', false
                            )
                        from public.participantes as part
                        join public.perfiles as p on p.id = part.usuario_id
                        where part.plan_id = pl.id
                          and part.estado = 'aceptado'
                          and part.usuario_id <> pl.creador_id
                          and coalesce(p.baneado, false) = false
                    ) as inner_cards
                    order by inner_cards.ord, inner_cards.nombre
                    limit 8
                ) as cards
            )
        ) as row_json
        from public.planes as pl
        join public.perfiles as creator on creator.id = pl.creador_id
        where pl.id = any (v_ids)
          and (
              pl.creador_id = v_uid
              or public.user_can_view_plan(pl.id, v_uid)
          )
    ) as feed;

    return coalesce(result, '[]'::jsonb);
end;
$$;

revoke all on function public.get_feed_plan_people(uuid[]) from public;
grant execute on function public.get_feed_plan_people(uuid[]) to authenticated, service_role;
