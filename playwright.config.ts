import { defineConfig } from "@playwright/test";

export default defineConfig({
  testMatch: ["**/*.pw.ts", "**/*.spec.ts"],
  use: {
    timezoneId: "UTC",
    locale: "en-US",
    colorScheme: "light",
    reducedMotion: "reduce"
  }
});
