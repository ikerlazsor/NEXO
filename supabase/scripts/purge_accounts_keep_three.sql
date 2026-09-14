-- Purge all accounts except Iker, Izaskun and Lauri (Lau).
do $$
declare
  r record;
  actor uuid := 'f998337e-0049-4742-a3a4-36f6a8b509c0';
  keep uuid[] := array[
    'f998337e-0049-4742-a3a4-36f6a8b509c0'::uuid,
    'a04882bb-d3b6-4661-a47c-ca90c6940924'::uuid,
    'c10e1269-7e9b-426f-84e6-aac4d8f4a2ab'::uuid
  ];
  deleted_count int := 0;
  failed_count int := 0;
begin
  for r in
    select u.id
    from auth.users as u
    where u.id <> all (keep)
  loop
    begin
      perform public.service_delete_account(r.id, actor);
      deleted_count := deleted_count + 1;
    exception when others then
      failed_count := failed_count + 1;
      raise notice 'delete_failed %: %', r.id, sqlerrm;
    end;
  end loop;

  -- Perfiles huérfanos sin auth.users
  delete from public.perfiles where id <> all (keep);

  raise notice 'purge_done deleted=% failed=% remaining=%',
    deleted_count,
    failed_count,
    (select count(*) from public.perfiles);
end $$;
