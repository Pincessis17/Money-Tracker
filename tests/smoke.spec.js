// Every tab in every theme opens without errors; older accounts still load.
const { test, expect, setup, signedInFresh, skipWelcome, db } = require("./helpers");

for (const theme of ["emerald", "blush", "sky", "ember", "midnight", "onyx"]) {
  test(`all tabs open in ${theme}`, async ({ page }) => {
    await signedInFresh(page, { storage: { "mm-theme": theme } });
    for (const tab of ["journal", "plans", "rates", "home"]) {
      await page.click(`[data-tab="${tab}"]`);
      await expect(page.locator(`#view-${tab}`)).toBeVisible();
    }
    await page.click("#openSettings");
    await expect(page.locator("#setOv")).toHaveClass(/open/);
  });
}

test("an older account with unencrypted data gets encrypted on first load", async ({ page }) => {
  await signedInFresh(page, { seed: "demo" });
  await expect(page.locator("#meName")).toHaveText("Princess");
  await expect.poll(async () => (await db(page)).transactions.every(t => /^v1\./.test(t.enc || ""))).toBe(true);
});

test("welcome back shows after 30 minutes away", async ({ page }) => {
  await signedInFresh(page);
  // the phone was put away 31 minutes ago, and now it's opened again
  await page.evaluate(() => {
    localStorage.setItem("mm-seen", String(Date.now() - 31 * 60000));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#wback")).toBeVisible();
  await expect(page.locator("#wback")).toContainText("Welcome back");
  await page.locator("#wback").click();
  await expect(page.locator("#wback")).toBeHidden();
});
