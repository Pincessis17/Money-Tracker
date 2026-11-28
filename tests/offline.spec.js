// No signal: entries save on the phone and sync later.
const { test, expect, signedInFresh, addEntry, skipWelcome, db } = require("./helpers");

test("add while offline, reopen with the server unreachable, then sync when it's back", async ({ page, context }) => {
  await signedInFresh(page);
  await context.setOffline(true);
  await expect(page.locator("#syncNote")).toContainText("Offline");
  await addEntry(page, { amount: 75, note: "Taxi offline" });
  await expect(page.locator("#syncNote")).toContainText("1 change waiting to sync");
  expect((await db(page)).transactions).toHaveLength(0);

  // reopen the app: server down and the login expired
  await context.setOffline(false);
  await page.evaluate(() => { localStorage.setItem("mockdown", "1"); localStorage.setItem("mockexpired", "1"); });
  await page.reload();
  await skipWelcome(page);
  await expect(page.locator("body")).not.toHaveClass(/signedout|locked/);
  await page.click('[data-tab="journal"]');
  await expect(page.locator("#view-journal")).toContainText("Taxi offline");

  // back online
  await page.evaluate(() => { localStorage.setItem("mockdown", "0"); localStorage.setItem("mockexpired", "0"); window.dispatchEvent(new Event("online")); });
  await expect(page.locator("#syncNote")).toContainText("Synced", { timeout: 15000 });
  expect((await db(page)).transactions).toHaveLength(1);
});

test("server unreachable but phone online: says the server may be waking up", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("mm-has-account", "1"); localStorage.setItem("mockdown", "1"); });
  await page.goto("/");
  await page.fill("#aEmail", "amy@example.com");
  await page.fill("#aPass", "whatever12");
  await page.click("#aSubmit");
  await expect(page.locator("#aErr")).toContainText("waking up");
});
