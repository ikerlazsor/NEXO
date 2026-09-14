begin;

-- El anfitrión puede añadir miembros al crear un grupo de chat
-- (antes solo se podía insertar a uno mismo → RLS al invitar amigos).

drop policy if exists participantes_insert_own on public.participantes;
drop policy if exists participantes_insert_self_or_host on public.participantes;

create policy participantes_insert_self_or_host
on public.participantes
as permissive
for insert
to authenticated
with check (
    usuario_id = auth.uid()
    or exists (
        select 1
        from public.planes p
        where p.id = plan_id
          and p.creador_id = auth.uid()
    )
);

notify pgrst, 'reload schema';

commit;
