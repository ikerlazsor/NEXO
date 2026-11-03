-- Soft-delete de mensajes (estilo WhatsApp): se conserva la fila, se limpia el contenido.

alter table public.mensajes
  add column if not exists eliminado_en timestamptz;

comment on column public.mensajes.eliminado_en is
  'Si no es null, el mensaje se muestra como «mensaje eliminado» para todos.';

create or replace function public.soft_delete_mensaje(p_mensaje_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  row_emisor uuid;
  already timestamptz;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select emisor_id, eliminado_en
    into row_emisor, already
  from public.mensajes
  where id = p_mensaje_id
  for update;

  if row_emisor is null then
    return;
  end if;

  if row_emisor <> uid then
    raise exception 'not_allowed';
  end if;

  if already is not null then
    return;
  end if;

  update public.mensajes
  set
    eliminado_en = now(),
    contenido = '@@nexo_deleted@@',
    archivo_url = null,
    tipo = 'texto'
  where id = p_mensaje_id;
end;
$$;

revoke all on function public.soft_delete_mensaje(uuid) from public, anon;
grant execute on function public.soft_delete_mensaje(uuid) to authenticated;
grant execute on function public.soft_delete_mensaje(uuid) to service_role;
