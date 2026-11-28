// Languages.
const { test, expect, setup, signedInFresh } = require("./helpers");

test("login screen switches to French and Kreol", async ({ page }) => {
  await setup(page, { storage: { "mm-has-account": "1" } });
  await page.goto("/");
  await page.selectOption("#langAuth", "fr");
  await expect(page.locator("#aSubmit")).toHaveText("Se connecter");
  await page.selectOption("#langAuth", "mfe");
  await expect(page.locator("#aForgot")).not.toHaveText("Forgot password?");
  await page.selectOption("#langAuth", "en");
  await expect(page.locator("#aSubmit")).toHaveText("Log in");
});

test("Home in French", async ({ page }) => {
  await signedInFresh(page, { storage: { "mm-lang": "fr" } });
  await expect(page.locator('[data-q="addOut"]').first()).toContainText("Dépense");
});
