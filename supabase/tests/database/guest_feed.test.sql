begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

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

insert into public.planes(id,creador_id,titulo,categoria,fecha_evento,maximo_participantes,solo_amigos,estado)
values
  ('53000000-0000-0000-0000-000000000035','50000000-0000-0000-0000-000000000005','Solo amigos','DEPORTES',now()+interval '2 days',8,true,'abierto'),
  ('54000000-0000-0000-0000-000000000045','50000000-0000-0000-0000-000000000005','Chat directo','Chat',now()+interval '2 days',8,false,'abierto'),
  ('55000000-0000-0000-0000-000000000055','50000000-0000-0000-0000-000000000005','Chat de grupo','Grupo',now()+interval '2 days',8,false,'abierto'),
  ('56000000-0000-0000-0000-000000000065','50000000-0000-0000-0000-000000000005','Cancelado','DEPORTES',now()+interval '2 days',8,false,'cancelado');

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

-- Contract established by 20261007150000: a UUID link grants read access to a
-- meetup, including private/friends-only plans. It never grants chat access.
select isnt(
  public.get_guest_plan('52000000-0000-0000-0000-000000000025'),
  null,
  'private meetup shared by UUID remains readable through its link'
);

select ok(not (public.get_guest_feed() @> jsonb_build_array(jsonb_build_object('id','53000000-0000-0000-0000-000000000035'))), 'friends-only meetup stays out of the guest feed');
select isnt(public.get_guest_plan('53000000-0000-0000-0000-000000000035'),null,'friends-only meetup shared by UUID remains readable');
select is(public.get_guest_plan('54000000-0000-0000-0000-000000000045'),null,'direct chat is never exposed by a shared UUID');
select is(public.get_guest_plan('55000000-0000-0000-0000-000000000055'),null,'group chat is never exposed by a shared UUID');
select is(public.get_guest_plan('56000000-0000-0000-0000-000000000065'),null,'cancelled meetup is not exposed by a shared UUID');

reset role;

select ok(
  (
    has_function_privilege('anon', 'public.get_guest_feed(double precision, double precision, integer)', 'execute')
    or has_function_privilege('anon', 'public.get_guest_feed(double precision, double precision, integer)', 'execute')
  )
  and has_function_privilege('anon', 'public.get_guest_plan(uuid)', 'execute')
  and not has_table_privilege('anon', 'public.planes', 'select'),
  'guest access is limited to the reviewed public RPCs'
);

select * from finish();
rollback;
