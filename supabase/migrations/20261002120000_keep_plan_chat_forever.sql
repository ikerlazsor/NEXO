-- El creador puede convertir el chat de un plan ya terminado en un grupo
-- permanente. Se quedan los mismos integrantes y los mensajes. El plan deja
-- de estar en el feed y el chat ya no se borra a las 48 h.

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
           chat_eliminado_en = null
     where id = p_plan_id;
end;
$$;

revoke all on function public.keep_plan_chat_forever(uuid) from public, anon;
grant execute on function public.keep_plan_chat_forever(uuid) to authenticated;
