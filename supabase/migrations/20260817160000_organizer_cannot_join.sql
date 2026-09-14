begin;

-- Cuentas organizador: solo publican, no asisten a planes de otros.
delete from public.participantes p
using public.perfiles pf
where p.usuario_id = pf.id
  and pf.es_organizador;

delete from public.invitaciones_planes i
using public.perfiles pf
where i.invitado_id = pf.id
  and pf.es_organizador
  and i.estado = 'pendiente';

create or replace function public.reject_organizer_as_attendee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if exists (
        select 1 from public.perfiles
        where id = new.usuario_id and es_organizador
    ) then
        raise exception 'organizer_cannot_join';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_reject_organizer_as_attendee on public.participantes;
create trigger trg_reject_organizer_as_attendee
before insert on public.participantes
for each row execute function public.reject_organizer_as_attendee();

create or replace function public.reject_organizer_plan_invite()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if exists (
        select 1 from public.perfiles
        where id = new.invitado_id and es_organizador
    ) then
        raise exception 'organizer_cannot_join';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_reject_organizer_plan_invite on public.invitaciones_planes;
create trigger trg_reject_organizer_plan_invite
before insert on public.invitaciones_planes
for each row execute function public.reject_organizer_plan_invite();

create or replace function public.organizer_leave_all_plans()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.es_organizador is true
       and coalesce(old.es_organizador, false) is distinct from true then
        delete from public.participantes where usuario_id = new.id;
        delete from public.invitaciones_planes
        where invitado_id = new.id and estado = 'pendiente';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_organizer_leave_all_plans on public.perfiles;
create trigger trg_organizer_leave_all_plans
after update of es_organizador on public.perfiles
for each row execute function public.organizer_leave_all_plans();

notify pgrst, 'reload schema';

commit;
