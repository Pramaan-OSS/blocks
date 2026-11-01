import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // One worker: the demo's fake Pramaan is shared state, so the walks run one after another.
  workers: 1,
  use: { baseURL: `http://localhost:${port}`, headless: true },
  webServer: {
    env: { PRAMAAN_FAKE_STEP_MS: "1000", PRAMAAN_BOOKING_HOST: "user-42" },
    // Serves the production build: run `pnpm build` first (it needs no dev lock, so it can sit beside a dev server).
    command: `PRAMAAN_FAKE=1 next start -p ${port}`,
    url: `http://localhost:${port}`,
    // The owner's demo server may hold port 3100; use it rather than stop it.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
