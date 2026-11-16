"use strict";
const ZONE = "Europe/Madrid";
// Participation must be explicit in the title. "Social" in a concert's
// marketing copy is not evidence of a small-group activity.
const GROUP_ACTIVITY = /\b(senderismo|hiking|hike|trekking|excursion(?:es)?|ruta(?:s)? (?:guiada|de senderismo|de montana)|paseo(?:s)? (?:guiado|en grupo|ornitologico|botanico)|yoga|pilates|tai chi|taichi|meditacion|intercambio(?:s)? (?:de idiomas|linguistico)|language exchange|language swap|intercambio de conversacion|club (?:de lectura|de conversacion)|book club|juegos? de mesa|board games?|ajedrez|chess|picnic|quedada(?:s)?|encuentro(?:s)? (?:para conocer|de nuevos|internacional)|meet(?:ing)? new people|newcomers?|make friends|speed friending|social (?:hike|walk|run|dinner)|running (?:social|en grupo)|run(?:ning)? club|grupo de running|visita[- ]taller para (?:personas )?adult(?:os|as)|taller(?:es)? (?:de )?['" :]*(?:cocina|ceramica|pintura|acuarela|baile|salsa|bachata|fotografia|manualidades|collage|fanzine(?:itor)?|escritura creativa|lectura|rope flow|shadow box|crochet|costura|mecanica basica)|clase(?:s)? (?:de )?(?:yoga|pilates|baile|salsa|bachata)|cata(?:s)? (?:de |en grupo)|ruta(?:s)? de tapas|cena(?:s)? (?:en grupo|internacional|para conocer)|voluntariado(?: en grupo)?|partido(?:s)? (?:amistoso|de futbol|de baloncesto|de padel)|pachanga(?:s)?)\b/i;
const UNSUITABLE = /\b(infantil(?:es)?|ninos?|ninas?|bebes?|escolar(?:es)?|campamento|familias|familiar|mayores de 65|tercera edad|tramite|oposiciones|online|virtual|webinar)\b/i;
const SPECTATOR = /\b(concierto(?:s)?|concert(?:s)?|recital(?:es)?|festival(?:es)?|opera|musical|espectaculo(?:s)?|proyeccion(?:es)?|cine|monologo(?:s)?|cartelera|estreno|exposicion(?:es)?|obra (?:de teatro|teatral)|teatro|circo|maraton|carrera popular|conferencia|congreso)\b/i;
// Audience evidence comes from the description too. Incidental references to a
// teacher's childhood or family registration are not an age restriction.
const CHILD_AUDIENCE = /\b((?:publico|actividad|taller)(?:s)? (?:infantil|familiar)|(?:dirigid[oa]|destinad[oa]|orientad[oa])s? a:? (?:ninos|ninas|chicos|chicas|familias|menores)|para (?:ninos|ninas|familias con menores)|debe asistir solo un adulto por inscripcion|(?:de|entre) (?:[0-9]|1[0-7]) (?:a|y) (?:[0-9]|1[0-7]) anos)\b/i;
// "Ir juntos": planes de público adulto a los que la gente suele ir en grupo
// (conciertos, flamenco, monólogos, teatro, visitas y rutas guiadas, baile).
// Se publican como quedada para ir juntos; el ranking los coloca por afinidad.
const GO_TOGETHER = /\b(concierto(?:s)?|recital(?:es)?|flamenco|jazz|blues|swing|monologo(?:s)?|stand ?up|comedia|impro(?:visacion)? teatral|teatro|obra (?:de teatro|teatral)|musical|zarzuela|visita(?:s)? guiada(?:s)?|recorrido(?:s)? guiado(?:s)?|ruta(?:s)? guiada(?:s)?|itinerario(?:s)? guiado(?:s)?|masterclass|clase abierta|baile|danza|k-?pop|salida(?:s)? (?:medioambiental(?:es)?|al campo|en grupo|ornitologica)|cine ?forum|cineforum)\b/i;
// Más estricto que CHILD_AUDIENCE: en espectáculos, "todos los públicos" o
// "a partir de 4 años" indica función familiar, no un plan de adultos.
const FAMILY_SHOW = /\b(todos los publicos|publico (?:infantil|familiar)|para toda la familia|en familia|a partir de (?:[0-9]|1[0-3]) anos|edad recomendada:? (?:de )?(?:[0-9]|1[0-3])|de (?:[0-9]|1[0-3]) a (?:[0-9]|1[0-7]) anos|cuentacuentos|titeres|marionetas)\b/i;
// Charlas académicas y audiciones de alumnos no son un plan para ir con gente.
const NOT_A_PLAN = /\b(conferencia|mesa[- ]coloquio|mesa redonda|audicion(?:es)?|presentacion del libro|jornada(?:s)? tecnica(?:s)?)\b/i;
const GROUP_SUBCATEGORY = /^(senderismo|yoga|baile|running|idiomas|juegos)$/i;
function policyText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function calendarDay(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function horizon(now = new Date()) {
  const year = now.getUTCFullYear(),
    month = now.getUTCMonth();
  const last = new Date(Date.UTC(year, month + 4, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month + 3,
      Math.min(now.getUTCDate(), last),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ),
  );
}
/** Resolve a declared local clock; reject DST gaps and ambiguous repeated hours. */
function madridInstant(day, clock) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day || "") ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock || "")
  )
    return null;
  const wanted = `${day} ${clock}`;
  const candidates = [60, 120]
    .map(
      (offset) => new Date(Date.parse(`${day}T${clock}:00Z`) - offset * 60000),
    )
    .filter((date) => {
      if (!Number.isFinite(date.getTime())) return false;
      const p = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: ZONE,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })
          .formatToParts(date)
          .map((p) => [p.type, p.value]),
      );
      return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` === wanted;
    });
  return candidates.length === 1 ? candidates[0].toISOString() : null;
}
function confirmedStart(startRaw, endDay, declaredClock) {
  if (typeof startRaw !== "string") return null;
  // An explicit offset identifies an actual occurrence, including a DST fold.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(startRaw)) {
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(startRaw)) return null;
    const calendar = new Date(`${startRaw.slice(0, 10)}T12:00:00Z`);
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== startRaw.slice(0, 10)) return null;
    const date = new Date(startRaw);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const day = startRaw.slice(0, 10);
  if (endDay && endDay !== day) return null; // no invented daily sessions
  const clock =
    typeof declaredClock === "string" &&
    /^\s*(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:h\.?|horas?)?\s*$/i.test(declaredClock)
      ? declaredClock
          .trim()
          .match(/\d{1,2}:\d{2}/)[0]
          .padStart(5, "0")
      : startRaw.slice(11, 16) !== "00:00" &&
          /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(startRaw)
        ? startRaw.slice(11, 16)
        : null;
  return clock ? madridInstant(day, clock) : null;
}
function hasConfirmedLocation(event) {
  return (
    typeof event.venue === "string" &&
    !!event.venue.trim() &&
    !/^(?:madrid|comunidad de madrid|varios(?: espacios| lugares)?|por confirmar|por determinar|ubicaci[oó]n pendiente|online|virtual|internet|sin confirmar)$/i.test(
      event.venue.trim(),
    ) &&
    typeof event.latitude === "number" &&
    typeof event.longitude === "number" &&
    event.latitude >= 39.7 &&
    event.latitude <= 41.3 &&
    event.longitude >= -4.7 &&
    event.longitude <= -2.6
  );
}
function isSocialActivity(title, description = "", subcategory = "") {
  const name = policyText(title);
  const about = policyText(description);
  if (UNSUITABLE.test(name) || CHILD_AUDIENCE.test(about)) return false;
  // 1) Actividad participativa explícita en el título (o subcategoría de grupo).
  if (!SPECTATOR.test(name) && (GROUP_ACTIVITY.test(name) || GROUP_SUBCATEGORY.test(String(subcategory || "")))) return true;
  // 2) Plan para ir juntos, solo si nada indica función infantil o familiar.
  return GO_TOGETHER.test(name) && !NOT_A_PLAN.test(name) && !FAMILY_SHOW.test(name) && !FAMILY_SHOW.test(about);
}
function isPublishableEvent(event, now = Date.now()) {
  const start = Date.parse(event.starts_at || "");
  return (
    event.status === "active" &&
    Number.isFinite(start) &&
    start > Number(now) &&
    start <= horizon(new Date(now)).getTime() &&
    hasConfirmedLocation(event) &&
    event.social_eligible !== false &&
    isSocialActivity(event.title, event.description || "", event.subcategory || "")
  );
}
function identityTitle(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
module.exports = {
  SOCIAL_POLICY_PATTERNS: { group: GROUP_ACTIVITY.source, unsuitable: UNSUITABLE.source, spectator: SPECTATOR.source, childAudience: CHILD_AUDIENCE.source, goTogether: GO_TOGETHER.source, familyShow: FAMILY_SHOW.source },
  calendarDay,
  horizon,
  madridInstant,
  confirmedStart,
  hasConfirmedLocation,
  isSocialActivity,
  isPublishableEvent,
  identityTitle,
};
