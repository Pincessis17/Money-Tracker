// Automated tests for My Money. They open the real app in a headless browser,
// with a pretend server (tests/mock-supabase.js), and click through what people do.
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:8765",
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
    locale: "en-GB",
    timezoneId: "Indian/Mauritius",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "python3 -m http.server 8765",
    url: "http://localhost:8765/index.html",
    reuseExistingServer: true,
    stdout: "ignore",
    stderr: "ignore"
  }
});
