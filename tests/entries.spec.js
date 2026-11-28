// Adding, editing and deleting entries, and the totals on Home.
const { test, expect, signedInFresh, addEntry, db } = require("./helpers");

test("add money in and an expense; Home and Journal add up", async ({ page }) => {
  await signedInFresh(page);
  await addEntry(page, { type: "income", amount: 5000, note: "Pay" });
  await addEntry(page, { amount: 250.5, note: "Winners" });
  await expect(page.locator("#freeAmt")).toContainText("4,749");
  await page.click('[data-tab="journal"]');
  await expect(page.locator("#view-journal")).toContainText("Winners");
  await expect(page.locator("#view-journal")).toContainText("Pay");
  // stored encrypted: no amounts or notes readable on the server
  const tx = (await db(page)).transactions;
  expect(tx).toHaveLength(2);
  for (const t of tx) { expect(t.enc).toMatch(/^v1\./); expect(t.amount).toBeNull(); expect(JSON.stringify(t)).not.toContain("Winners"); }
});

test("edit an entry's amount, then delete it", async ({ page }) => {
  await signedInFresh(page);
  await addEntry(page, { amount: 100, note: "Bus" });
  await page.click('[data-tab="journal"]');
  await page.locator("#view-journal .tx", { hasText: "Bus" }).click();
  await page.fill("#fAmt", "120");
  await page.click("#saveBtn");
  await expect(page.locator("#view-journal")).toContainText("120.00");
  await page.locator("#view-journal .tx", { hasText: "Bus" }).click();
  await page.click("#delBtn");
  await page.click("#delBtn"); // tap again to confirm
  await expect(page.locator("#view-journal .tx", { hasText: "Bus" })).toHaveCount(0);
  expect((await db(page)).transactions).toHaveLength(0);
});

test("an amount is required", async ({ page }) => {
  await signedInFresh(page);
  await page.locator('[data-q="addOut"]').first().click();
  await page.click("#saveBtn");
  await expect(page.locator("#fErr")).toHaveText("Enter an amount above zero.");
});
