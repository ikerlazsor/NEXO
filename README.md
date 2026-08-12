# NEXO

NEXO is an Expo/React Native social planning application for creating plans,
joining local activities, managing friendships and using plan or direct chats.
The client runs on Android and iPhone and uses Supabase for Auth, PostgreSQL,
Realtime, Storage and Edge Functions.

## Requirements

- Node.js 22
- npm
- Expo/EAS account access
- Docker-compatible runtime and the Supabase CLI for database work
- A separate Supabase project for mobile E2E tests

## Local application setup

```bash
npm ci
npx expo start
```

Create a local `.env` with the public client values used by the app. Never add
the Supabase service-role key or database password to the
repository.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run deps:check
npm run bundle:check
```

GitHub repeats these checks on each pull request. The bundle check compiles the
JavaScript and assets separately for Android and iPhone; labeled EAS workflows
run the full Maestro mobile flows.

Critical production advisories fail CI. Compatible overrides remove the known
critical advisory; the remaining advisories are inherited from the Expo/Metro
native build toolchain and require a tested Expo SDK migration rather than
forced, incompatible package versions.

## Database workflow

The live schema was baselined on 2026-08-11 in
`supabase/migrations/20260811000100_production_schema_baseline.sql`. No
production rows, auth users, secrets or file contents are included.

```bash
supabase start
supabase db reset
supabase test db
```

For future changes:

```bash
supabase migration new descriptive_name
# edit the generated SQL
supabase db reset
supabase test db
supabase gen types --lang typescript --local > lib/database.types.ts
```

The production project pre-dates migration tracking. On the first linked
deployment, mark only the baseline as already applied, preview the remaining
migration, then push it:

```bash
supabase link --project-ref nixeproyzxvqzyrvsxcx
supabase migration repair 20260811000100 --status applied --linked
supabase db push --dry-run
supabase db push
```

Never run `supabase db reset --linked` against production.

Deploy the destructive-cleanup functions after the corresponding migration:

```bash
supabase functions deploy delete-account
supabase functions deploy delete-plan
```

See [the security audit](docs/supabase-security-audit.md) for verified controls
and [the launch checklist](docs/LAUNCH_CHECKLIST.md) for release ownership.

## Cost-sensitive configuration

The core app does not require OpenAI, Sentry, a subscription provider, or a
paid map integration. Native Google Maps on Android is optional; without its
key, address search and location-based functionality remain available with the
documented fallback. HTTPS sharing links are enabled only after NEXO controls a
domain and publishes valid Apple/Android association files.

## Error diagnostics

NEXO does not currently send crash reports to a third-party monitoring
provider. Production failures must be investigated with EAS build logs,
Supabase service logs and controlled reproduction. If remote crash reporting is
introduced later, it must be configured together with the privacy policy,
retention rules and release validation.

## Mobile E2E

The Maestro flows in `.maestro/` must use an isolated Supabase test project.
Add the `mobile-e2e` label to a pull request only after the EAS preview
environment has the variables described in `.maestro/README.md`.

## Repository map

- `app/`: Expo Router screens and navigation.
- `components/`, `features/`: shared UI and feature modules.
- `lib/`: Supabase access, caching, notifications and domain services.
- `theme/`: common visual tokens.
- `supabase/migrations/`: ordered database history.
- `supabase/tests/database/`: pgTAP authorization and schema tests.
- `.github/workflows/`: code, dependency and database checks.
- `.eas/workflows/`: native builds and Maestro flows.
