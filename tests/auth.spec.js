// Signing up, logging in and resetting a password.
const { test, expect, setup, signUp, skipWelcome, db } = require("./helpers");

test("new email account goes straight to Home, with the welcome and two setup cards", async ({ page }) => {
  await signUp(page);
  await expect(page.locator("#vSetup")).toBeHidden();
  const cards = page.locator("#setupCards");
  await expect(cards).toContainText("Save your recovery code");
  await expect(cards).toContainText("Make it yours");
  // the records are locked with the sign-up password, not a separate passphrase
  const v = (await db(page)).vault;
  expect(v).toHaveLength(1);
  expect(v[0].pass.src).toBe("password");
});

test("sign-up asks for at least 8 characters", async ({ page }) => {
  await setup(page);
  await page.goto("/");
  await page.click("#wStart");
  await page.fill("#aEmail", "amy@example.com");
  await page.fill("#aPass", "short12");
  await page.click("#aSubmit");
  await expect(page.locator("#aErr")).toContainText("at least 8 characters");
});

test("recovery code card shows the code, then goes away once saved", async ({ page }) => {
  await signUp(page);
  await page.click('[data-sc="show"]');
  await expect(page.locator("#scCode")).toHaveText(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/);
  await page.click('[data-sc="saved"]');
  await expect(page.locator("#setupCards")).not.toContainText("recovery code");
});

test("logging back in opens the records with no extra unlock step; a wrong password is refused", async ({ page }) => {
  await signUp(page);
  await page.click("#openSettings");
  await page.click("#signOut");
  await expect(page.locator("#authForm")).toBeVisible();
  await expect(page.locator("#aSubmit")).toHaveText("Log in"); // not stuck on "Create account"
  await page.fill("#aEmail", "amy@example.com");
  await page.fill("#aPass", "wrong pass 9");
  await page.click("#aSubmit");
  await expect(page.locator("#aErr")).toHaveText("That email and password don't match.");
  await page.fill("#aPass", "mango river 1");
  await page.click("#aSubmit");
  await expect(page.locator("#wback")).toContainText("Welcome back");
  await skipWelcome(page);
  await expect(page.locator("#vUnlock")).toBeHidden();
  await expect(page.locator("body")).not.toHaveClass(/locked/);
});

test("after a password reset, the old password opens the records once, then the new one works", async ({ page }) => {
  await signUp(page);
  const lockBefore = (await db(page)).vault[0].pass.salt;
  await page.click("#openSettings");
  await page.click("#signOut");
  await page.click("#aForgot");
  await page.fill("#rEmail", "amy@example.com");
  await page.click("#rSubmit");
  await page.fill("#rCode", "123456");
  await page.fill("#rPass", "sunny hill 22");
  await page.click("#rSubmit");
  await expect(page.locator("#vUnlock")).toBeVisible();
  await expect(page.locator("#vPassLbl")).toHaveText("Password");
  await page.fill("#vPass", "mango river 1");
  await page.click("#vUnlockBtn");
  await skipWelcome(page);
  await expect(page.locator("body")).not.toHaveClass(/locked/);
  // the lock moves to the new password in the background
  await expect.poll(async () => (await db(page)).vault[0].pass.salt, { timeout: 15000 }).not.toBe(lockBefore);
  await page.click("#openSettings");
  await page.click("#signOut");
  await page.fill("#aEmail", "amy@example.com");
  await page.fill("#aPass", "sunny hill 22");
  await page.click("#aSubmit");
  await skipWelcome(page);
  await expect(page.locator("#vUnlock")).toBeHidden();
  await expect(page.locator("body")).not.toHaveClass(/locked/);
});

test("Google sign-up: one records-password step, then 'Welcome' with their first name", async ({ page }) => {
  await setup(page, { signedIn: true, meta: { full_name: "Amara Mensah" } });
  await page.goto("/");
  await expect(page.locator("#vSetup")).toBeVisible();
  await expect(page.locator("#vNew2")).toBeHidden();
  await page.fill("#vNew1", "correct horse 12");
  await page.click("#vSetupBtn");
  await expect(page.locator("#wback")).toContainText("Welcome");
  await expect(page.locator("#wbName")).toHaveText("Amara");
  await skipWelcome(page);
  await expect(page.locator("#meName")).toHaveText("Amara");
  await expect(page.locator("#setupCards")).toContainText("Make it yours");
});
