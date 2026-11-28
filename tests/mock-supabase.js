// A pretend Supabase for the automated tests. It keeps everything in the page's localStorage,
// so tests can sign up, log in, save, go offline and reload without touching the real server.
// Switches (set in localStorage before the app loads):
//   mock-seed   "empty" (default) or "demo" (an older account with unencrypted sample data)
//   mockdown    "1" = every request fails as if the server can't be reached
//   mockexpired "1" = the login token expired while offline (session gone, saved login still there)
(function () {
  const RATES = [{"day": "2026-11-20", "ccy": "USD", "source": "mcb", "buy": 46.359, "sell": 48.298, "mid": 47.329}, {"day": "2026-11-20", "ccy": "EUR", "source": "mcb", "buy": 50.803, "sell": 52.924, "mid": 51.874}, {"day": "2026-11-20", "ccy": "GBP", "source": "mcb", "buy": 60.802, "sell": 63.226, "mid": 62.029}, {"day": "2026-11-20", "ccy": "USD", "source": "market", "buy": null, "sell": null, "mid": 47.353648}, {"day": "2026-11-20", "ccy": "EUR", "source": "market", "buy": null, "sell": null, "mid": 51.97056}, {"day": "2026-11-20", "ccy": "GBP", "source": "market", "buy": null, "sell": null, "mid": 62.05036}, {"day": "2026-11-20", "ccy": "GHS", "source": "market", "buy": null, "sell": null, "mid": 3.886288}, {"day": "2026-11-20", "ccy": "ZAR", "source": "market", "buy": null, "sell": null, "mid": 2.69771}, {"day": "2026-11-20", "ccy": "NGN", "source": "market", "buy": null, "sell": null, "mid": 0.034957}, {"day": "2026-11-20", "ccy": "KES", "source": "market", "buy": null, "sell": null, "mid": 0.3636}, {"day": "2026-11-27", "ccy": "USD", "source": "mcb", "buy": 45.9, "sell": 47.82, "mid": 46.86}, {"day": "2026-11-27", "ccy": "EUR", "source": "mcb", "buy": 50.3, "sell": 52.4, "mid": 51.36}, {"day": "2026-11-27", "ccy": "GBP", "source": "mcb", "buy": 60.2, "sell": 62.6, "mid": 61.415}, {"day": "2026-11-27", "ccy": "USD", "source": "market", "buy": null, "sell": null, "mid": 46.8848}, {"day": "2026-11-27", "ccy": "EUR", "source": "market", "buy": null, "sell": null, "mid": 51.456}, {"day": "2026-11-27", "ccy": "GBP", "source": "market", "buy": null, "sell": null, "mid": 61.436}, {"day": "2026-11-27", "ccy": "GHS", "source": "market", "buy": null, "sell": null, "mid": 3.886288}, {"day": "2026-11-27", "ccy": "ZAR", "source": "market", "buy": null, "sell": null, "mid": 2.671}, {"day": "2026-11-27", "ccy": "NGN", "source": "market", "buy": null, "sell": null, "mid": 0.034611}, {"day": "2026-11-27", "ccy": "KES", "source": "market", "buy": null, "sell": null, "mid": 0.36}];
  const seed = () => localStorage.getItem("mock-seed") === "demo" ? {
    transactions: [{ id: "11111111-1111-4111-8111-111111111111", type: "income", amount: 12000, category: "Job / salary", note: "Monthly pay", date: new Date().toISOString().slice(0, 8) + "01", created_at: "2026-11-01T10:00:00Z", receipt_path: null, enc: null }],
    settings: [{ user_id: "u1", currency: "Rs", expense_cats: ["Groceries", "Transport", "Other"], income_cats: ["Job / salary", "Other"], budgets: { Transport: 1000 }, display_name: "Princess", theme: "blush", avatar: "girl", skin: "brown", enc: null }],
    plans: [], fx_holdings: [], fx_tracker: [], vault: [], lists: [], push_subs: [], fx_rates: RATES
  } : { transactions: [], settings: [], plans: [], fx_holdings: [], fx_tracker: [], vault: [], lists: [], push_subs: [], fx_rates: RATES };
  const load = () => { try { return JSON.parse(localStorage.getItem("mockdb")) || seed(); } catch (e) { return seed(); } };
  const save = db => localStorage.setItem("mockdb", JSON.stringify(db));
  const down = () => localStorage.getItem("mockdown") === "1";
  const FAIL = { data: null, error: { message: "TypeError: Failed to fetch" } };
  function q(t) {
    let op = "select", row = null, col = null, val = null, single = false;
    const o = {
      select() { return o }, order() { return o }, gte() { return o }, in() { return o },
      maybeSingle() { single = true; return o }, single() { single = true; return o },
      insert(r) { op = "insert"; row = r; return o }, update(r) { op = "update"; row = r; return o }, upsert(r, opt) { op = "upsert"; row = r; o.conflict = opt && opt.onConflict; return o }, delete() { op = "delete"; return o },
      eq(c, v) { col = c; val = v; return o },
      then(res, rej) {
        if (down()) { setTimeout(() => res(FAIL), 30); return; }
        const db = load(); db[t] = db[t] || []; let data = null;
        if (op === "select") { const rows = col ? db[t].filter(x => x[col] === val) : db[t].slice(); data = single ? (rows[0] || null) : rows; }
        if (op === "insert") { const r = { ...row }; if (t === "vault") r.user_id = "u1"; db[t].push(r); data = r; }
        if (op === "upsert") { const k = o.conflict || (row.id ? "id" : "user_id"); const i = db[t].findIndex(x => x[k] === row[k]); if (i >= 0) db[t][i] = { ...db[t][i], ...row }; else db[t].push({ ...row, created_at: row.created_at || new Date().toISOString() }); }
        if (op === "update") { db[t] = db[t].map(x => x[col] === val ? { ...x, ...row } : x); }
        if (op === "delete") { db[t] = db[t].filter(x => x[col] !== val); }
        save(db); res({ data, error: null });
      }
    };
    return o;
  }
  const files = {};
  const user = { id: "u1", email: "amy@example.com", user_metadata: JSON.parse(localStorage.getItem("mock-meta") || "{}") };
  const signIn = () => { localStorage.setItem("mocksession", "1"); localStorage.setItem("sb-mock-auth-token", JSON.stringify({ user })); setTimeout(() => window.__cb("SIGNED_IN", { user }), 10); };
  window.supabase = { createClient() { return {
    auth: {
      onAuthStateChange(cb) {
        window.__cb = cb;
        setTimeout(() => {
          if (localStorage.getItem("mocksession") !== "1") return cb("INITIAL_SESSION", null);
          if (localStorage.getItem("mockexpired") === "1") return cb("INITIAL_SESSION", null);
          cb("SIGNED_IN", { user });
        }, 10);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: async () => ({ data: { session: localStorage.getItem("mocksession") === "1" && localStorage.getItem("mockexpired") !== "1" ? { user } : null } }),
      signOut: async () => { localStorage.removeItem("mocksession"); localStorage.removeItem("sb-mock-auth-token"); setTimeout(() => window.__cb("SIGNED_OUT", null), 10); return { error: null }; },
      signUp: async ({ password }) => { localStorage.setItem("mockpw", password); return { data: { session: null, user }, error: null }; },
      signInWithPassword: async ({ password }) => {
        if (down()) throw new TypeError("Failed to fetch");
        if (password === localStorage.getItem("mockpw")) { signIn(); return { error: null }; }
        return { error: { message: "Invalid login credentials" } };
      },
      resend: async () => ({ error: null }),
      verifyOtp: async ({ token }) => token === "123456" ? (signIn(), { error: null }) : { error: { message: "Token has expired or is invalid" } },
      resetPasswordForEmail: async () => ({ error: null }),
      updateUser: async u => { localStorage.setItem("mockpw", u.password); return { error: null }; },
      signInWithOAuth: async () => ({ error: null })
    },
    from: q,
    storage: { from() { return { upload: async (p, b) => { files[p] = b; return {}; }, download: async p => ({ data: files[p] }), remove: async () => ({}), createSignedUrl: async () => ({ data: { signedUrl: "" } }) }; } },
    functions: { invoke: async n => n === "push" ? { data: { publicKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" } } : { data: {} } }
  }; } };
})();
