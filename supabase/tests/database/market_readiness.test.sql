begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
    'reader@nexo.test', 'not-used', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"nombre":"Reader"}'::jsonb, now(), now()
  ),
  (
    '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
    'private@nexo.test', 'not-used', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"nombre":"Private","nombre_usuario":"private_test"}'::jsonb, now(), now()
  );

update public.perfiles
set nombre_usuario = case
      when id = '10000000-0000-0000-0000-000000000001' then 'reader_test'
      else nombre_usuario
    end,
    fecha_nacimiento = date '1995-04-10',
    genero = 'no_binario',
    etiquetas = array['cine', 'running'],
    ambientes_preferidos = array['tranquilo'],
    habitos_consumo = '{"bebida":"ocasional","tabaco":"nunca"}'::jsonb,
    perfil_gustos = case
      when id = '20000000-0000-0000-0000-000000000002' then
        '{"privacidad":{"mostrar_edad":false,"mostrar_genero":false,"mostrar_bebida":false,"mostrar_tabaco":false,"mostrar_aficiones":false}}'::jsonb
      else '{}'::jsonb
    end
where id in (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002'
);

insert into public.mensajes (
  id, emisor_id, receptor_id, contenido, tipo
) values
  (
    '30000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'mensaje denunciable',
    'texto'
  ),
  (
    '40000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    'mensaje propio',
    'video'
  );

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select ok(
  public.is_username_taken_public('private_test'),
  'signed-out registration detects a used public username'
);

select ok(
  public.is_username_taken_public('invalid space'),
  'signed-out username validation fails closed for invalid handles'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select is(
  (select edad from public.get_public_profiles(array['20000000-0000-0000-0000-000000000002'::uuid])),
  null::integer,
  'a hidden birth date is exposed neither directly nor as age'
);

select is(
  (select genero from public.get_public_profiles(array['20000000-0000-0000-0000-000000000002'::uuid])),
  null::public.tipo_genero,
  'a hidden gender is redacted by the public profile RPC'
);

select is(
  (select etiquetas from public.get_public_profiles(array['20000000-0000-0000-0000-000000000002'::uuid])),
  '{}'::text[],
  'hidden hobbies are redacted by the public profile RPC'
);

select is(
  (select habitos_consumo->'bebida' from public.get_public_profiles(array['20000000-0000-0000-0000-000000000002'::uuid])),
  '"no_especificado"'::jsonb,
  'hidden consumption habits are redacted by the public profile RPC'
);

select is(
  (select fecha_nacimiento from public.get_my_profile()),
  date '1995-04-10',
  'the own-profile RPC still returns the account holder private fields'
);

select isnt(
  public.report_message(
    '30000000-0000-0000-0000-000000000003',
    'acoso',
    'prueba de moderación'
  ),
  null::uuid,
  'a recipient can report a message they received'
);

reset role;
select is(
  (
    select contenido_snapshot
    from public.reportes_mensajes
    where mensaje_id = '30000000-0000-0000-0000-000000000003'
      and reportador_id = '10000000-0000-0000-0000-000000000001'
  ),
  'mensaje denunciable'::text,
  'message reports preserve an immutable moderation snapshot'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select throws_ok(
  $$
    select public.report_message(
      '40000000-0000-0000-0000-000000000004',
      'spam',
      null
    )
  $$,
  'P0001',
  'message_not_found_or_forbidden',
  'users cannot report their own messages'
);

reset role;
insert into public.bloqueos (bloqueador_id, bloqueado_id)
values (
  '20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select is(
  (
    select count(*)::bigint
    from public.get_public_profiles(array['20000000-0000-0000-0000-000000000002'::uuid])
  ),
  0::bigint,
  'blocked profiles are excluded from the public profile RPC'
);

select is(
  (
    select count(*)::bigint
    from public.perfiles
    where id = '20000000-0000-0000-0000-000000000002'
  ),
  0::bigint,
  'blocked identities are also excluded from direct safe-column reads'
);

select * from finish();

rollback;
