begin;

-- `estado` es tipo_estado_participante en participantes (incluye 'lista_espera')
-- y tipo_estado_amistad en invitaciones_planes (no lo incluye). Comparar con el
-- literal hacía que Postgres rechazase toda escritura en invitaciones_planes con
-- "invalid input value for enum tipo_estado_amistad: lista_espera", así que
-- ninguna invitación se podía crear. Se compara como texto.

create or replace function public.enforce_plan_not_ended()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_fecha timestamptz;
    v_cat text;
begin
    -- Permitir rechazos / cancelaciones aunque el plan ya haya terminado
    if tg_op = 'UPDATE'
       and new.estado::text not in ('pendiente', 'aceptado', 'lista_espera') then
        return new;
    end if;

    select fecha_evento, categoria into v_fecha, v_cat
    from public.planes
    where id = new.plan_id;

    if v_cat in ('Grupo', 'Chat') then
        return new;
    end if;

    if v_fecha is not null and v_fecha <= now() then
        raise exception 'plan_ended'
            using errcode = 'P0001',
                  detail = format('plan %s already ended at %s', new.plan_id, v_fecha);
    end if;

    return new;
end;
$$;

commit;
