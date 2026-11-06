#!/usr/bin/env node
'use strict';

/**
 * Read-only prototype for Madrid's municipal open-data event feeds.
 * Produces candidate cards on stdout; NEVER connects to Supabase or publishes.
 *
 * Usage: node scripts/madrid-events-preview.cjs path/to/ayuntamiento.json
 */
const fs = require('node:fs');

const SOURCE = 'Ayuntamiento de Madrid';
const DATASET_URL = 'https://datos.madrid.es/dataset/206974-0-agenda-eventos-culturales-100';

function text(value, max = 300) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function field(row, keys) {
  for (const key of keys) {
    if (row[key] !== null && row[key] !== undefined && row[key] !== '') return row[key];
  }
  return null;
}

function httpsLink(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function readRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload['@graph'])) return payload['@graph'];
    if (Array.isArray(payload.records)) return payload.records;
    if (Array.isArray(payload.data)) return payload.data;
  }
  throw new Error('Formato desconocido: se esperaba una lista o un objeto con @graph/data/records.');
}

function normalizeMadridEvents(payload, now = new Date()) {
  const rows = readRows(payload);
  const seen = new Set();
  const candidates = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const title = text(field(row, ['title', 'TITLE', 'titulo', 'TITULO']), 180);
    const rawId = field(row, ['id', '@id', 'ID-EVENTO', 'id-evento']);
    const id = rawId == null ? '' : String(rawId).trim();
    const startRaw = field(row, ['dtstart', 'DTSTART', 'fecha-inicio', 'fecha_inicio']);
    const startDate = typeof startRaw === 'string' ? new Date(startRaw) : null;
    const sourceUrl = httpsLink(field(row, ['link', 'LINK', 'CONTENT-URL', 'content-url', 'url']));
    if (!title || !id || !startDate || !Number.isFinite(startDate.getTime()) || startDate < now || !sourceUrl) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const place = field(row, ['event-location', 'EVENT-LOCATION', 'location', 'LOCALIZACION']);
    const venue = typeof place === 'string' ? text(place, 180) : text(place?.['location-name'] || place?.name, 180);
    candidates.push({
      source: SOURCE,
      sourceDataset: DATASET_URL,
      sourceId: id,
      title,
      startsAt: startDate.toISOString(),
      venue: venue || null,
      description: text(field(row, ['description', 'DESCRIPTION', 'descripcion']), 800) || null,
      sourceUrl,
      registrationMode: 'external',
      inAppJoinEnabled: false,
      organizerVerifiedByNexo: false,
    });
  }
  return candidates.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node scripts/madrid-events-preview.cjs <archivo-json>');
    process.exitCode = 2;
  } else {
    try {
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      const result = normalizeMadridEvents(payload);
      process.stdout.write(JSON.stringify({ total: result.length, events: result }, null, 2) + '\n');
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

module.exports = { normalizeMadridEvents, readRows };
