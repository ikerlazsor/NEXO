# NEXO launch checklist

This checklist separates controls implemented in the repository from release
tasks that require the product owner, legal identity, store accounts, physical
devices, or public infrastructure.

## Implemented and automated

- [x] RLS on every public application table and closed anonymous table grants.
- [x] Server-enforced profile privacy for birth date, gender, habits and interests.
- [x] Username reservation where possible and a signed-out availability check
  that exposes no profile data.
- [x] Account and plan deletion through authenticated Edge Functions, including
  physical Supabase Storage cleanup.
- [x] User, plan, support and individual-message reporting with staff queues.
- [x] Private chat attachments served through renewable signed URLs.
- [x] Ten-character client password policy and no stored registration password.
- [x] No client-side service secrets, paid AI dependency, crash-reporting SDK,
  subscription screen or unverified associated domain.
- [x] CI for lint, TypeScript, unit tests, Expo compatibility, dependency audit,
  database pgTAP tests and Android/iPhone bundles.
- [x] Spanish and English privacy pages plus public account-deletion instructions.

## Required before store submission

- [ ] Insert the controller's real legal name, tax identity where applicable
  and postal address in the privacy policy; obtain legal review for the launch
  countries.
- [ ] Publish privacy policy, terms, community rules, support contact and
  account-deletion instructions on stable HTTPS URLs.
- [ ] Configure the production Auth email templates, redirect allow-list,
  confirmation behavior, password minimum and abuse/rate-limit settings; test
  new account, reset, change-email and deletion end to end.
- [ ] Record the production migration and Edge Function deployment, advisor
  output, rollback approach and incident contact.
- [ ] Complete Apple App Privacy and Google Play Data Safety declarations using
  the actual data flows in the privacy policy.
- [ ] Prepare store description, screenshots, icon, age/content ratings,
  moderation/contact responses and reviewer demo credentials.
- [ ] Produce signed release builds and test signup, chat/media, push,
  permissions, deep links, reports, blocking, plan/account deletion and poor
  network behavior on real Android and iPhone devices.
- [ ] Upgrade to a supported Expo SDK line that resolves the remaining
  Metro/image-size and Xcode/uuid advisories, then repeat native regression
  testing.
- [ ] Define support and safety response times, abuse escalation, data-request
  handling, incident response and a recoverable backup/export procedure.

## Optional later, with explicit budget approval

- [ ] Verified web domain and Universal/App Links.
- [ ] Native Google Maps key for the Android embedded map; the free fallback is
  functional without it.
- [ ] Paid breached-password protection or third-party crash monitoring, only
  after privacy, retention, consent and cost review.
