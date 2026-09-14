begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '50000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
    'guestfeed@nexo.test', 'not-used', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"nombre":"Host"}'::jsonb, now(), now()
  );

update public.perfiles
set nombre = 'Host',
    nombre_usuario = 'guest_host',
    baneado = false
where id = '50000000-0000-0000-0000-000000000005';

insert into public.planes (
  id, creador_id, titulo, categoria, descripcion, nombre_ubicacion,
  latitud, longitud, fecha_evento, maximo_participantes,
  modo_privado, solo_amigos, estado
) values
  (
    '51000000-0000-0000-0000-000000000015',
    '50000000-0000-0000-0000-000000000005',
    'Plan público',
    'DEPORTES',
    'Visible para invitados',
    'Madrid',
    40.4, -3.7,
    now() + interval '2 days',
    8,
    false, false, 'abierto'
  ),
  (
    '52000000-0000-0000-0000-000000000025',
    '50000000-0000-0000-0000-000000000005',
    'Plan privado',
    'DEPORTES',
    'Oculto para invitados',
    'Madrid',
    40.4, -3.7,
    now() + interval '2 days',
    8,
    true, false, 'abierto'
  );

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select ok(
  public.get_guest_feed() @> jsonb_build_array(jsonb_build_object('id', '51000000-0000-0000-0000-000000000015')),
  'guest feed includes public upcoming plans'
);

select ok(
  not (public.get_guest_feed() @> jsonb_build_array(jsonb_build_object('id', '52000000-0000-0000-0000-000000000025'))),
  'guest feed hides private plans'
);

select isnt(
  public.get_guest_plan('51000000-0000-0000-0000-000000000015'),
  null,
  'guest can load a public plan detail'
);

select is(
  public.get_guest_plan('52000000-0000-0000-0000-000000000025'),
  null,
  'guest cannot load a private plan detail'
);

reset role;

select ok(
  (
    has_function_privilege('anon', 'public.get_guest_feed()', 'execute')
    or has_function_privilege('anon', 'public.get_guest_feed(double precision, double precision, integer)', 'execute')
  )
  and has_function_privilege('anon', 'public.get_guest_plan(uuid)', 'execute')
  and not has_table_privilege('anon', 'public.planes', 'select'),
  'guest access is limited to the reviewed public RPCs'
);

select * from finish();
rollback;
