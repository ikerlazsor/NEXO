# NEXO mobile E2E tests

These flows must run only against an isolated Supabase test project. The `e2e-test`
build refuses to start when `EXPO_PUBLIC_SUPABASE_URL` is missing or points to the
production NEXO project.

Configure the following variables in the EAS `preview` environment before adding
the `mobile-e2e` label to a pull request:

- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`: isolated test project.
- `MAESTRO_ANDROID_TEST_*` and `MAESTRO_IOS_TEST_*`: separate verified reusable
  members, joinable plan IDs/titles and group chat titles for each platform.
- `MAESTRO_ANDROID_SIGNUP_*` and `MAESTRO_IOS_SIGNUP_*`: separate unique unverified
  registration fixtures for each platform.
- `MAESTRO_ANDROID_DELETE_*` and `MAESTRO_IOS_DELETE_*`: separate disposable verified
  accounts for each platform.

The regular workflow runs on Android and iPhone simulator when a PR receives the
`mobile-e2e` label. The destructive registration/deletion workflow is manual and
must be supplied with fresh disposable fixtures on each run.
