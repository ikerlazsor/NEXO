-- Permite fecha_evento null (p. ej. torneos «por determinar»).
alter table public.planes alter column fecha_evento drop not null;
