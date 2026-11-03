-- Ubicación manual: marcar para que el auto-GPS no la pise nunca.
-- Actualiza set_perfil_ubicacion_manual y endurece set_perfil_ubicacion (solo vacío + no manual).

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
    next_gustos := next_gustos - 'ubicacion_manual';
  else
    next_gustos := next_gustos || jsonb_build_object(
      'ubicacion',
      jsonb_build_object(
        'ciudad', left(ciudad, 48),
        'pais', left(coalesce(pais, ''), 48)
      ),
      'ubicacion_manual', true
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

create or replace function public.set_perfil_ubicacion(p_ciudad text, p_pais text)
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
  if ciudad is null then
    return;
  end if;

  select coalesce(perfil_gustos, '{}'::jsonb) into next_gustos
  from public.perfiles
  where id = uid
  for update;

  if next_gustos is null then
    return;
  end if;

  -- Nunca pisar una ubicación elegida a mano.
  if coalesce((next_gustos->>'ubicacion_manual')::boolean, false) then
    return;
  end if;

  -- No pisar si ya hay ciudad
  if nullif(btrim(coalesce(next_gustos #>> '{ubicacion,ciudad}', '')), '') is not null then
    return;
  end if;

  next_gustos := next_gustos || jsonb_build_object(
    'ubicacion', jsonb_build_object('ciudad', left(ciudad, 48), 'pais', left(coalesce(pais, ''), 48))
  );
  next_gustos := jsonb_set(
    next_gustos,
    '{privacidad}',
    coalesce(next_gustos->'privacidad', '{}'::jsonb) || jsonb_build_object('mostrar_ubicacion', true),
    true
  );

  update public.perfiles
  set perfil_gustos = next_gustos
  where id = uid;
end;
$$;
