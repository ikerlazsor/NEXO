# Supabase security audit

Audit date: 2026-08-11  
Project: `Nexo` (`nixeproyzxvqzyrvsxcx`, eu-west-1, PostgreSQL 17)

## Scope and method

This audit queried PostgreSQL and Supabase system catalogs in read-only mode.
It did not export application rows, Auth users, message bodies, object names,
secrets, or file contents.

The baseline migration contains the deployed public schema, enum types,
functions, constraints, indexes, triggers, RLS state, policies, grants, Storage
bucket configuration and Realtime publication membership. The generated
TypeScript types are a second machine-readable snapshot.

## Production findings before remediation

| Control | Verified production state |
|---|---:|
| Public application tables | 26 |
| Tables with RLS enabled | 26/26 |
| Public functions | 87 |
| `SECURITY DEFINER` functions | 79 |
| Privileged functions executable by `anon` | 66 |
| Public + Storage policies | 124 |
| Storage policies | 17 |
| Storage buckets | 3 |
| Recorded migrations | 0 |

RLS being enabled everywhere is a useful base, but it is not sufficient by
itself. Table grants determine whether a role can reach the API at all, policies
determine which rows it can reach, and function grants can bypass both when a
`SECURITY DEFINER` function is callable.

The deployed schema used legacy blanket table grants for `anon` and
`authenticated`. Most anonymous operations were denied by policy because
`auth.uid()` was null, but that is unnecessary exposure and makes future
policy mistakes more dangerous.

## Table-by-table review

| Table | Policies | Result |
|---|---:|---|
| `ai_search_usage` | 1 | Internal quota table; no client table grant. |
| `amistades` | 5 | Rows limited to the two users; active-user restriction is RESTRICTIVE. |
| `analytics_events` | 3 | Authenticated event writes; administrative reads only. |
| `bloqueos` | 4 | A user manages only blocks they created. |
| `chats_directos_ocultos` | 5 | Scoped to the owning user. |
| `estadisticas_usuario` | 3 | Public-profile statistics are readable; writes are trigger/RPC controlled. |
| `expulsiones_plan` | 3 | Host/member rules captured in the baseline. |
| `historial_planes` | 3 | User history is scoped to its owner. |
| `invitaciones_planes` | 5 | Inviter/invitee access captured. |
| `mensaje_reacciones` | 5 | Access follows message/chat membership. |
| `mensajes` | 4 | Direct messages require sender/receiver; plan messages require host or accepted membership. |
| `mensajes_soporte` | 5 | Users see their tickets; staff-only fields are trigger protected. |
| `participantes` | 6 | Finding fixed: the previous `SELECT true` exposed membership rows for invisible plans. |
| `perfiles` | 8 | Row access is authenticated-wide by design; see the column-privacy limitation below. |
| `plan_invitaciones` | 3 | Duplicate invitation model retained and baselined; consolidation is recommended. |
| `planes` | 6 | Visibility helper enforces public/friends/private rules and blocking. |
| `planes_guardados` | 5 | Scoped to the owning user. |
| `push_chat_mutes` | 4 | Scoped to the owning user. |
| `push_dispatch_usage` | 1 | Service-only quota table. |
| `push_message_deliveries` | 1 | Service-only delivery ledger. |
| `push_message_dispatches` | 1 | Service-only idempotency ledger. |
| `push_notification_outbox` | 1 | Service-only outbox. |
| `push_tokens` | 5 | Users manage only their own tokens. |
| `reportes_planes` | 6 | Reporter owns submission; moderation access uses staff checks. |
| `reportes_usuarios` | 6 | Reporter owns submission; moderation access uses staff checks. |
| `valoraciones` | 8 | Evaluator/evaluated/plan rules and validation triggers captured. |

## Storage review

| Bucket | Public | Finding and remediation |
|---|---:|---|
| `avatars` | Yes | Public read is intentional. Broad authenticated overwrite is replaced with owner/plan-creator checks. |
| `imagenes-planes` | Yes | Public read is intentional. Insert/update now require object ownership. |
| `chat-files` | No | Public and authenticated-wide reads are replaced with plan/direct-conversation membership checks derived from the existing file naming convention. |

Malformed Storage names fail closed. The migration does not rename, delete or
copy existing objects.

## Function review

The migration revokes `EXECUTE` on every public `SECURITY DEFINER` function
from `PUBLIC`, `anon`, and `authenticated`. It then:

- grants all privileged functions to `service_role`;
- grants `authenticated` only a reviewed list of client RPCs and RLS helpers;
- leaves triggers, statistics recalculation, archival, purge and push-dispatch
  functions unavailable as direct client APIs;
- keeps the existing internal authorization checks on administrative RPCs.

The database tests fail if an anonymous privileged function reappears or a
trigger function becomes client-callable.

## Remaining architectural limitation

RLS controls rows, not individual columns. `perfiles_select` intentionally
allows authenticated discovery of profile rows, while visibility preferences
for age, gender and habits are stored in the same row. A client can therefore
request columns that the UI chooses not to show.

That cannot be corrected safely by a policy-only migration without changing all
profile reads. The durable remediation is:

1. expose a public-profile view or RPC containing only always-public fields plus
   preference-filtered derived values;
2. keep private profile fields in an owner-only table;
3. migrate every client query to the public projection;
4. revoke direct authenticated `SELECT` on the private columns/table;
5. add role-based behavioral tests with two users.

Until that client migration is completed, the audit does **not** claim
column-level privacy for hidden profile attributes.

## Versioned migration workflow

- `20260811000100_production_schema_baseline.sql` is a schema-only snapshot of
  the pre-existing production database.
- `20260811000200_security_hardening.sql` contains the reviewed, data-preserving
  permission changes.
- `supabase/tests/database/security.test.sql` checks the security invariants on
  a clean local rebuild.
- Future changes must be created with `supabase migration new <name>` and must
  pass `supabase db reset` plus `supabase test db`.

Because production had no migration history, the baseline must be marked
`applied` before the hardening migration is pushed. Always inspect
`supabase db push --dry-run` first.

