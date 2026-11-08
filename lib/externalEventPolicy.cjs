"use strict";
const ZONE = "Europe/Madrid";
const SOCIAL =
  /\b(conciert|recital|teatr|cine|[oó]pera|circo|festival|deport|proyecci[oó]n|espect[aá]culo|mon[oó]logo|comedia|danza|baile|fiesta|dj\b|senderis|hiking|trekking|excursi[oó]n|ruta guiada|paseo guiado|visita guiada|running|carrera popular|f[uú]tbol|baloncesto|p[aá]del|yoga|pilates|picnic|juegos? de mesa|ajedrez|intercambio.*idiomas|club de lectura|taller.*(cocina|baile|idiomas|lectura)|cata\b|degustaci[oó]n|gastron[oó]m|tapas|meetup|networking|encuentro|quedada|social|board games|language exchange)/i;
const UNSUITABLE =
  /\b(infantil|niñ[oa]s|beb[eé]s|escolares|campamento|exposici[oó]n permanente|horario de apertura|tr[aá]mite|oposiciones)\b/i;

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
function isSocialActivity(title, description = "") {
  return !UNSUITABLE.test(title) && SOCIAL.test(`${title} ${description}`);
}
function isPublishableEvent(event, now = Date.now()) {
  const start = Date.parse(event.starts_at || "");
  return (
    event.status === "active" &&
    Number.isFinite(start) &&
    start > Number(now) &&
    start <= horizon(new Date(now)).getTime() &&
    hasConfirmedLocation(event) &&
    !UNSUITABLE.test(event.title) &&
    event.social_eligible !== false &&
    (event.social_eligible === true ||
      isSocialActivity(event.title, event.description || ""))
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
  calendarDay,
  horizon,
  madridInstant,
  confirmedStart,
  hasConfirmedLocation,
  isSocialActivity,
  isPublishableEvent,
  identityTitle,
};
