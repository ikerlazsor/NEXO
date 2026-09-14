-- Permitir formato de alineación "2v2" (pádel).

begin;

create or replace function public.set_plan_alineacion(p_plan_id uuid, p_alineacion jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_max integer;
    v_fmt text;
    v_n integer;
begin
    if auth.uid() is null then
        raise exception 'not_authenticated';
    end if;
    select maximo_participantes into v_max
    from public.planes
    where id = p_plan_id and creador_id = auth.uid();
    if v_max is null then
        raise exception 'not_creator';
    end if;

    v_fmt := p_alineacion->>'formato';
    if v_fmt not in ('2v2', '5v5', '6v6', '7v7', '8v8', '9v9', '10v10', '11v11', 'sala') then
        raise exception 'bad_format';
    end if;
    if v_fmt = 'sala' then
        v_n := 5;
    else
        v_n := split_part(v_fmt, 'v', 1)::integer;
    end if;
    if v_max < v_n * 2 then
        raise exception 'format_too_big';
    end if;

    update public.planes
    set alineacion = p_alineacion, actualizado_en = now()
    where id = p_plan_id;

    delete from public.alineaciones
    where plan_id = p_plan_id
      and posicion >= v_n;
end;
$$;

notify pgrst, 'reload schema';

commit;
