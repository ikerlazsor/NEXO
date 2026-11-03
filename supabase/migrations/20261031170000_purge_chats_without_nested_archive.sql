-- purge_expired_plan_chats ya no relanza el archivo ni las otras purgas.
-- El cliente las llama aparte; anidarlas triplicaba el trabajo y bloqueaba el perfil.

create or replace function public.purge_expired_plan_chats()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    r record;
    n integer := 0;
begin
    for r in
        select id from public.planes
        where fecha_evento is not null
          and fecha_evento + interval '48 hours' <= now()
          and chat_eliminado_en is null
          and coalesce(categoria, '') not in ('Grupo', 'Chat')
    loop
        delete from public.mensajes where plan_id = r.id;
        delete from public.invitaciones_planes where plan_id = r.id;
        delete from public.planes_guardados where plan_id = r.id;
        update public.planes
        set chat_eliminado_en = now(),
            finalizado_en = coalesce(finalizado_en, now())
        where id = r.id;
        n := n + 1;
    end loop;
    return n;
end;
$$;
