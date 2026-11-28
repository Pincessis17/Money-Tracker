// Repeating entries (salary, rent, subscriptions).
const { test, expect, signedInFresh, addEntry, skipWelcome, db, monthsAgo } = require("./helpers");

test("monthly salary from two months ago fills in the missed months, once", async ({ page }) => {
  await signedInFresh(page);
  await addEntry(page, { type: "income", amount: 12000, note: "Salary", date: monthsAgo(2, 1), repeat: "month" });
  await expect.poll(async () => (await db(page)).transactions.length).toBe(3);
  await page.click('[data-tab="plans"]');
  await expect(page.locator("#repList")).toContainText("Every month on the 1st");
  await page.reload();
  await skipWelcome(page);
  await page.waitForTimeout(1500);
  expect((await db(page)).transactions).toHaveLength(3); // no doubles
});

test("stopping a repeat keeps the entries already added", async ({ page }) => {
  await signedInFresh(page);
  await addEntry(page, { amount: 300, note: "Netflix", date: monthsAgo(1, 5), repeat: "month" });
  await expect.poll(async () => (await db(page)).transactions.length).toBeGreaterThanOrEqual(1);
  const n = (await db(page)).transactions.length;
  await page.click('[data-tab="plans"]');
  await page.locator("[data-rstop]").first().click();
  await page.locator("[data-rstop]").first().click();
  await expect(page.locator("#repList")).toContainText("Nothing repeating yet");
  expect((await db(page)).transactions).toHaveLength(n);
});
