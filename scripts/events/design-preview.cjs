#!/usr/bin/env node
const { spawn } = require("node:child_process");
// The isolated design preview never points at the production backend.
const child = spawn(
  "npx",
  ["expo", "start", "preview/events", "--web", "--port", "8083"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      EXPO_OFFLINE: "1",
      EXPO_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "local-preview-placeholder",
    },
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
