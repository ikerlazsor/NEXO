-- Las cuentas organizador no ocupan posiciones en la alineación.

begin;

create or replace function public.claim_alineacion_slot(
    p_plan_id uuid,
    p_equipo smallint,
    p_posicion smallint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_fmt text;
    v_n integer;
    v_uid uuid := auth.uid();
begin
    if v_uid is null then
        raise exception 'not_authenticated';
    end if;
    if exists (
        select 1 from public.perfiles pe
        where pe.id = v_uid and pe.es_organizador is true
    ) then
        raise exception 'organizer_cannot_join';
    end if;
    if p_equipo not in (0, 1) or p_posicion < 0 then
        raise exception 'bad_slot';
    end if;

    select alineacion->>'formato' into v_fmt
    from public.planes
    where id = p_plan_id;
    if v_fmt is null then
        raise exception 'no_lineup';
    end if;
    v_n := split_part(v_fmt, 'v', 1)::integer;
    if p_posicion >= v_n then
        raise exception 'bad_slot';
    end if;

    if not exists (
        select 1 from public.planes pl
        where pl.id = p_plan_id and pl.creador_id = v_uid
    ) and not exists (
        select 1 from public.participantes pa
        where pa.plan_id = p_plan_id
          and pa.usuario_id = v_uid
          and pa.estado = 'aceptado'
    ) then
        raise exception 'not_member';
    end if;

    delete from public.alineaciones
    where plan_id = p_plan_id and usuario_id = v_uid;

    insert into public.alineaciones (plan_id, equipo, posicion, usuario_id)
    values (p_plan_id, p_equipo, p_posicion, v_uid);
end;
$$;

notify pgrst, 'reload schema';

commit;
