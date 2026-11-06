# Madrid events: read-only pilot (not deployed)

## Why this is separate from the Nexo plans table

Nexo plans are created by real users, have a creator, participants and in-app join/chat/approval
semantics. A municipal listing is **not** a user-created plan. Inserting scraped external listings
as though they were community plans would misrepresent who organizes them, potentially allow
users to "join" without registration at the real venue, and interfere with moderation and metrics.

Recommended UI: a separately labeled **Agenda de Madrid** section with source attribution,
the event date, venue, link to the organizer for registration, an explicit external-registration
label and no Nexo join button. Keep the genuine community feed visible.

## Verified starting source

- Ayuntamiento de Madrid, "Actividades culturales y de ocio municipal en los próximos 100 días":
  https://datos.madrid.es/dataset/206974-0-agenda-eventos-culturales-100
- Wider municipal agenda (may overlap or contain duplicates):
  https://datos.madrid.es/dataset/300107-0-agenda-actividades-eventos
- Both list machine-readable JSON/CSV/GeoJSON distributions. The publisher indicates daily
  updates, CC BY 4.0 attribution and possible requirements for registration on the linked
  original page. Datasets are not exhaustive.

## Prototype usage (local only)

Download the official JSON distribution manually, then:

```sh
node scripts/madrid-events-preview.cjs ./ayuntamiento.json > ./candidates.json
node --test tests/madridEvents*.test.cjs

# Or fetch the official JSON directly (internet access required):
node scripts/madrid-events-fetch.cjs > ./candidates.json
```

The script reads a local JSON file and prints a *candidate* list. It never writes to Supabase,
calls a remote API, creates users, or modifies the live app.

The source JSON schema must be checked against a real current download before enabling
automated ingestion; the prototype currently accepts common JSON list and `@graph` layouts.

## Before production

1. Confirm the current JSON field names and correct handling of Madrid time zone, all-day
   events, recurrence, amendments and cancellations. A single date in a municipal record
   may not imply an individually bookable session.
2. Use a separate, read-only `external_events` data model, not `public.planes`. Store
   source ID, provider, canonical URL, first/last seen dates and stale status; enforce a unique
   key per provider + upstream event ID.
3. First run a dry-run against a local Supabase database, and add integration tests covering
   cancellation, duplicate entries, date ranges, RLS and outbound links.
4. Filter unsuitable topics and stale entries; do not invent admission prices, available
   places, user hosts or direct registration in Nexo.
5. Schedule a daily ingestion job only after provider format and attribution are validated.
   Observe failures and use incremental upserts; flag missing items before hiding them.
6. Confirm copyright/license obligations for text and especially **images**, which may have
   different rights from the open-data listing. Attribute Ayuntamiento de Madrid (CC BY 4.0),
   include dataset/source links and a last-synced timestamp.
7. Set a clear expansion rule for other providers (Ticketmaster API, organizer feeds) and
   check each provider's API terms before importing.

**Operational status:** No deployment, no production writes, no scheduled synchronization,
and no in-app visibility in this PR.


## Implementation checkpoint — 2026-11-06

- Added a fetcher for the official Madrid JSON distribution. No database connection.
- Local-date timestamps lacking an explicit UTC offset are marked `timeUnverified`.
  They are NOT converted into invented hours.
- The current branch also fixes chronological feed pagination ties by using
  the (fecha_evento, id) ordering. Its implementation must be integration-tested
  against PostgREST before deployment.
- A connected execution environment could not retrieve the full municipal
  distribution in this session. Real-feed shape and counts are not yet validated.
- No CI result is currently asserted. No production deployment.
