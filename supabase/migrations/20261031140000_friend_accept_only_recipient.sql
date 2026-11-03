-- Solo quien recibe la solicitud puede aceptarla.
-- El emisor no puede marcarse amigo él mismo vía update.

create or replace function public.guard_amistad_accept()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return new;
  end if;

  if new.usuario_origen_id is distinct from old.usuario_origen_id
     or new.usuario_destino_id is distinct from old.usuario_destino_id then
    raise exception 'friendship_parties_immutable' using errcode = 'P0001';
  end if;

  if new.estado = 'aceptado' and old.estado is distinct from 'aceptado' then
    if uid is distinct from old.usuario_destino_id then
      raise exception 'only_recipient_can_accept' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_amistad_accept on public.amistades;
create trigger trg_guard_amistad_accept
before update of estado, usuario_origen_id, usuario_destino_id
on public.amistades
for each row
execute function public.guard_amistad_accept();
