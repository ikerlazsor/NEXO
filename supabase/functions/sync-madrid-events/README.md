# Madrid daily sync

Run `npm run events:build-function` before deployment. The ignored `index.ts` is generated from the shared importer and handler by `scripts/events/build-sync-function.cjs`; it has no external npm/CDN dependencies and contains no credentials.

The production deployment script builds this file, preserves gateway JWT verification and configures an independent `NEXO_MADRID_SYNC_SECRET`. The handler checks that secret before downloading anything. The scheduler sends a public anon JWT to the gateway; only the function uses Supabase's built-in service credentials for the serialized import RPC. See `docs/madrid-production-deployment.md` for activation, monitoring and native distribution.
