// Daily reminder switch (the phone's notification system is simulated).
const { test, expect, signedInFresh, db } = require("./helpers");

test("turn the reminder on, move its time, turn it off", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => window.__perm || "default" });
    Notification.requestPermission = async () => (window.__perm = "granted");
    let have = null;
    const fake = { endpoint: "https://push.example/abc", toJSON: () => ({ keys: { p256dh: "P", auth: "A" } }), unsubscribe: async () => { have = null; return true; } };
    const pm = { getSubscription: async () => have, subscribe: async () => (have = fake) };
    Object.defineProperty(navigator.serviceWorker, "ready", { get: () => Promise.resolve({ pushManager: pm }) });
  });
  await signedInFresh(page);
  await page.click("#openSettings");
  await page.check("#rOn");
  await expect(page.locator("#rTimeRow")).toBeVisible();
  await expect.poll(async () => ((await db(page)).push_subs || []).map(s => s.remind_at)).toEqual(["20:00"]);
  await page.selectOption("#rTime", "21:30");
  await expect.poll(async () => ((await db(page)).push_subs || []).map(s => s.remind_at)).toEqual(["21:30"]);
  await page.uncheck("#rOn");
  await expect.poll(async () => ((await db(page)).push_subs || []).length).toBe(0);
});
