-- Ubicación editable por el usuario (pisa ciudad anterior; no toca nacionalidad ni el resto).
-- Distinto de set_perfil_ubicacion, que solo rellena si estaba vacío (auto-GPS).

create or replace function public.set_perfil_ubicacion_manual(
  p_ciudad text,
  p_pais text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  next_gustos jsonb;
  ciudad text := nullif(btrim(coalesce(p_ciudad, '')), '');
  pais text := nullif(btrim(coalesce(p_pais, '')), '');
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select coalesce(perfil_gustos, '{}'::jsonb) into next_gustos
  from public.perfiles
  where id = uid
  for update;

  if next_gustos is null then
    return;
  end if;

  if ciudad is null then
    next_gustos := next_gustos - 'ubicacion';
  else
    next_gustos := next_gustos || jsonb_build_object(
      'ubicacion',
      jsonb_build_object(
        'ciudad', left(ciudad, 48),
        'pais', left(coalesce(pais, ''), 48)
      )
    );
    next_gustos := jsonb_set(
      next_gustos,
      '{privacidad}',
      coalesce(next_gustos->'privacidad', '{}'::jsonb)
        || jsonb_build_object('mostrar_ubicacion', true),
      true
    );
  end if;

  update public.perfiles
  set perfil_gustos = next_gustos
  where id = uid;
end;
$$;

revoke all on function public.set_perfil_ubicacion_manual(text, text) from public, anon;
grant execute on function public.set_perfil_ubicacion_manual(text, text) to authenticated;
grant execute on function public.set_perfil_ubicacion_manual(text, text) to service_role;
