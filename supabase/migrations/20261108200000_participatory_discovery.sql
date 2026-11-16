begin;
-- The same title rules run in the importer, client and SQL pagination.
create or replace function public.social_activity_title_is_eligible(p_title text) returns boolean
language sql immutable parallel safe set search_path=public,pg_temp as $$
 select name ~ '\y(senderismo|hiking|hike|trekking|excursion(?:es)?|ruta(?:s)? (?:guiada|de senderismo|de montana)|paseo(?:s)? (?:guiado|en grupo)|yoga|pilates|meditacion|intercambio(?:s)? (?:de idiomas|linguistico)|language exchange|language swap|intercambio de conversacion|club (?:de lectura|de conversacion)|book club|juegos? de mesa|board games?|ajedrez|chess|picnic|quedada(?:s)?|encuentro(?:s)? (?:para conocer|de nuevos|internacional)|meet(?:ing)? new people|newcomers?|make friends|speed friending|social (?:hike|walk|run|dinner)|running (?:social|en grupo)|run(?:ning)? club|grupo de running|taller(?:es)? (?:de )?(?:cocina|ceramica|pintura|acuarela|baile|salsa|bachata|fotografia|manualidades)|clase(?:s)? (?:de )?(?:yoga|pilates|baile|salsa|bachata)|cata(?:s)? (?:de |en grupo)|ruta(?:s)? de tapas|cena(?:s)? (?:en grupo|internacional|para conocer)|voluntariado(?: en grupo)?|partido(?:s)? (?:amistoso|de futbol|de baloncesto|de padel)|pachanga(?:s)?)\y' and name !~ '\y(infantil(?:es)?|ninos?|ninas?|bebes?|escolar(?:es)?|campamento|familias|familiar|mayores de 65|tercera edad|tramite|oposiciones|online|virtual|webinar)\y' and name !~ '\y(concierto(?:s)?|concert(?:s)?|recital(?:es)?|festival(?:es)?|opera|musical|espectaculo(?:s)?|proyeccion(?:es)?|cine|monologo(?:s)?|cartelera|estreno|exposicion(?:es)?|obra (?:de teatro|teatral)|teatro|circo|maraton|carrera popular|conferencia|congreso)\y'
 from (select translate(lower(coalesce(p_title,'')), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun') as name) normalized;
$$;
revoke all on function public.social_activity_title_is_eligible(text) from public;
grant execute on function public.social_activity_title_is_eligible(text) to authenticated,service_role;

create or replace function public.external_event_is_publishable(e public.external_events) returns boolean
language sql stable set search_path=public,pg_temp as $$
 select public.social_activity_title_is_eligible(e.title) and e.status='active' and e.social_eligible and e.location_verified
 and e.starts_at>now() and e.starts_at<=now()+interval '3 months'
 and nullif(trim(e.venue),'') is not null
 and trim(e.venue) !~* '^(madrid|comunidad de madrid|varios( espacios| lugares)?|por confirmar|por determinar|ubicación pendiente|online|virtual|internet|sin confirmar)$'
 and e.latitude between 39.7 and 41.3 and e.longitude between -4.7 and -2.6;
$$;

-- Retain records, membership and chat; only remove unsuitable discovery rows.
update public.external_events set social_eligible=false where social_eligible and not public.social_activity_title_is_eligible(title);
commit;
