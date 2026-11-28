// Shared setup for the tests: every page gets the pretend server, no real network,
// and a list of JavaScript errors that must stay empty.
const base = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const MOCK = fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8");

const test = base.test.extend({
  page: async ({ page, context }, use) => {
    await context.route("**/supabase.js", r => r.fulfill({ body: MOCK, contentType: "application/javascript" }));
    // Nothing leaves the test: real Supabase and web fonts are cut off.
    await context.route(/supabase\.co|fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    page.errors = [];
    page.on("pageerror", e => page.errors.push(String(e && e.stack || e)));
    await use(page);
    base.expect(page.errors, "JavaScript errors on the page").toEqual([]);
  }
});
const expect = base.expect;

// Before the app loads: choose what the pretend server holds.
async function setup(page, opts = {}) {
  await page.addInitScript(o => {
    if (sessionStorage.getItem("mock-ready")) return; // only on the first load, so reloads keep data
    sessionStorage.setItem("mock-ready", "1");
    localStorage.clear();
    if (o.seed) localStorage.setItem("mock-seed", o.seed);
    if (o.signedIn) { localStorage.setItem("mocksession", "1"); localStorage.setItem("sb-mock-auth-token", JSON.stringify({ user: { id: "u1" } })); }
    if (o.meta) localStorage.setItem("mock-meta", JSON.stringify(o.meta));
    localStorage.setItem("mm-seen", String(Date.now())); // no "welcome back" unless a test asks
    for (const [k, v] of Object.entries(o.storage || {})) localStorage.setItem(k, v);
  }, opts);
}

// Wait for the welcome animation to finish (or skip it).
async function skipWelcome(page) {
  const w = page.locator("#wback");
  if (await w.isVisible()) { await w.click(); await expect(w).toBeHidden(); }
}

// A brand-new email account, all the way to Home.
async function signUp(page, password = "mango river 1") {
  await setup(page);
  await page.goto("/");
  await page.click("#wStart");
  await page.fill("#aEmail", "amy@example.com");
  await page.fill("#aPass", password);
  await page.click("#aSubmit");
  await expect(page.locator("#codeForm")).toBeVisible({ timeout: 15000 });
  await page.fill("#aCode", "123456");
  if (await page.locator("#cSubmit").isVisible()) await page.click("#cSubmit").catch(() => {});
  await expect(page.locator("#wback")).toBeVisible({ timeout: 15000 });
  await skipWelcome(page);
  await expect(page.locator("#view-home")).toBeVisible();
}

// Signed in already, records not set up yet (like a Google sign-up): choose a records password.
async function signedInFresh(page, opts = {}) {
  await setup(page, { signedIn: true, ...opts });
  await page.goto("/");
  await expect(page.locator("#vSetup")).toBeVisible({ timeout: 15000 });
  await page.fill("#vNew1", "correct horse 12");
  await page.click("#vSetupBtn");
  await expect(page.locator("#wback")).toBeVisible({ timeout: 15000 });
  await skipWelcome(page);
  await expect(page.locator("body")).not.toHaveClass(/locked/);
}

async function addEntry(page, { type = "expense", amount, note = "", date, cat = 0, repeat } = {}) {
  await page.click('[data-tab="home"]');
  await page.locator(`[data-q="${type === "income" ? "addIn" : "addOut"}"]`).first().click();
  await expect(page.locator("#entryOv")).toHaveClass(/open/);
  await page.fill("#fAmt", String(amount));
  if (date) await page.fill("#fDate", date);
  await page.fill("#fNote", note);
  await page.locator("#chips [data-c]").nth(cat).click();
  if (repeat) await page.click(`#repChips [data-r="${repeat}"]`);
  await page.click("#saveBtn");
  await expect(page.locator("#entryOv")).not.toHaveClass(/open/);
}

const db = async page => JSON.parse(await page.evaluate(() => localStorage.getItem("mockdb") || "{}"));
const iso = d => d.toISOString().slice(0, 10);
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
function monthsAgo(n, day = 1) { const d = new Date(); return iso(new Date(Date.UTC(d.getFullYear(), d.getMonth() - n, day))); }

module.exports = { test, expect, setup, signUp, signedInFresh, addEntry, skipWelcome, db, daysAgo, monthsAgo };
