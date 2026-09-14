begin;

-- La portada de organizador debe verse en perfiles ajenos aunque
-- solo esté en organizador.portada o perfil_gustos.cover_url.

drop function if exists public.get_public_profiles(uuid[]);

create function public.get_public_profiles(p_user_ids uuid[])
returns table (
    id uuid,
    nombre text,
    nombre_usuario text,
    avatar_url text,
    cover_url text,
    descripcion text,
    etiquetas text[],
    edad integer,
    genero public.tipo_genero,
    habitos_consumo jsonb,
    ambientes_preferidos text[],
    perfil_gustos jsonb,
    es_organizador boolean,
    organizador jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    requester uuid := auth.uid();
begin
    if requester is null then
        raise exception 'not_authenticated';
    end if;
    if not public.is_requesting_user_active() then
        raise exception 'account_banned';
    end if;
    if p_user_ids is null or cardinality(p_user_ids) = 0 then
        return;
    end if;
    if cardinality(p_user_ids) > 200 then
        raise exception 'too_many_profiles';
    end if;

    return query
    select
        p.id,
        p.nombre,
        p.nombre_usuario,
        p.avatar_url,
        coalesce(
            nullif(btrim(coalesce(p.cover_url, '')), ''),
            nullif(btrim(coalesce(p.organizador->>'portada', '')), ''),
            nullif(btrim(coalesce(p.perfil_gustos->>'cover_url', '')), '')
        ) as cover_url,
        p.descripcion,
        case
            when p.es_organizador then '{}'::text[]
            when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_aficiones}')::boolean, true)
                then coalesce(p.etiquetas, '{}'::text[])
            else '{}'::text[]
        end as etiquetas,
        case
            when p.es_organizador then null
            when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_edad}')::boolean, true)
                 and p.fecha_nacimiento is not null
                then extract(year from age(current_date, p.fecha_nacimiento))::integer
            else null
        end as edad,
        case
            when p.es_organizador then null
            when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_genero}')::boolean, true)
                then p.genero
            else null
        end as genero,
        case
            when p.es_organizador then '{}'::jsonb
            else jsonb_build_object(
                'bebida', case
                    when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_bebida}')::boolean, true)
                        then coalesce(p.habitos_consumo->'bebida', '"no_especificado"'::jsonb)
                    else '"no_especificado"'::jsonb
                end,
                'tabaco', case
                    when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_tabaco}')::boolean, true)
                        then coalesce(p.habitos_consumo->'tabaco', '"no_especificado"'::jsonb)
                    else '"no_especificado"'::jsonb
                end
            )
        end as habitos_consumo,
        case
            when p.es_organizador then '{}'::text[]
            when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_aficiones}')::boolean, true)
                then coalesce(p.ambientes_preferidos, '{}'::text[])
            else '{}'::text[]
        end as ambientes_preferidos,
        jsonb_build_object(
            'privacidad', jsonb_build_object(
                'mostrar_edad', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_edad}')::boolean, true),
                'mostrar_genero', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_genero}')::boolean, true),
                'mostrar_bebida', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_bebida}')::boolean, true),
                'mostrar_tabaco', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_tabaco}')::boolean, true),
                'mostrar_aficiones', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_aficiones}')::boolean, true)
            ),
            'cover_url', coalesce(
                nullif(btrim(coalesce(p.cover_url, '')), ''),
                nullif(btrim(coalesce(p.organizador->>'portada', '')), ''),
                nullif(btrim(coalesce(p.perfil_gustos->>'cover_url', '')), '')
            )
        ) as perfil_gustos,
        p.es_organizador,
        case when p.es_organizador then coalesce(p.organizador, '{}'::jsonb) else '{}'::jsonb end
    from public.perfiles as p
    where p.id = any(p_user_ids)
      and public.can_view_profile_identity(p.id);
end;
$$;

revoke all on function public.get_public_profiles(uuid[]) from public;
grant execute on function public.get_public_profiles(uuid[]) to authenticated, service_role;

commit;
