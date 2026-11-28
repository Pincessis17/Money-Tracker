// PDF statements.
const { test, expect, signedInFresh, addEntry } = require("./helpers");

for (const period of ["this", "all"]) {
  test(`makes a PDF statement (${period})`, async ({ page }) => {
    await signedInFresh(page);
    await addEntry(page, { type: "income", amount: 5000, note: "Pay" });
    await addEntry(page, { amount: 250, note: "Winners" });
    await page.click('[data-tab="journal"]');
    await page.click("#openStm2");
    await page.click(`#stmPeriod [data-p="${period}"]`);
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.click("#stmGo")]);
    expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
    const buf = require("fs").readFileSync(await dl.path());
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(5000);
  });
}
