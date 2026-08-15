import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Everything under test today is pure validation logic, so the lighter
    // node environment is enough. Add a jsdom project when component tests
    // arrive.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
});
