import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(new URL("./tests/empty.ts", import.meta.url)),
      "next/server": fileURLToPath(new URL("./tests/next-server.ts", import.meta.url)),
    },
  },
  test: {
    setupFiles: ["./tests/public-setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    env: { PRAMAAN_FAKE: "1" },
  },
});
