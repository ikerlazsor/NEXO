-- Aviso al fundador (rol 'owner') cada vez que alguien completa el registro.
-- Solo servidor: envía directamente a Expo con pg_net a los tokens del owner.
create or replace function public.notify_owner_new_signup()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  total integer;
  tok record;
  nombre_corto text;
begin
  if new.rol = 'owner' or coalesce(new.baneado, false) then
    return new;
  end if;

  begin
    select count(*) into total
    from public.perfiles
    where registro_completado and not coalesce(baneado, false);

    nombre_corto := nullif(split_part(trim(coalesce(new.nombre, '')), ' ', 1), '');

    for tok in
      select pt.token
      from public.push_tokens pt
      join public.perfiles p on p.id = pt.user_id
      where p.rol = 'owner'
    loop
      perform net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Accept', 'application/json'
        ),
        body := jsonb_build_object(
          'to', tok.token,
          'title', '¡Ya sois ' || total || ' en Nexo! 🔥',
          'body', coalesce(nombre_corto, 'Alguien') || ' acaba de registrarse',
          'sound', 'default',
          'channelId', 'social',
          'priority', 'high',
          'data', jsonb_build_object('type', 'founder_new_user')
        )
      );
    end loop;
  exception when others then
    -- Nunca bloquear un registro por el aviso.
    raise warning 'notify_owner_new_signup: %', sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.notify_owner_new_signup() from public, anon, authenticated;

drop trigger if exists trg_notify_owner_signup_update on public.perfiles;
create trigger trg_notify_owner_signup_update
  after update of registro_completado on public.perfiles
  for each row
  when (new.registro_completado and not coalesce(old.registro_completado, false))
  execute function public.notify_owner_new_signup();

drop trigger if exists trg_notify_owner_signup_insert on public.perfiles;
create trigger trg_notify_owner_signup_insert
  after insert on public.perfiles
  for each row
  when (new.registro_completado)
  execute function public.notify_owner_new_signup();
