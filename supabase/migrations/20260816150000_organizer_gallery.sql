begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'organizador-media',
    'organizador-media',
    true,
    41943040,
    '{image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime}'::text[]
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Organizer media public read" on storage.objects;
create policy "Organizer media public read"
on storage.objects for select
to public
using (bucket_id = 'organizador-media');

drop policy if exists "Organizer media insert own" on storage.objects;
create policy "Organizer media insert own"
on storage.objects for insert
to authenticated
with check (
    bucket_id = 'organizador-media'
    and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "Organizer media update own" on storage.objects;
create policy "Organizer media update own"
on storage.objects for update
to authenticated
using (
    bucket_id = 'organizador-media'
    and split_part(name, '/', 1) = auth.uid()::text
)
with check (
    bucket_id = 'organizador-media'
    and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "Organizer media delete own" on storage.objects;
create policy "Organizer media delete own"
on storage.objects for delete
to authenticated
using (
    bucket_id = 'organizador-media'
    and split_part(name, '/', 1) = auth.uid()::text
);

create or replace function public.update_organizer_gallery(p_galeria jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
    item jsonb;
    n int;
begin
    if uid is null then
        raise exception 'not_authenticated';
    end if;
    if not exists (
        select 1 from public.perfiles
        where id = uid and es_organizador and baneado is false
    ) then
        raise exception 'not_organizer';
    end if;
    if p_galeria is null or jsonb_typeof(p_galeria) <> 'array' then
        raise exception 'invalid_gallery';
    end if;
    n := jsonb_array_length(p_galeria);
    if n > 24 then
        raise exception 'gallery_too_long';
    end if;
    for item in select * from jsonb_array_elements(p_galeria)
    loop
        if jsonb_typeof(item) <> 'object'
            or coalesce(item->>'url', '') = ''
            or coalesce(item->>'kind', '') not in ('image', 'video')
        then
            raise exception 'invalid_gallery_item';
        end if;
    end loop;

    update public.perfiles
    set organizador = coalesce(organizador, '{}'::jsonb) || jsonb_build_object('galeria', p_galeria)
    where id = uid;
end;
$$;

revoke all on function public.update_organizer_gallery(jsonb) from public;
grant execute on function public.update_organizer_gallery(jsonb) to authenticated, service_role;

commit;
