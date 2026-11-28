// The encryption itself.
const { test, expect } = require("./helpers");

test("encrypt and decrypt; password lock can move to a new password; recovery code works", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const v = await Vault.create("first password", { src: "password" });
    const secret = await Vault.enc(v.key, { amount: 123.45, note: "secret" });
    const k1 = await Vault.unlock(v, "first password");
    const back = await Vault.dec(k1, secret);
    let wrong = false; try { await Vault.unlock(v, "nope nope 1"); } catch (_) { wrong = true; }
    const moved = { ...v, pass: await Vault.rewrap(k1, "second password") };
    const k2 = await Vault.unlock(moved, "second password");
    const back2 = await Vault.dec(k2, secret);
    const rec = await Vault.recoverToPassword(v, v.code.toLowerCase(), "third password");
    const back3 = await Vault.dec(rec.key, secret);
    return { secret, back, wrong, back2, back3, src: moved.pass.src };
  });
  expect(r.secret).not.toContain("secret");
  expect(r.back).toEqual({ amount: 123.45, note: "secret" });
  expect(r.wrong).toBe(true);
  expect(r.back2.note).toBe("secret");
  expect(r.back3.note).toBe("secret");
  expect(r.src).toBe("password");
});
