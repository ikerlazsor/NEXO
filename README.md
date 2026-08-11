# NEXO

NEXO is an Expo/React Native social planning application for creating plans,
joining local activities, managing friendships and using plan or direct chats.
The client runs on Android and iPhone and uses Supabase for Auth, PostgreSQL,
Realtime, Storage and Edge Functions.

## Requirements

- Node.js 20
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
the Supabase service-role key, Sentry token or database password to the
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

See [the security audit](docs/supabase-security-audit.md) for verified controls
and the two client-coordinated privacy remediations still required.

## Sentry

Production EAS builds upload source maps automatically. Configure
`SENTRY_AUTH_TOKEN` as a sensitive EAS environment variable and provide
`SENTRY_ORG` and `SENTRY_PROJECT` for the production environment. Preview and
E2E builds keep automatic upload disabled.

After a release, verify symbolication with a controlled test error in a
non-production account before relying on stack traces.

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
