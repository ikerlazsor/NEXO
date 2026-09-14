begin;

-- Columnas de organizador/portada añadidas después del recorte de privilegios
-- de perfiles: sin esto, editar la página falla con permission denied.
grant select (es_organizador, organizador, cover_url) on table public.perfiles to authenticated;
grant update (organizador, cover_url) on table public.perfiles to authenticated;

create or replace function public.update_organizer_page(
    p_descripcion text default null,
    p_cover_url text default null,
    p_organizador jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
begin
    if uid is null then
        raise exception 'not_authenticated';
    end if;
    if not exists (
        select 1 from public.perfiles
        where id = uid and es_organizador and baneado is false
    ) then
        raise exception 'not_organizer';
    end if;

    update public.perfiles
    set descripcion = case
            when p_descripcion is null then descripcion
            else left(btrim(p_descripcion), 300)
        end,
        cover_url = case
            when p_cover_url is null then cover_url
            else nullif(btrim(p_cover_url), '')
        end,
        organizador = case
            when p_organizador is null then organizador
            else coalesce(organizador, '{}'::jsonb) || p_organizador
        end
    where id = uid;
end;
$$;

revoke all on function public.update_organizer_page(text, text, jsonb) from public;
grant execute on function public.update_organizer_page(text, text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
