(() => {
  const $ = (id) => document.getElementById(id);
  const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  const sb = window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const PALETTE = ["#C4677A","#3F7E5C","#4C7BF4","#A8702E","#7E5A9E","#2C8A92","#B5487A","#5E7A24","#8A5A3C","#4A6378","#C0602A","#3D9970","#8E5BB0"];
  const DEFAULTS = {
    currency: "Rs",
    expenseCats: ["Groceries","Eating out","Transport","Rent & housing","Bills & phone","School & books","Health","Personal care","Clothes","Fun & going out","Business","Family & gifts","Other"],
    incomeCats: ["Job / salary","Allowance","Freelance","Business","Gift","Other"],
    budgets: {},
    name: "", theme: "blush", avatar: "girl", skin: "brown"
  };
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const st = { track: [], holds: [], fx: [], fxTried: false, user: null, txs: [], plans: [], showDone: false, settings: clone(DEFAULTS), hasSettingsRow: false, month: ym(new Date()), filter: "all", q: "" };

  function ym(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  function today() { const d = new Date(); return ym(d) + "-" + String(d.getDate()).padStart(2, "0"); }
  function shiftMonth(m, n) { const [y, mo] = m.split("-").map(Number); return ym(new Date(y, mo - 1 + n, 1)); }
  function monthName(m, long) { const [y, mo] = m.split("-").map(Number); return (long ? new Date(y, mo-1, 1).toLocaleString("en-GB", { month: "long" }) : MONTHS[mo - 1]) + " " + y; }
  function money(n) { return st.settings.currency + " " + (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function shortMoney(n) { if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,"") + "M"; if (n >= 1e3) return (n/1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/,"") + "k"; return String(Math.round(n)); }
  function plural(n) { return n + (n === 1 ? " entry" : " entries"); }
  function catColor(name, type) {
    const list = type === "income" ? st.settings.incomeCats : st.settings.expenseCats;
    let i = list.indexOf(name);
    if (i < 0) { i = 0; for (const c of name) i = (i * 31 + c.charCodeAt(0)) >>> 0; }
    return PALETTE[(i + (type === "income" ? 1 : 0)) % PALETTE.length];
  }
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2400); }
  function banner(msg) { const b = $("banner"); b.textContent = msg || ""; b.classList.toggle("show", !!msg); }

  /* ---------- auth ---------- */
  let signUpMode = false;
  function setAuthMode(up) {
    signUpMode = up;
    $("authTitle").textContent = up ? "Create your account" : "Welcome back";
    $("authSub").textContent = up ? "Start tracking your money in a minute" : "Log in to see your money";
    $("aSubmit").textContent = up ? "Create account" : "Log in";
    $("aSwitch").textContent = up ? "Already have an account? Log in" : "New here? Create an account";
    $("aPass").autocomplete = up ? "new-password" : "current-password";
    $("aErr").textContent = ""; $("aOk").textContent = "";
  }
  $("aSwitch").addEventListener("click", () => setAuthMode(!signUpMode));
  // A phone that has never logged in starts on "Create your account".
  try { if (!localStorage.getItem("mm-has-account")) setAuthMode(true); } catch (_) {}
  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("aEmail").value.trim(), password = $("aPass").value;
    $("aErr").textContent = ""; $("aOk").textContent = "";
    if (!/^\S+@\S+\.\S+$/.test(email)) return ($("aErr").textContent = "Enter a valid email address.");
    if (password.length < 6) return ($("aErr").textContent = "Password needs at least 6 characters.");
    $("aSubmit").disabled = true;
    const label = $("aSubmit").textContent;
    $("aSubmit").textContent = signUpMode ? "Creating your account…" : "Logging in…";
    const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000))]);
    try {
      if (signUpMode) {
        const { data, error } = await withTimeout(sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }));
        if (error) throw error;
        if (!data.session) {
          setAuthMode(false);
          $("aOk").textContent = "Account created. Check your email and tap the confirmation link, then come back here and log in.";
        }
      } else {
        const { error } = await withTimeout(sb.auth.signInWithPassword({ email, password }));
        if (error) throw error;
        try { localStorage.setItem("mm-has-account", "1"); } catch (_) {}
      }
    } catch (err) {
      const m = (err && err.message) || "";
      $("aErr").textContent = /confirm/i.test(m) ? "Confirm your email first: open the link we sent you, then sign in." :
        /invalid login/i.test(m) ? "That email and password don't match." :
        /already registered/i.test(m) ? "That email already has an account. Sign in instead." :
        /not authori[sz]ed/i.test(m) ? "Sign-ups for new people aren't switched on yet. Ask Princess to turn them on." :
        /invalid/i.test(m) && /email/i.test(m) ? "That email address can't be used. Check it's a real address you can open." :
        /rate limit|too many/i.test(m) ? "Too many attempts. Wait a few minutes and try again." :
        m === "timeout" ? "That took too long. Check your internet connection and try again." :
        /fetch|network|load failed/i.test(m) ? "No internet connection. Try again when you're online." : (m || "Something went wrong. Try again.");
    } finally { $("aSubmit").disabled = false; $("aSubmit").textContent = label; }
  });

  sb.auth.onAuthStateChange((_evt, session) => {
    const u = session ? session.user : null;
    if ((u && u.id) === (st.user && st.user.id)) return;
    st.user = u;
    document.body.classList.toggle("signedout", !u);
    if (u) { $("aPass").value = ""; try { localStorage.setItem("mm-has-account", "1"); } catch (_) {} startVault(); }
    else { st.key = null; st.vault = null; document.body.classList.remove("locked"); st.track = []; st.holds = []; st.txs = []; st.plans = []; st.settings = clone(DEFAULTS); }
  });

  /* ---------- private vault (end-to-end encryption) ---------- */
  const BLANK = {
    transactions: { type: null, amount: null, category: null, note: "", date: null, receipt_path: null },
    plans: { title: null, amount: null, category: "-", due_date: null, done: false, paid_tx_id: null, done_at: null, start_date: null, end_date: null, repeat: "none" },
    fx_holdings: { ccy: null, amount: null, cost_mur: null, date: null, note: "" },
    fx_tracker: { ccy: null, amount: null, date: null, note: "" },
    settings: { currency: "-", expense_cats: null, income_cats: null, budgets: {}, display_name: "", theme: "blush", avatar: "girl", skin: "brown" }
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
  async function putEnc(table, plain) {
    if (!st.key) throw new Error("locked");
    const { id, created_at, ...data } = plain;
    const enc = await Vault.enc(st.key, data);
    const row = table === "settings" ? { user_id: st.user.id, enc, ...BLANK.settings, updated_at: new Date().toISOString() } : { id, enc, ...BLANK[table] };
    const { error } = await sb.from(table).upsert(row);
    if (error) throw error;
  }
  function vaultMode(mode) {
    document.body.classList.add("locked");
    ["vSetup", "vCode", "vUnlock", "vRecover"].forEach(id => $(id).classList.toggle("hidden", id !== mode));
    $("vErr").textContent = "";
    const f = { vSetup: "vNew1", vUnlock: "vPass", vRecover: "vRecCode" }[mode];
    if (f) setTimeout(() => $(f).focus(), 60);
  }
  async function startVault() {
    $("syncNote").textContent = "Unlocking…";
    const { data, error } = await sb.from("vault").select("*").maybeSingle();
    if (error) { document.body.classList.remove("locked"); banner("Couldn't reach your records. Check your connection and reopen the app."); return; }
    st.vault = data;
    if (!data) return vaultMode("vSetup");
    const k = await Vault.loadKey(st.user.id);
    if (k) { st.key = k; document.body.classList.remove("locked"); return loadAll(); }
    vaultMode("vUnlock");
  }
  async function vaultReady(key) {
    st.key = key;
    await Vault.saveKey(st.user.id, key);
    $("vPass").value = ""; $("vNew1").value = ""; $("vNew2").value = ""; $("vRecCode").value = ""; $("vRecNew").value = "";
    document.body.classList.remove("locked");
    loadAll();
  }
  const passProblem = (a, b) => a.length < 8 ? "Use at least 8 characters. A few random words works well." : a !== b ? "The two passphrases don't match." : "";
  $("vSetup").addEventListener("submit", async e => {
    e.preventDefault();
    const a = $("vNew1").value, b = $("vNew2").value, p = passProblem(a, b);
    if (p) { $("vErr").textContent = p; return; }
    $("vSetupBtn").disabled = true; $("vSetupBtn").textContent = "Setting up…";
    try {
      const v = await Vault.create(a);
      const { error } = await sb.from("vault").insert({ pass: v.pass, rec: v.rec });
      if (error) throw error;
      st.vault = { pass: v.pass, rec: v.rec };
      st.pendingKey = v.key;
      $("vCodeText").textContent = v.code;
      $("vSaved").checked = false; $("vCodeDone").disabled = true;
      vaultMode("vCode");
    } catch (err) { $("vErr").textContent = "Couldn't set up your vault. Check your connection and try again."; }
    finally { $("vSetupBtn").disabled = false; $("vSetupBtn").textContent = "Lock my data"; }
  });
  $("vCopy").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("vCodeText").textContent); toast("Recovery code copied"); } catch (_) { toast("Copy was blocked. Write it down instead."); } });
  $("vSaved").addEventListener("change", () => { $("vCodeDone").disabled = !$("vSaved").checked; });
  $("vCodeDone").addEventListener("click", () => { const k = st.pendingKey; st.pendingKey = null; if (k) vaultReady(k); });
  $("vUnlock").addEventListener("submit", async e => {
    e.preventDefault();
    $("vUnlockBtn").disabled = true; $("vUnlockBtn").textContent = "Unlocking…";
    try { vaultReady(await Vault.unlock(st.vault, $("vPass").value)); }
    catch (_) { $("vErr").textContent = "That passphrase isn't right. Try again, or use your recovery code."; }
    finally { $("vUnlockBtn").disabled = false; $("vUnlockBtn").textContent = "Unlock"; }
  });
  $("vForgot").addEventListener("click", () => vaultMode("vRecover"));
  $("vBack").addEventListener("click", () => vaultMode("vUnlock"));
  $("vRecover").addEventListener("submit", async e => {
    e.preventDefault();
    const np = $("vRecNew").value;
    if (np.length < 8) { $("vErr").textContent = "Your new passphrase needs at least 8 characters."; return; }
    $("vRecBtn").disabled = true; $("vRecBtn").textContent = "Checking…";
    try {
      const r = await Vault.recover(st.vault, $("vRecCode").value, np);
      const { error } = await sb.from("vault").update({ pass: r.pass, updated_at: new Date().toISOString() }).eq("user_id", st.user.id);
      if (error) throw error;
      st.vault.pass = r.pass;
      vaultReady(r.key); toast("Unlocked. Your new passphrase is set.");
    } catch (err) { $("vErr").textContent = err && err.name === "OperationError" ? "That recovery code isn't right. Check each letter and try again." : "Couldn't save your new passphrase. Check your connection."; }
    finally { $("vRecBtn").disabled = false; $("vRecBtn").textContent = "Unlock with recovery code"; }
  });
  $("openCp").addEventListener("click", () => { ["cpOld", "cpNew1", "cpNew2"].forEach(id => $(id).value = ""); $("cpErr").textContent = ""; $("cpOv").classList.add("open"); setTimeout(() => $("cpOld").focus(), 50); });
  $("cpCancel").addEventListener("click", () => $("cpOv").classList.remove("open"));
  $("cpOv").addEventListener("click", e => { if (e.target === $("cpOv")) $("cpOv").classList.remove("open"); });
  $("cpForm").addEventListener("submit", async e => {
    e.preventDefault();
    const p = passProblem($("cpNew1").value, $("cpNew2").value);
    if (p) { $("cpErr").textContent = p; return; }
    $("cpSave").disabled = true; $("cpSave").textContent = "Changing…";
    try {
      const r = await Vault.changePass(st.vault, $("cpOld").value, $("cpNew1").value);
      const { error } = await sb.from("vault").update({ pass: r.pass, updated_at: new Date().toISOString() }).eq("user_id", st.user.id);
      if (error) throw error;
      st.vault.pass = r.pass;
      $("cpOv").classList.remove("open"); toast("Passphrase changed");
    } catch (err) { $("cpErr").textContent = err && err.name === "OperationError" ? "Your current passphrase isn't right." : "Couldn't save. Check your connection."; }
    finally { $("cpSave").disabled = false; $("cpSave").textContent = "Change it"; }
  });
  $("vSignOut").addEventListener("click", async () => { await Vault.forget(); await sb.auth.signOut(); });
  async function decRows(rows, legacyMap) {
    const out = [], legacy = [];
    for (const r of rows) {
      if (r.enc) { try { out.push({ ...(await Vault.dec(st.key, r.enc)), id: r.id, created_at: r.created_at }); } catch (_) { /* unreadable row: skip */ } }
      else { const p = legacyMap(r); out.push(p); legacy.push(p); }
    }
    return { out, legacy };
  }

  /* ---------- data ---------- */
  async function loadAll() {
    $("syncNote").textContent = "Loading your records…";
    render();
    if (!st.key) return;
    const [tx, set, pl, hl, tk] = await Promise.all([
      sb.from("transactions").select("*"),
      sb.from("settings").select("*").maybeSingle(),
      sb.from("plans").select("*"),
      sb.from("fx_holdings").select("*"),
      sb.from("fx_tracker").select("*")
    ]);
    if (tx.error || set.error || pl.error || hl.error || tk.error) {
      $("syncNote").textContent = "Not synced";
      banner("Couldn't load your records. Check your connection and pull down or reopen the app.");
      return;
    }
    banner("");
    const T = await decRows(tx.data, r => ({ id: r.id, created_at: r.created_at, type: r.type, amount: Number(r.amount), category: r.category, note: r.note || "", date: r.date, receipt_path: r.receipt_path }));
    const P = await decRows(pl.data, r => ({ id: r.id, created_at: r.created_at, title: r.title, amount: Number(r.amount), category: r.category, due_date: r.due_date, done: r.done, paid_tx_id: r.paid_tx_id, done_at: r.done_at, start_date: r.start_date, end_date: r.end_date, repeat: r.repeat }));
    const H = await decRows(hl.data, r => ({ id: r.id, created_at: r.created_at, ccy: r.ccy, amount: Number(r.amount), cost_mur: Number(r.cost_mur), date: r.date, note: r.note || "" }));
    const K = await decRows(tk.data, r => ({ id: r.id, created_at: r.created_at, ccy: r.ccy, amount: Number(r.amount), date: r.date, note: r.note || "" }));
    st.txs = T.out;
    st.plans = P.out.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    st.holds = H.out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    st.track = K.out.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.created_at || "").localeCompare(b.created_at || ""));
    let legacySettings = false;
    if (set.data) {
      st.hasSettingsRow = true;
      let d;
      if (set.data.enc) { try { d = await Vault.dec(st.key, set.data.enc); } catch (_) { d = null; } }
      else { legacySettings = true; d = { currency: set.data.currency, expense_cats: set.data.expense_cats, income_cats: set.data.income_cats, budgets: set.data.budgets, display_name: set.data.display_name, theme: set.data.theme, avatar: set.data.avatar, skin: set.data.skin }; }
      if (d) st.settings = { currency: d.currency || "Rs", expenseCats: d.expense_cats || clone(DEFAULTS.expenseCats), incomeCats: d.income_cats || clone(DEFAULTS.incomeCats), budgets: d.budgets || {},
        name: d.display_name || "", theme: d.theme || "blush", avatar: d.avatar || "girl", skin: d.skin || "brown" };
    }
    // Move any older unencrypted rows into the encrypted format, once.
    const toLock = [["transactions", T.legacy], ["plans", P.legacy], ["fx_holdings", H.legacy], ["fx_tracker", K.legacy]];
    if (legacySettings || toLock.some(([, l]) => l.length)) {
      (async () => {
        try {
          for (const [table, list] of toLock) for (const row of list) await putEnc(table, row);
          if (legacySettings) await saveSettings();
          toast("Your existing records are now encrypted");
        } catch (_) {}
      })();
    }
    applyLook();
    loadRates();
    $("syncNote").textContent = "Synced " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    render();
  }
  async function saveSettings() {
    await putEnc("settings", { currency: st.settings.currency, expense_cats: st.settings.expenseCats, income_cats: st.settings.incomeCats, budgets: st.settings.budgets || {},
      display_name: st.settings.name || "", theme: st.settings.theme, avatar: st.settings.avatar, skin: st.settings.skin });
    st.hasSettingsRow = true;
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && st.user && st.key) loadAll(); });

  /* ---------- render ---------- */
  function monthTx(m) { return st.txs.filter(t => (t.date || "").startsWith(m)); }
  function sums(list) { let i = 0, o = 0; for (const t of list) { if (t.type === "income") i += t.amount; else o += t.amount; } return { i, o }; }

  /* ---------- look: theme + avatar ---------- */
  function avatarSrc(kind, skin) { return "icons/avatars/" + (kind === "boy" ? "boy" : "girl") + "-" + (["deep", "brown", "tan", "light"].includes(skin) ? skin : "brown") + ".png"; }
  function applyLook() {
    const s = st.settings, theme = s.theme === "sky" ? "sky" : "blush";
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("mm-theme", theme); localStorage.setItem("mm-avatar", s.avatar + "|" + s.skin); } catch (_) {}
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = theme === "sky" ? "#EAF1FC" : "#F8F0EB";
    const src = avatarSrc(s.avatar, s.skin);
    $("meAvatar").src = src; $("authAvatar").src = src;
    const h = new Date().getHours();
    $("greet").textContent = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    $("meName").textContent = s.name || "there";
  }
  try { const a = (localStorage.getItem("mm-avatar") || "").split("|"); if (a[0]) $("authAvatar").src = avatarSrc(a[0], a[1]); } catch (_) {}

  /* ---------- tabs ---------- */
  const TABS = ["home", "journal", "plans", "rates"];
  function showTab(name, push) {
    if (!TABS.includes(name)) name = "home";
    for (const t of TABS) $("view-" + t).classList.toggle("hidden", t !== name);
    document.querySelectorAll(".tabbar [data-tab]").forEach(b => { if (b.dataset.tab === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    if (push !== false && location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    window.scrollTo(0, 0);
  }
  document.querySelector(".tabbar").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) showTab(b.dataset.tab); });
  document.addEventListener("click", e => { const g = e.target.closest("[data-go]"); if (g) showTab(g.dataset.go); });
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1), false));
  showTab(location.hash.slice(1) || "home", false);

  /* add menu */
  $("addBtn").addEventListener("click", () => $("addOv").classList.add("open"));
  $("addCancel").addEventListener("click", () => $("addOv").classList.remove("open"));
  $("addOv").addEventListener("click", e => { if (e.target === $("addOv") || e.target.closest(".addopt")) $("addOv").classList.remove("open"); });

  function txRow(t) {
    const inc = t.type === "income", col = catColor(t.category || "Other", t.type);
    return '<button class="tx" data-id="' + esc(t.id) + '"><span class="ic" style="background:color-mix(in srgb, ' + col + ' 16%, white);color:' + col + '">' + esc((t.category || "?").slice(0, 2)) + '</span>' +
      '<span style="min-width:0"><div class="t1">' + esc(t.note || t.category || "Entry") + '</div><div class="t2">' + esc(t.category || "Uncategorised") + (t.receipt_path ? " · receipt" : "") + '</div></span>' +
      '<span class="amt num ' + (inc ? "in" : "out") + '">' + (inc ? "+" : "−") + esc(money(t.amount)) + '</span></button>';
  }

  function render() {
    document.querySelectorAll(".curLbl").forEach(e => e.textContent = st.settings.currency);
    $("monthLabel").textContent = monthName(st.month, true);
    const isNow = st.month === ym(new Date());
    const cur = monthTx(st.month), prev = monthTx(shiftMonth(st.month, -1));
    const s = sums(cur), p = sums(prev);
    const net = s.i - s.o;
    const planned = plannedTotal();
    const free = net - planned;
    // home hero
    $("freeLbl").textContent = "Free to spend · " + monthName(st.month, true).split(" ")[0];
    $("freeAmt").innerHTML = (free < 0 ? "−" : "") + esc(money(Math.abs(free))).replace(/(\.\d\d)$/, "<small>$1</small>");
    $("freeAmt").style.color = free < 0 ? "var(--bad)" : "";
    $("freeSub").textContent = planned > 0 ? "after " + money(planned) + " set aside for " + openPlans().length + (openPlans().length === 1 ? " plan" : " plans") : (cur.length ? "money in minus what you spent" : "Add money in or an expense to get started");
    $("keptPill").innerHTML = s.i > 0 ? (free >= 0 ? '<span class="pill accent">' + Math.round(free / s.i * 100) + '% kept</span>' : '<span class="pill bad">Short ' + esc(money(-free)) + '</span>') : "";
    $("kIn").textContent = "+" + money(s.i).replace(st.settings.currency + " ", "");
    $("kOut").textContent = "−" + money(s.o).replace(st.settings.currency + " ", "");
    $("kPlan").textContent = money(planned).replace(st.settings.currency + " ", "");
    const diff = s.o - p.o;
    $("kOutHint").innerHTML = p.o > 0 && cur.length ? (diff > 0 ? 'Spending is <span class="bad">' + esc(money(diff)) + ' higher</span> than last month' : 'Spending is <span class="good">' + esc(money(-diff)) + ' lower</span> than last month') : "";
    // journal summary
    $("jNet").textContent = (net < 0 ? "− " : "+ ") + money(Math.abs(net));
    $("jIn").textContent = "+" + money(s.i) + " in";
    $("jOut").textContent = "−" + money(s.o) + " out";
    renderDue();
    renderWeek();
    renderHomeBudgets();
    renderRecent();
    renderPlans(net);
    renderBudgets(cur);
    renderFx(net);
    renderCats(cur, s.o);
    renderTrend();
    renderList(cur);
  }

  function renderDue() {
    const t = today();
    const due = sortPlans(openPlans()).filter(x => !isPeriod(x) && x.due_date && x.due_date <= shiftDay(t, 3));
    if (!due.length) { $("dueAlert").innerHTML = ""; return; }
    const x = due[0], late = x.due_date < t;
    $("dueAlert").innerHTML = '<div class="due"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>' +
      '<div><b>' + esc(x.title) + ' · ' + esc(money(x.amount)) + '</b><span>' + (late ? "Plan was due " : "Plan due ") + esc(new Date(x.due_date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })) + (due.length > 1 ? " · " + (due.length - 1) + " more" : "") + '</span></div>' +
      '<button type="button" data-paid="' + esc(x.id) + '">Mark paid</button></div>';
  }
  function shiftDay(d, n) { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return ym(x) + "-" + String(x.getDate()).padStart(2, "0"); }
  $("dueAlert").addEventListener("click", async e => {
    const b = e.target.closest("[data-paid]"); if (!b) return;
    const x = st.plans.find(p => p.id === b.dataset.paid); if (!x) return;
    try { await setPlanDone(x.id, true); render(); toast("Paid · " + x.title); } catch (_) { toast("Couldn't update. Check your connection."); }
  });

  function renderWeek() {
    const t = today(), days = [];
    for (let k = 6; k >= 0; k--) { const d = shiftDay(t, -k); days.push({ d, v: st.txs.filter(x => x.type !== "income" && x.date === d).reduce((a, x) => a + x.amount, 0) }); }
    const total = days.reduce((a, x) => a + x.v, 0);
    $("weekSub").textContent = money(total) + " spent";
    const W = 330, top = 10, base = 88, rawMax = Math.max(1, ...days.map(x => x.v));
    const mag = Math.pow(10, Math.floor(Math.log10(rawMax))), max = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= rawMax);
    const pts = days.map((x, i) => [i * (W / 6), base - (x.v / max) * (base - top)]);
    let d = "M" + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
    for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; d += " C" + cx.toFixed(1) + " " + y0.toFixed(1) + " " + cx.toFixed(1) + " " + y1.toFixed(1) + " " + x1.toFixed(1) + " " + y1.toFixed(1); }
    let pk = 0; days.forEach((x, i) => { if (x.v > days[pk].v) pk = i; });
    const label = total > 0 ? "Spending over the last 7 days, highest " + new Date(days[pk].d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long" }) + " at " + money(days[pk].v) : "No spending in the last 7 days";
    $("weekChart").innerHTML = '<div class="week"><svg viewBox="-6 0 342 98" role="img" aria-label="' + esc(label) + '">' +
      '<line x1="0" x2="330" y1="' + base + '" y2="' + base + '" stroke="var(--line)"/><line x1="0" x2="330" y1="' + ((base + top) / 2) + '" y2="' + ((base + top) / 2) + '" stroke="var(--line)" stroke-dasharray="3 4"/>' +
      '<text x="330" y="' + ((base + top) / 2 - 4) + '" text-anchor="end" font-size="10" fill="var(--muted)">' + esc(shortMoney(max / 2)) + '</text>' +
      '<path d="' + d + ' L330 ' + base + ' L0 ' + base + ' Z" fill="var(--accent)" opacity="0.13"/>' +
      '<path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>' +
      (total > 0 ? '<circle cx="' + pts[pk][0].toFixed(1) + '" cy="' + pts[pk][1].toFixed(1) + '" r="5" fill="var(--surface)" stroke="var(--accent)" stroke-width="2.4"><title>' + esc(money(days[pk].v)) + '</title></circle>' : "") +
      '</svg><div class="weekdays">' + days.map((x, i) => '<span' + (i === pk && total > 0 ? ' class="on"' : "") + '>' + new Date(x.d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" }) + '</span>').join("") + '</div></div>';
  }

  function renderHomeBudgets() {
    const per = sortPlans(openPlans().filter(x => isPeriod(x) && planWindow(x).status === "active"));
    const perHtml = per.map(x => {
      const w = planWindow(x), spent = planSpent(x, w), left = x.amount - spent, pct = Math.min(100, spent / x.amount * 100);
      const col = left < 0 ? "var(--bad)" : pct >= 80 ? "var(--warn)" : "var(--good)";
      return '<button type="button" class="budget" data-go="plans"><div class="bt"><span class="name"><span class="dot" style="background:' + catColor(x.category, "expense") + '"></span>' + esc(x.title) + '</span><span class="st">' +
        (left >= 0 ? '<b class="num" style="color:' + col + '">' + esc(money(left)) + '</b> left' : '<b class="num" style="color:var(--bad)">Over by ' + esc(money(-left)) + '</b>') + '</span></div>' +
        '<div class="bar"><i style="width:' + Math.max(spent > 0 ? 2 : 0, pct) + '%;background:' + col + '"></i></div><span class="bs">Until ' + esc(new Date(w.e + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long" })) + '</span></button>';
    }).join("");
    const b = st.settings.budgets || {}, m = ym(new Date());
    const rows = Object.keys(b).filter(c => Number(b[c]) > 0).map(c => ({ c, ...budgetState(c, m) })).sort((a, z) => z.pct - a.pct).slice(0, 3);
    if (!rows.length && !perHtml) { $("homeBudgets").innerHTML = '<div class="empty">No budgets yet. <button type="button" class="link" data-go="plans">Set one in Plans</button></div>'; return; }
    $("homeBudgets").innerHTML = perHtml + rows.map(r => {
      const col = r.level === "over" ? "var(--bad)" : r.level === "warn" ? "var(--warn)" : "var(--good)";
      return '<button type="button" class="budget" data-go="plans"><div class="bt"><span class="name"><span class="dot" style="background:' + catColor(r.c, "expense") + '"></span>' + esc(r.c) + '</span><span class="st">' +
        (r.left >= 0 ? '<b class="num" style="color:' + col + '">' + esc(money(r.left)) + '</b> left' : '<b class="num" style="color:var(--bad)">Over by ' + esc(money(-r.left)) + '</b>') + '</span></div>' +
        '<div class="bar"><i style="width:' + Math.min(100, Math.max(r.spent > 0 ? 2 : 0, r.pct * 100)) + '%;background:' + col + '"></i></div></button>';
    }).join("");
  }
  function renderRecent() {
    const list = [...st.txs].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.created_at || "").localeCompare(a.created_at || "")).slice(0, 4);
    $("recent").innerHTML = list.length ? list.map(txRow).join("") : '<div class="empty">Nothing yet. Tap + to add money in, an expense or a receipt.</div>';
  }
  $("recent").addEventListener("click", e => { const b = e.target.closest(".tx"); if (!b) return; const t = st.txs.find(x => x.id === b.dataset.id); if (t) openEntry({ tx: t }); });

  function renderCats(cur, total) {
    const by = {};
    for (const t of cur) if (t.type !== "income") by[t.category || "Other"] = (by[t.category || "Other"] || 0) + t.amount;
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
    $("catSub").textContent = rows.length ? rows.length + " categories" : "";
    if (!rows.length) { $("cats").innerHTML = '<div class="empty">No spending logged for ' + esc(monthName(st.month, true)) + '. Snap a receipt or add an expense to see your breakdown.</div>'; return; }
    const max = rows[0][1];
    $("cats").innerHTML = rows.map(([c, v]) => {
      const col = catColor(c, "expense");
      return '<div class="catrow"><div class="name"><span class="dot" style="background:' + col + '"></span><span title="' + esc(c) + '">' + esc(c) + '</span></div>' +
        '<div class="bar"><i style="width:' + Math.max(2, v / max * 100) + '%;background:' + col + '"></i></div>' +
        '<div class="amt num">' + esc(money(v)) + '<span class="pct">' + Math.round(v / total * 100) + '%</span></div></div>';
    }).join("");
  }

  function renderTrend() {
    const months = []; for (let k = 5; k >= 0; k--) months.push(shiftMonth(st.month, -k));
    const data = months.map(m => ({ m, ...sums(monthTx(m)) }));
    const rawMax = Math.max(1, ...data.map(d => Math.max(d.i, d.o)));
    const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
    const max = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= rawMax);
    const W = 560, H = 220, L = 44, R = 8, T = 10, B = 28, cw = (W - L - R) / 6, bw = Math.min(22, cw * 0.3);
    const y = v => T + (H - T - B) * (1 - v / max);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Money in and spent over the last six months">';
    for (const f of [0, .5, 1]) {
      const yy = y(max * f);
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="var(--line)" stroke-width="1"/>';
      svg += '<text x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono, monospace">' + shortMoney(max * f) + '</text>';
    }
    data.forEach((d, idx) => {
      const cx = L + cw * idx + cw / 2, sel = d.m === st.month;
      if (sel) svg += '<rect x="' + (L + cw * idx + 2) + '" y="' + T + '" width="' + (cw - 4) + '" height="' + (H - T - B) + '" rx="6" fill="var(--accent-soft)"/>';
      const hi = Math.max(d.i > 0 ? 2 : 0, y(0) - y(d.i)), ho = Math.max(d.o > 0 ? 2 : 0, y(0) - y(d.o));
      svg += '<rect x="' + (cx - bw - 1) + '" y="' + (y(0) - hi) + '" width="' + bw + '" height="' + hi + '" rx="3" fill="var(--income)"><title>' + esc(monthName(d.m) + " in: " + money(d.i)) + '</title></rect>';
      svg += '<rect x="' + (cx + 1) + '" y="' + (y(0) - ho) + '" width="' + bw + '" height="' + ho + '" rx="3" fill="var(--expense)"><title>' + esc(monthName(d.m) + " spent: " + money(d.o)) + '</title></rect>';
      svg += '<text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle" font-size="12" fill="' + (sel ? "var(--accent)" : "var(--muted)") + '" font-weight="' + (sel ? 700 : 500) + '">' + MONTHS[Number(d.m.slice(5)) - 1] + '</text>';
    });
    $("trend").innerHTML = svg + '</svg>';
  }

  function renderList(cur) {
    const q = st.q.trim().toLowerCase();
    const list = cur.filter(t => (st.filter === "all" || (st.filter === "income") === (t.type === "income")) &&
      (!q || (t.note || "").toLowerCase().includes(q) || (t.category || "").toLowerCase().includes(q)))
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.created_at || "").localeCompare(a.created_at || ""));
    $("txCount").textContent = plural(list.length);
    if (!list.length) {
      $("txList").innerHTML = '<div class="empty">' + (cur.length ? "Nothing matches that filter." : "No entries in " + esc(monthName(st.month, true)) + " yet.<br>Tap + to add money in, an expense or a receipt.") + '</div>';
      return;
    }
    const groups = new Map();
    for (const t of list) { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); }
    let html = "";
    for (const [date, items] of groups) {
      const d = new Date(date + "T12:00:00");
      const label = date === today() ? "Today" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
      const dayNet = items.reduce((a, t) => a + (t.type === "income" ? t.amount : -t.amount), 0);
      html += '<div class="daygroup"><div class="dayhead"><span style="text-transform:uppercase;letter-spacing:.06em">' + esc(label) + '</span><span class="num">' + (dayNet < 0 ? "−" : "+") + esc(money(Math.abs(dayNet))) + '</span></div>';
      for (const t of items) html += txRow(t);
      html += '</div>';
    }
    $("txList").innerHTML = html;
  }




  /* ---------- currencies ---------- */
  const FX = [
    { ccy: "USD", name: "US dollar", sym: "$", src: "mcb" },
    { ccy: "EUR", name: "Euro", sym: "€", src: "mcb" },
    { ccy: "GBP", name: "British pound", sym: "£", src: "mcb" },
    { ccy: "GHS", name: "Ghana cedi", sym: "GH₵", src: "market" }
  ];
  function muToday() { return new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10); }
  async function loadRates() {
    const since = new Date(Date.now() - 40 * 86400e3).toISOString().slice(0, 10);
    const { data, error } = await sb.from("fx_rates").select("day,ccy,source,buy,sell,mid").gte("day", since).in("ccy", FX.map(f => f.ccy)).order("day", { ascending: true });
    if (error) return;
    st.fx = data.map(r => ({ ...r, buy: r.buy == null ? null : Number(r.buy), sell: r.sell == null ? null : Number(r.sell), mid: Number(r.mid) }));
    render();
    const t = muToday();
    if (!st.fxTried && FX.some(f => !st.fx.some(r => r.ccy === f.ccy && r.source === f.src && r.day === t))) {
      st.fxTried = true;
      try { const { data: res } = await sb.functions.invoke("fetch-rates", { body: {} }); st.fxStatus = res || null; } catch (_) {}
      const again = await sb.from("fx_rates").select("day,ccy,source,buy,sell,mid").gte("day", since).in("ccy", FX.map(f => f.ccy)).order("day", { ascending: true });
      if (!again.error) st.fx = again.data.map(r => ({ ...r, buy: r.buy == null ? null : Number(r.buy), sell: r.sell == null ? null : Number(r.sell), mid: Number(r.mid) }));
      render();
    }
  }
  function series(f) { return st.fx.filter(r => r.ccy === f.ccy && r.source === f.src); }
  function changeSince(ser, days) {
    if (ser.length < 2) return null;
    const last = ser[ser.length - 1];
    const target = new Date(new Date(last.day + "T12:00:00").getTime() - days * 86400e3).toISOString().slice(0, 10);
    let base = null; for (const r of ser) { if (r.day <= target) base = r; }
    if (!base) { if (days > 7 && ser[0].day < last.day) base = ser[0]; else return null; }
    if (base === last) return null;
    return { pct: (last.mid - base.mid) / base.mid * 100, from: base.day };
  }
  function spark(ser) {
    if (ser.length < 2) return "";
    const W = 96, H = 28, vals = ser.map(r => r.mid), min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
    const t0 = new Date(ser[0].day).getTime(), t1 = new Date(ser[ser.length - 1].day).getTime() || t0 + 1;
    const pts = ser.map(r => [((new Date(r.day).getTime() - t0) / ((t1 - t0) || 1)) * (W - 4) + 2, H - 3 - ((r.mid - min) / rng) * (H - 6)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const up = vals[vals.length - 1] >= vals[0], col = up ? "var(--expense)" : "var(--income)";
    const last = pts[pts.length - 1];
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><path d="' + d + ' L' + last[0].toFixed(1) + ' ' + H + ' L2 ' + H + ' Z" fill="' + col + '" opacity=".12"/><path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linejoin="round"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.4" fill="' + col + '"/></svg>';
  }
  function pctPill(c, label) {
    if (!c || Math.abs(c.pct) < 0.005) return c ? '<span class="pill">' + label + ' no change</span>' : "";
    // A foreign currency going up means the rupee got weaker against it.
    return '<span class="pill ' + (c.pct > 0 ? "bad" : "good") + '">' + (c.pct > 0 ? "▲ " : "▼ ") + Math.abs(c.pct).toFixed(2) + "% " + label + '</span>';
  }
  function fmtF(n, f) { return f.sym + (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function latest(f) { const s = series(f); return s.length ? s[s.length - 1] : null; }
  function renderFx(net) {
    const have = FX.map(f => ({ f, ser: series(f), last: latest(f) })).filter(x => x.last);
    if (!have.length) {
      const miss = st.fxStatus && st.fxStatus.missing_keys && st.fxStatus.missing_keys.length;
      $("fxSub").textContent = "";
      $("fxList").innerHTML = '<div class="empty">' + (miss ? "Exchange rates switch on once the rate API keys are added in Supabase." : st.fxTried ? "Couldn't get today's rates yet. They update every morning." : "Loading exchange rates…") + '</div>';
      $("fxConv").classList.add("hidden");
      renderHolds();
      renderTracker();
      return;
    }
    const newest = have.map(x => x.last.day).sort().pop();
    $("fxSub").textContent = "Rates of " + new Date(newest + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const cur = st.settings.currency;
    let html = have.map(({ f, ser, last }) => {
      const w = changeSince(ser, 7), m = changeSince(ser, 30);
      const detail = f.src === "mcb" ? "MCB buys at " + last.buy.toFixed(2) + " · sells at " + last.sell.toFixed(2) : "Market rate (no MCB rate for cedi)";
      return '<div class="fx"><div class="fxl"><div class="fxc"><b>' + f.ccy + '</b> <span>' + esc(f.name) + '</span></div>' +
        '<div class="fxv num">1 ' + f.ccy + ' = ' + esc(cur) + ' ' + last.mid.toFixed(f.ccy === "GHS" ? 3 : 2) + '</div>' +
        '<div class="fxp">' + (pctPill(w, "week") + " " + pctPill(m, "month")).trim() + (!w && !m ? '<span class="sub">Change shows after a few days of rates</span>' : "") + '</div>' +
        '<div class="sub">' + esc(detail) + '</div></div>' + spark(ser.slice(-31)) + '</div>';
    }).join("");
    if (net > 0) {
      const parts = have.map(({ f, last }) => fmtF(net / (f.src === "mcb" ? last.sell : last.mid), f));
      html += '<div class="plansum" style="margin-top:10px"><span>This month\'s left over <b class="num">' + esc(money(net)) + '</b> is worth about <b class="num">' + esc(parts.join(" · ")) + '</b></span></div>';
    }
    html += '<div class="sub" style="margin-top:6px">▲ red means that currency got more expensive, so your rupees buy less of it. ▼ green means your rupees buy more.</div>';
    $("fxList").innerHTML = html;
    // converter
    const opts = ["MUR", ...have.map(x => x.f.ccy)];
    const keepFrom = $("cvFrom").value || "MUR", keepTo = $("cvTo").value || have[0].f.ccy;
    const optHtml = opts.map(c => '<option value="' + c + '">' + c + '</option>').join("");
    if ($("cvFrom").dataset.opts !== opts.join()) {
      $("cvFrom").innerHTML = optHtml; $("cvTo").innerHTML = optHtml;
      $("cvFrom").dataset.opts = opts.join();
      $("cvFrom").value = opts.includes(keepFrom) ? keepFrom : "MUR";
      $("cvTo").value = opts.includes(keepTo) && keepTo !== $("cvFrom").value ? keepTo : opts.find(c => c !== $("cvFrom").value);
    }
    $("fxConv").classList.remove("hidden");
    convert();
    renderHolds();
    renderTracker();
  }
  function convert() {
    const amt = parseFloat(String($("cvAmt").value).replace(/[^0-9.]/g, ""));
    const from = $("cvFrom").value, to = $("cvTo").value;
    if (!(amt > 0) || !from || !to) { $("cvOut").textContent = "Type an amount to see what you'd get."; return; }
    if (from === to) { $("cvOut").textContent = "Pick two different currencies."; return; }
    const meta = c => FX.find(f => f.ccy === c);
    // MUR value of what you hand over: the bank BUYS your foreign currency (buy rate).
    let mur = amt, used = [];
    if (from !== "MUR") { const f = meta(from), r = latest(f); const rate = f.src === "mcb" ? r.buy : r.mid; mur = amt * rate; used.push(from + " at " + rate.toFixed(3) + (f.src === "mcb" ? " (MCB buys)" : " (market)")); }
    let outAmt = mur, outTxt;
    if (to === "MUR") outTxt = money(mur);
    else { const f = meta(to), r = latest(f); const rate = f.src === "mcb" ? r.sell : r.mid; outAmt = mur / rate; outTxt = fmtF(outAmt, f); used.push(to + " at " + rate.toFixed(3) + (f.src === "mcb" ? " (MCB sells)" : " (market)")); }
    $("cvOut").innerHTML = '<b class="num">' + esc(outTxt) + '</b><span class="sub"> · using ' + esc(used.join(", ")) + '</span>';
  }
  $("cvAmt").addEventListener("input", convert);
  $("cvFrom").addEventListener("change", () => { if ($("cvFrom").value === $("cvTo").value) $("cvTo").value = [...$("cvTo").options].map(o => o.value).find(c => c !== $("cvFrom").value); convert(); });
  $("cvTo").addEventListener("change", convert);



  /* ---------- currency tracker ---------- */
  const TRK = [{ ccy: "MUR", name: "Mauritian rupee", sym: "Rs ", src: null }, ...FX];
  const trkMeta = c => TRK.find(x => x.ccy === c) || { ccy: c, name: c, sym: c + " ", src: null };
  // MUR value of 1 unit of ccy (mid rate), on a given day (latest known on or before it), or now.
  function murRate(ccy, day) {
    if (ccy === "MUR") return 1;
    const f = FX.find(x => x.ccy === ccy); if (!f) return null;
    const ser = series(f); if (!ser.length) return null;
    if (!day) return ser[ser.length - 1].mid;
    let r = null; for (const x of ser) { if (x.day <= day) r = x; }
    return r ? r.mid : null;
  }
  function fmtC(n, ccy) {
    const m = trkMeta(ccy), v = (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return ccy === "MUR" ? money(n) : m.sym + v;
  }
  function trkBalances() {
    const by = {};
    for (const e of st.track) by[e.ccy] = (by[e.ccy] || 0) + e.amount;
    const order = [];
    for (const e of st.track) if (!order.includes(e.ccy)) order.push(e.ccy);
    return order.map(c => ({ ccy: c, bal: Math.round(by[c] * 100) / 100 }));
  }
  function renderTracker() {
    const bals = trkBalances();
    if (!bals.length) {
      $("trackList").innerHTML = '<div class="empty">Enter an amount once, like €200, and keep watching what it\'s worth in rupees, dollars, cedis and pounds as rates change. Add more whenever you receive it.</div>';
      return;
    }
    const newest = st.fx.length ? st.fx[st.fx.length - 1].day : null;
    const weekAgo = newest ? shiftDay(newest, -7) : null;
    $("trackList").innerHTML = bals.map(({ ccy, bal }) => {
      const m = trkMeta(ccy), rNow = murRate(ccy), entries = st.track.filter(e => e.ccy === ccy);
      const targets = TRK.filter(t => t.ccy !== ccy);
      const tiles = targets.map(t => {
        const tNow = murRate(t.ccy);
        if (!(rNow > 0) || !(tNow > 0)) return '<div class="trkv"><span>' + esc(t.ccy) + '</span><b class="sub">no rate yet</b></div>';
        const v = bal * rNow / tNow;
        const rOld = weekAgo ? murRate(ccy, weekAgo) : null, tOld = weekAgo ? murRate(t.ccy, weekAgo) : null;
        let ch = "";
        if (rOld > 0 && tOld > 0 && bal !== 0) {
          const old = bal * rOld / tOld, pct = (v - old) / Math.abs(old) * 100;
          ch = Math.abs(pct) < 0.005 ? '<i class="sub">no change this week</i>' :
            '<i class="' + (pct > 0 ? "good" : "bad") + '">' + (pct > 0 ? "▲ +" : "▼ −") + esc(fmtC(Math.abs(v - old), t.ccy)) + ' this week</i>';
        }
        return '<div class="trkv"><span>in ' + esc(t.name) + '</span><b class="num">' + esc(fmtC(v, t.ccy)) + '</b>' + ch + '</div>';
      }).join("");
      const hist = [...entries].reverse().map(e => '<button type="button" class="trkrow" data-trk="' + esc(e.id) + '"><span>' + esc(new Date(e.date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })) + (e.note ? " · " + esc(e.note) : "") + '</span><b class="num ' + (e.amount > 0 ? "good" : "bad") + '">' + (e.amount > 0 ? "+" : "−") + esc(fmtC(Math.abs(e.amount), ccy)) + '</b></button>').join("");
      return '<div class="trk"><div class="trkhead"><div class="trkbal"><span class="sub">' + esc(m.name) + ' balance</span><b class="display num">' + esc(fmtC(bal, ccy)) + '</b></div>' +
        '<div class="trkbtns"><button type="button" class="addbtn" data-trkadd="' + ccy + '" aria-label="Add ' + esc(m.name) + ' received">+ Add</button><button type="button" data-trkout="' + ccy + '" aria-label="Take ' + esc(m.name) + ' out">−</button></div></div>' +
        '<div class="trkgrid">' + tiles + '</div>' +
        '<details class="trkhist"><summary>History (' + entries.length + ')</summary>' + hist + '</details></div>';
    }).join("") + '<div class="sub" style="margin-top:8px;font-size:12px">Values use mid rates (MCB for USD, EUR and GBP; market rate for GHS). "This week" compares with rates from 7 days earlier.</div>';
  }
  const tk = { id: null, ccy: "EUR", dir: "in" };
  function renderTrkChips() {
    $("trkCcy").innerHTML = TRK.map(t => '<button type="button" class="chip" data-c="' + t.ccy + '" aria-pressed="' + (t.ccy === tk.ccy) + '">' + t.ccy + '</button>').join("");
    document.querySelectorAll("#trkDir button").forEach(b => b.classList.toggle("on", b.dataset.d === tk.dir));
    $("trkAmtLbl").textContent = "Amount (" + tk.ccy + ")";
    trkHint();
  }
  function trkHint() {
    const bal = (trkBalances().find(b => b.ccy === tk.ccy) || { bal: 0 }).bal;
    const orig = tk.id ? st.track.find(e => e.id === tk.id) : null;
    const base = bal - (orig ? orig.amount : 0);
    const amt = parseFloat(String($("trkAmt").value).replace(/[^0-9.]/g, "")) || 0;
    const after = base + (tk.dir === "in" ? amt : -amt);
    $("trkHint").textContent = (base !== 0 || amt > 0) ? "Balance " + fmtC(base, tk.ccy) + (amt > 0 ? " → " + fmtC(after, tk.ccy) : "") : "";
  }
  function openTrk(opts) {
    const e = opts && opts.entry;
    tk.id = e ? e.id : null;
    tk.ccy = e ? e.ccy : (opts && opts.ccy) || (trkBalances()[0] || {}).ccy || "EUR";
    tk.dir = e ? (e.amount > 0 ? "in" : "out") : (opts && opts.dir) || "in";
    $("trkTitle").textContent = e ? "Edit entry" : tk.dir === "out" ? "Take out of your tracker" : "Add to your tracker";
    $("trkAmt").value = e ? String(Math.abs(e.amount)) : "";
    $("trkDate").value = e ? e.date : today();
    $("trkNote").value = e ? e.note : "";
    $("trkErr").textContent = "";
    $("trkDel").classList.toggle("hidden", !e);
    renderTrkChips();
    $("trkOv").classList.add("open");
    if (!e) setTimeout(() => $("trkAmt").focus(), 50);
  }
  function closeTrk() { $("trkOv").classList.remove("open"); }
  $("addTrack").addEventListener("click", () => openTrk({ ccy: trkBalances().length ? undefined : "EUR" }));
  $("trackList").addEventListener("click", e => {
    const a = e.target.closest("[data-trkadd]"); if (a) return openTrk({ ccy: a.dataset.trkadd, dir: "in" });
    const o = e.target.closest("[data-trkout]"); if (o) return openTrk({ ccy: o.dataset.trkout, dir: "out" });
    const r = e.target.closest("[data-trk]"); if (r) { const en = st.track.find(x => x.id === r.dataset.trk); if (en) openTrk({ entry: en }); }
  });
  $("trkCcy").addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (!b) return; tk.ccy = b.dataset.c; renderTrkChips(); });
  $("trkDir").addEventListener("click", e => { const b = e.target.closest("[data-d]"); if (!b) return; tk.dir = b.dataset.d; renderTrkChips(); });
  $("trkAmt").addEventListener("input", trkHint);
  $("trkCancel").addEventListener("click", closeTrk);
  $("trkOv").addEventListener("click", e => { if (e.target === $("trkOv")) closeTrk(); });
  $("trkForm").addEventListener("submit", async e => {
    e.preventDefault();
    const amt = parseFloat(String($("trkAmt").value).replace(/[^0-9.]/g, ""));
    if (!(amt > 0)) { $("trkErr").textContent = "Enter an amount above zero."; $("trkAmt").focus(); return; }
    if (!$("trkDate").value) { $("trkErr").textContent = "Pick the date."; return; }
    const bal = (trkBalances().find(b => b.ccy === tk.ccy) || { bal: 0 }).bal;
    const orig = tk.id ? st.track.find(x => x.id === tk.id) : null;
    const signed = Math.round((tk.dir === "in" ? amt : -amt) * 100) / 100;
    if (bal - (orig ? orig.amount : 0) + signed < -0.004) { $("trkErr").textContent = "That's more than your " + tk.ccy + " balance of " + fmtC(bal - (orig ? orig.amount : 0), tk.ccy) + "."; return; }
    const row = { ccy: tk.ccy, amount: signed, date: $("trkDate").value, note: $("trkNote").value.trim().slice(0, 80) };
    $("trkSave").disabled = true;
    try {
      const saved = { ...(orig || {}), ...row, id: tk.id || uuid(), created_at: orig ? orig.created_at : new Date().toISOString() };
      await putEnc("fx_tracker", saved);
      st.track = (tk.id ? st.track.map(x => x.id === tk.id ? saved : x) : [...st.track, saved]).sort((a, b) => a.date.localeCompare(b.date) || (a.created_at || "").localeCompare(b.created_at || ""));
      closeTrk(); render();
      const nb = trkBalances().find(b => b.ccy === saved.ccy);
      toast((tk.id ? "Updated" : signed > 0 ? "Added " + fmtC(signed, saved.ccy) : "Took out " + fmtC(-signed, saved.ccy)) + " · balance " + fmtC(nb ? nb.bal : 0, saved.ccy));
    } catch (err) { $("trkErr").textContent = "Couldn't save. Check your connection and try again."; }
    finally { $("trkSave").disabled = false; }
  });
  $("trkDel").addEventListener("click", async () => {
    if ($("trkDel").dataset.confirm !== "1") { $("trkDel").dataset.confirm = "1"; $("trkDel").textContent = "Tap again to delete"; setTimeout(() => { $("trkDel").dataset.confirm = ""; $("trkDel").textContent = "Delete entry"; }, 3000); return; }
    $("trkDel").dataset.confirm = ""; $("trkDel").textContent = "Delete entry";
    const { error } = await sb.from("fx_tracker").delete().eq("id", tk.id);
    if (error) { $("trkErr").textContent = "Couldn't delete. Try again."; return; }
    st.track = st.track.filter(x => x.id !== tk.id); closeTrk(); render(); toast("Entry deleted");
  });

  /* ---------- my foreign money ---------- */
  function valueNow(hd) {
    const f = FX.find(x => x.ccy === hd.ccy), r = f && latest(f);
    if (!r) return null;
    const rate = f.src === "mcb" ? r.buy : r.mid; // what you'd get changing it back to rupees today
    return { rate, value: hd.amount * rate, src: f.src, day: r.day };
  }
  function gainHtml(g, base) {
    if (Math.abs(g) < 0.005) return '<span class="pill">no change</span>';
    return '<span class="pill ' + (g > 0 ? "good" : "bad") + '">' + (g > 0 ? "▲ +" : "▼ −") + esc(money(Math.abs(g))) + " (" + (g > 0 ? "+" : "−") + Math.abs(g / base * 100).toFixed(1) + '%)</span>';
  }
  function renderHolds() {
    if (!st.holds.length) { $("holdList").innerHTML = '<div class="empty" style="padding:8px 0">When you change rupees into dollars, pounds or cedis, add it here to see each day if it has gained or lost value.</div>'; return; }
    let totCost = 0, totVal = 0, allValued = true;
    const rows = st.holds.map(hd => {
      const f = FX.find(x => x.ccy === hd.ccy) || { sym: hd.ccy + " ", ccy: hd.ccy };
      const v = valueNow(hd), boughtAt = hd.cost_mur / hd.amount;
      totCost += hd.cost_mur; if (v) totVal += v.value; else allValued = false;
      const when = new Date(hd.date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      return '<button type="button" class="holdrow" data-h="' + esc(hd.id) + '">' +
        '<div class="hr1"><b class="num">' + esc(fmtF(hd.amount, f)) + '</b>' + (v ? '<span>now worth <b class="num">' + esc(money(v.value)) + '</b></span>' : '<span class="sub">no rate yet</span>') + '</div>' +
        '<div class="hr2">' + (v ? gainHtml(v.value - hd.cost_mur, hd.cost_mur) : "") + '<span class="sub">paid ' + esc(money(hd.cost_mur)) + ' on ' + esc(when) + ' (Rs ' + boughtAt.toFixed(2) + ' each)' + (v ? ' · today Rs ' + v.rate.toFixed(2) + (v.src === "mcb" ? " at MCB" : " market") : "") + (hd.note ? " · " + esc(hd.note) : "") + '</span></div></button>';
    }).join("");
    const g = totVal - totCost;
    const total = st.holds.length > 1 && allValued ? '<div class="plansum"><span>Paid <b class="num">' + esc(money(totCost)) + '</b></span><span>Worth now <b class="num">' + esc(money(totVal)) + '</b></span><span class="free">' + gainHtml(g, totCost) + '</span></div>' : "";
    $("holdList").innerHTML = total + rows + '<div class="sub" style="margin-top:6px">"Worth now" is what MCB would give you today to change it back to rupees (its buy rate).</div>';
  }
  const he = { id: null, ccy: "USD" };
  function renderHoldChips() {
    $("hCcy").innerHTML = FX.map(f => '<button type="button" class="chip" data-c="' + f.ccy + '" aria-pressed="' + (f.ccy === he.ccy) + '">' + f.ccy + ' · ' + esc(f.name) + '</button>').join("");
    $("hAmtLbl").textContent = "I got (" + he.ccy + ")";
    holdHint();
  }
  function holdHint() {
    const cost = parseFloat(String($("hCost").value).replace(/[^0-9.]/g, "")), amt = parseFloat(String($("hAmt").value).replace(/[^0-9.]/g, ""));
    const f = FX.find(x => x.ccy === he.ccy), r = latest(f);
    const parts = [];
    if (cost > 0 && amt > 0) parts.push("You paid Rs " + (cost / amt).toFixed(f.ccy === "GHS" ? 3 : 2) + " per " + f.ccy + ".");
    if (r) {
      const rate = f.src === "mcb" ? r.sell : r.mid;
      parts.push("Today " + (f.src === "mcb" ? "MCB sells " : "the market rate is ") + f.ccy + " at Rs " + rate.toFixed(f.ccy === "GHS" ? 3 : 2) + (cost > 0 && !(amt > 0) ? ", so about " + fmtF(cost / rate, f) + " for that amount" : "") + ".");
    }
    $("hHint").textContent = parts.join(" ");
  }
  function openHold(hd) {
    he.id = hd ? hd.id : null; he.ccy = hd ? hd.ccy : (he.ccy || "USD");
    $("holdTitle").textContent = hd ? "Edit exchange" : "Record an exchange";
    $("hCost").value = hd ? String(hd.cost_mur) : ""; $("hAmt").value = hd ? String(hd.amount) : "";
    $("hDate").value = hd ? hd.date : today(); $("hNote").value = hd ? hd.note : "";
    $("hErr").textContent = ""; $("hDel").classList.toggle("hidden", !hd);
    renderHoldChips();
    $("holdOv").classList.add("open");
    if (!hd) setTimeout(() => $("hCost").focus(), 50);
  }
  function closeHold() { $("holdOv").classList.remove("open"); }
  $("addHold").addEventListener("click", () => openHold(null));
  $("holdList").addEventListener("click", e => { const b = e.target.closest("[data-h]"); if (!b) return; const hd = st.holds.find(x => x.id === b.dataset.h); if (hd) openHold(hd); });
  $("hCcy").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; he.ccy = b.dataset.c; renderHoldChips(); });
  $("hCost").addEventListener("input", holdHint); $("hAmt").addEventListener("input", holdHint);
  $("hCancel").addEventListener("click", closeHold);
  $("holdOv").addEventListener("click", e => { if (e.target === $("holdOv")) closeHold(); });
  $("holdForm").addEventListener("submit", async e => {
    e.preventDefault();
    const cost = parseFloat(String($("hCost").value).replace(/[^0-9.]/g, "")), amt = parseFloat(String($("hAmt").value).replace(/[^0-9.]/g, ""));
    if (!(cost > 0)) { $("hErr").textContent = "Enter how many rupees you paid."; $("hCost").focus(); return; }
    if (!(amt > 0)) { $("hErr").textContent = "Enter how much " + he.ccy + " you got."; $("hAmt").focus(); return; }
    if (!$("hDate").value) { $("hErr").textContent = "Pick the date."; return; }
    const row = { ccy: he.ccy, amount: Math.round(amt * 100) / 100, cost_mur: Math.round(cost * 100) / 100, date: $("hDate").value, note: $("hNote").value.trim().slice(0, 80) };
    $("hSave").disabled = true;
    try {
      const prev = he.id ? st.holds.find(x => x.id === he.id) : null;
      const saved = { ...row, id: he.id || uuid(), created_at: prev ? prev.created_at : new Date().toISOString() };
      await putEnc("fx_holdings", saved);
      st.holds = (he.id ? st.holds.map(x => x.id === he.id ? saved : x) : [saved, ...st.holds]).sort((a, b) => b.date.localeCompare(a.date));
      closeHold(); render(); toast(he.id ? "Updated" : "Saved · " + fmtF(saved.amount, FX.find(f => f.ccy === saved.ccy)));
    } catch (err) { $("hErr").textContent = "Couldn't save. Try again."; }
    finally { $("hSave").disabled = false; }
  });
  $("hDel").addEventListener("click", async () => {
    if ($("hDel").dataset.confirm !== "1") { $("hDel").dataset.confirm = "1"; $("hDel").textContent = "Tap again to delete"; setTimeout(() => { $("hDel").dataset.confirm = ""; $("hDel").textContent = "Delete"; }, 3000); return; }
    $("hDel").dataset.confirm = ""; $("hDel").textContent = "Delete";
    const { error } = await sb.from("fx_holdings").delete().eq("id", he.id);
    if (error) { $("hErr").textContent = "Couldn't delete. Try again."; return; }
    st.holds = st.holds.filter(x => x.id !== he.id); closeHold(); render(); toast("Deleted");
  });

  /* ---------- budgets ---------- */
  function spentIn(cat, m) { return monthTx(m).filter(t => t.type !== "income" && t.category === cat).reduce((a, t) => a + t.amount, 0); }
  function budgetState(cat, m) {
    const limit = Number((st.settings.budgets || {})[cat]); if (!(limit > 0)) return null;
    const spent = spentIn(cat, m), left = limit - spent, pct = spent / limit;
    return { limit, spent, left, pct, level: pct > 1 ? "over" : pct >= 0.8 ? "warn" : "ok" };
  }
  function renderBudgets() {
    const b = st.settings.budgets || {};
    const cats = Object.keys(b).filter(c => Number(b[c]) > 0);
    if (!cats.length) { $("budgetList").innerHTML = '<div class="empty">No budgets yet. Set one for something like Transport, and every transport expense will count down from it.</div>'; return; }
    const isNow = st.month === ym(new Date());
    const [y, mo] = st.month.split("-").map(Number);
    const daysLeft = isNow ? new Date(y, mo, 0).getDate() - new Date().getDate() + 1 : 0;
    const rows = cats.map(c => ({ c, ...budgetState(c, st.month) })).sort((a, b2) => b2.pct - a.pct);
    $("budgetList").innerHTML = rows.map(r => {
      const col = r.level === "over" ? "var(--expense)" : r.level === "warn" ? "#d48a12" : "var(--income)";
      const status = r.left >= 0 ? '<b class="num" style="color:' + col + '">' + esc(money(r.left)) + '</b> left' : '<b class="num" style="color:var(--expense)">Over by ' + esc(money(-r.left)) + '</b>';
      const perDay = isNow && r.left > 0 && daysLeft > 1 ? ' · about ' + esc(money(r.left / daysLeft)) + '/day for ' + daysLeft + ' days' : "";
      return '<button type="button" class="budget" data-b="' + esc(r.c) + '">' +
        '<div class="bt"><span class="name"><span class="dot" style="background:' + catColor(r.c, "expense") + '"></span>' + esc(r.c) + '</span><span class="st">' + status + '</span></div>' +
        '<div class="bar"><i style="width:' + Math.min(100, Math.max(r.spent > 0 ? 2 : 0, r.pct * 100)) + '%;background:' + col + '"></i></div>' +
        '<div class="bs num">' + esc(money(r.spent)) + ' of ' + esc(money(r.limit)) + ' used' + perDay + '</div></button>';
    }).join("");
  }
  const be = { cat: null, existing: false };
  function renderBudgetChips() {
    const b = st.settings.budgets || {};
    $("bChips").innerHTML = st.settings.expenseCats.map(c => '<button type="button" class="chip" data-c="' + esc(c) + '" aria-pressed="' + (c === be.cat) + '"><span class="dot" style="background:' + catColor(c, "expense") + '"></span>' + esc(c) + (Number(b[c]) > 0 && c !== be.cat ? ' <span class="num" style="color:var(--muted);font-size:12px">' + esc(shortMoney(Number(b[c]))) + '</span>' : "") + '</button>').join("");
  }
  function openBudget(cat) {
    be.cat = cat || null; be.existing = !!cat;
    $("budTitle").textContent = cat ? "Edit " + cat + " budget" : "Set a monthly budget";
    $("bAmt").value = cat ? String((st.settings.budgets || {})[cat]) : "";
    $("bErr").textContent = "";
    $("bDel").classList.toggle("hidden", !cat);
    renderBudgetChips();
    $("budOv").classList.add("open");
  }
  function closeBudget() { $("budOv").classList.remove("open"); }
  $("addBudget").addEventListener("click", () => openBudget(null));
  $("budgetList").addEventListener("click", e => { const b = e.target.closest("[data-b]"); if (b) openBudget(b.dataset.b); });
  $("bCancel").addEventListener("click", closeBudget);
  $("budOv").addEventListener("click", e => { if (e.target === $("budOv")) closeBudget(); });
  $("bChips").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    be.cat = b.dataset.c; $("bErr").textContent = "";
    const cur = Number((st.settings.budgets || {})[be.cat]);
    if (cur > 0 && !$("bAmt").value) $("bAmt").value = String(cur);
    renderBudgetChips(); $("bAmt").focus();
  });
  async function writeBudgets(next) {
    const prev = st.settings.budgets;
    st.settings.budgets = next;
    try { await saveSettings(); } catch (e) { st.settings.budgets = prev; throw e; }
  }
  $("budForm").addEventListener("submit", async e => {
    e.preventDefault();
    const amt = parseFloat(String($("bAmt").value).replace(/[^0-9.]/g, ""));
    if (!be.cat) { $("bErr").textContent = "Choose a category."; return; }
    if (!(amt > 0)) { $("bErr").textContent = "Enter an amount above zero."; $("bAmt").focus(); return; }
    $("bSave").disabled = true;
    try { await writeBudgets({ ...(st.settings.budgets || {}), [be.cat]: Math.round(amt * 100) / 100 }); closeBudget(); render(); toast(be.cat + " budget: " + money(amt) + " a month"); }
    catch (err) { $("bErr").textContent = "Couldn't save. Try again."; }
    finally { $("bSave").disabled = false; }
  });
  $("bDel").addEventListener("click", async () => {
    const next = { ...(st.settings.budgets || {}) }; delete next[be.cat];
    try { await writeBudgets(next); closeBudget(); render(); toast("Budget removed"); } catch (e) { $("bErr").textContent = "Couldn't remove. Try again."; }
  });
  function updateBudgetHint() {
    const el = $("budgetHint");
    const bs = ed.type === "expense" && ed.category ? budgetState(ed.category, ($("fDate").value || today()).slice(0, 7)) : null;
    if (!bs) { el.classList.add("hidden"); return; }
    const orig = ed.id ? st.txs.find(t => t.id === ed.id) : null;
    const already = orig && orig.category === ed.category && orig.type === "expense" && orig.date.slice(0, 7) === ($("fDate").value || "").slice(0, 7) ? orig.amount : 0;
    const amt = parseFloat(String($("fAmt").value).replace(/[^0-9.]/g, "")) || 0;
    const after = bs.left + already - amt;
    el.innerHTML = esc(ed.category) + " budget: <b class=\"num\">" + esc(money(bs.left + already)) + "</b> left" + (amt > 0 ? (after >= 0 ? ", <b class=\"num\">" + esc(money(after)) + "</b> after this" : ', <b style="color:var(--expense)">this goes over by ' + esc(money(-after)) + "</b>") : "");
    el.classList.remove("hidden");
  }
  $("fAmt").addEventListener("input", updateBudgetHint);
  $("fDate").addEventListener("change", updateBudgetHint);

  /* ---------- plans ---------- */
  function dayDiff(a, b) { return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5); }
  function isPeriod(x) { return !!(x.start_date && x.end_date); }
  function planWindow(x, ref) {
    ref = ref || today();
    let s = x.start_date, e = x.end_date;
    if (x.repeat === "weekly") {
      const len = dayDiff(s, e), d = dayDiff(s, ref);
      if (d > 0) {
        let ss = shiftDay(s, 7 * Math.floor(d / 7));
        if (dayDiff(ss, ref) > len) ss = shiftDay(ss, 7);
        s = ss; e = shiftDay(ss, len);
      }
    }
    return { s, e, status: ref < s ? "upcoming" : ref > e ? "ended" : "active" };
  }
  function planSpent(x, w) { return st.txs.filter(t => t.type !== "income" && t.category === x.category && t.date >= w.s && t.date <= w.e).reduce((a, t) => a + t.amount, 0); }
  function planLeft(x) {
    if (!isPeriod(x)) return x.done ? 0 : x.amount;
    const w = planWindow(x);
    return w.status === "ended" ? 0 : Math.max(0, x.amount - planSpent(x, w));
  }
  function plannedTotal() { return openPlans().reduce((a, x) => a + planLeft(x), 0); }
  function rangeLabel(a, b) {
    const da = new Date(a + "T12:00:00"), db = new Date(b + "T12:00:00");
    const f = d => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
    return a === b ? da.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : f(da) + " – " + f(db) + " " + db.toLocaleDateString("en-GB", { month: "short" });
  }
  function openPlans() { return st.plans.filter(x => !x.done && !(isPeriod(x) && planWindow(x).status === "ended")); }
  function finishedPlans() { return st.plans.filter(x => x.done || (isPeriod(x) && planWindow(x).status === "ended")); }
  function planKey(x) { return isPeriod(x) ? planWindow(x).s : (x.due_date || "9999"); }
  function sortPlans(list) { return list.sort((a, b) => planKey(a).localeCompare(planKey(b)) || (a.created_at || "").localeCompare(b.created_at || "")); }
  function dueText(x) {
    if (!x.due_date) return "";
    const d = new Date(x.due_date + "T12:00:00"), t = today();
    const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    if (!x.done && x.due_date < t) return ' · <span class="late">was due ' + esc(label) + '</span>';
    return x.due_date === t ? " · due today" : " · by " + esc(label);
  }
  function planRow(x, withTick) {
    if (isPeriod(x)) return periodRow(x);
    return '<div class="plan' + (x.done ? " done" : "") + '">' +
      (withTick ? '<button type="button" class="tick" data-tick="' + esc(x.id) + '" aria-label="' + (x.done ? "Mark not paid: " : "Mark paid: ") + esc(x.title) + '">✓</button>' : '<span class="dot" style="background:' + catColor(x.category, "expense") + ';justify-self:center"></span>') +
      '<button type="button" class="body" data-plan="' + esc(x.id) + '"><div class="t1">' + esc(x.title) + '</div><div class="t2">' + esc(x.category) + (x.done ? " · paid" : dueText(x)) + '</div></button>' +
      '<span class="amt num">' + esc(money(x.amount)) + '</span></div>';
  }
  function periodRow(x) {
    const w = planWindow(x), spent = planSpent(x, w), left = x.amount - spent, ended = w.status === "ended";
    const pct = Math.min(100, x.amount > 0 ? spent / x.amount * 100 : 0);
    const col = left < 0 ? "var(--bad)" : pct >= 80 ? "var(--warn)" : "var(--good)";
    let line;
    if (w.status === "upcoming") line = "Starts " + new Date(w.s + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
    else if (ended) line = left >= 0 ? "Finished · spent " + money(spent) + ", stayed within the plan" : "Finished · went over by " + money(-left);
    else {
      const daysLeft = dayDiff(today(), w.e) + 1;
      line = money(spent) + " of " + money(x.amount) + " used" + (left > 0 && daysLeft > 0 ? " · about " + money(left / daysLeft) + "/day for " + daysLeft + (daysLeft === 1 ? " day" : " days") : "");
    }
    const status = w.status === "upcoming" || ended ? '<span class="num">' + esc(money(x.amount)) + '</span>' : left >= 0 ? '<span class="num" style="color:' + (ended ? "var(--muted)" : col) + '">' + esc(money(left)) + ' left</span>' : '<span class="num" style="color:var(--bad)">Over ' + esc(money(-left)) + '</span>';
    return '<div class="plan' + (ended ? " done" : "") + '">' +
      '<span class="tick period" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg></span>' +
      '<button type="button" class="body" data-plan="' + esc(x.id) + '"><div class="t1">' + esc(x.title) + '</div><div class="t2">' + esc(x.category) + ' · ' + esc(rangeLabel(w.s, w.e)) + (x.repeat === "weekly" ? '<span class="rep">every week</span>' : "") + '</div></button>' +
      '<span class="amt">' + status + '</span>' +
      '<div class="pextra">' + (w.status === "upcoming" ? "" : '<div class="bar"><i style="width:' + Math.max(spent > 0 ? 2 : 0, pct) + '%;background:' + (ended ? "var(--muted)" : col) + '"></i></div>') + '<span class="sub">' + esc(line) + '</span></div></div>';
  }
  function renderPlans(net) {
    const open = sortPlans(openPlans()), done = finishedPlans().sort((a, b) => (b.done_at || b.end_date || "").localeCompare(a.done_at || a.end_date || "")).slice(0, 10);
    const planned = open.reduce((a, x) => a + planLeft(x), 0);
    if (!open.length && !done.length) {
      $("planSum").innerHTML = "";
      $("planList").innerHTML = '<div class="empty">Nothing planned yet. Add what your next money is for, like rent or a gift, or set a spending limit for some days, like bus fare from Monday to Friday.</div>';
      return;
    }
    const free = net - planned;
    $("planSum").innerHTML = open.length ? '<div class="plansum"><span>' + open.length + (open.length === 1 ? " plan" : " plans") + ' · <b class="num">' + esc(money(planned)) + '</b> set aside</span>' +
      '<span class="free">Left over this month after plans: <b class="num" style="color:' + (free < 0 ? "var(--expense)" : "var(--income)") + '">' + (free < 0 ? "−" : "") + esc(money(Math.abs(free))) + '</b></span></div>' :
      '<div class="plansum"><span>All plans finished.</span></div>';
    let html = open.map(x => planRow(x, true)).join("");
    if (done.length) {
      html += '<button type="button" class="donetoggle" id="doneToggle">' + (st.showDone ? "Hide finished plans" : "Show finished plans (" + done.length + ")") + '</button>';
      if (st.showDone) html += done.map(x => planRow(x, true)).join("");
    }
    $("planList").innerHTML = html;
  }
  async function setPlanDone(id, done, txId) {
    const patch = { done, paid_tx_id: done ? (txId || null) : null, done_at: done ? new Date().toISOString() : null };
    const cur = st.plans.find(x => x.id === id); if (!cur) return;
    const next = { ...cur, ...patch };
    await putEnc("plans", next);
    st.plans = st.plans.map(x => x.id === id ? next : x);
  }
  $("planList").addEventListener("click", async e => {
    if (e.target.closest("#doneToggle")) { st.showDone = !st.showDone; render(); return; }
    const tick = e.target.closest("[data-tick]");
    if (tick) {
      const x = st.plans.find(p => p.id === tick.dataset.tick); if (!x) return;
      try { await setPlanDone(x.id, !x.done); render(); toast(x.done ? "Moved back to plans" : "Paid · " + x.title); }
      catch (err) { toast("Couldn't update. Check your connection."); }
      return;
    }
    const b = e.target.closest("[data-plan]");
    if (b) { const x = st.plans.find(p => p.id === b.dataset.plan); if (x) openPlan(x); }
  });

  const pe = { id: null, category: null, kind: "once" };
  function weekMonday(d) { const x = new Date(d + "T12:00:00"); const wd = (x.getDay() + 6) % 7; return shiftDay(d, -wd); }
  function quickRanges() {
    const mon = weekMonday(today()), nextMon = shiftDay(mon, 7);
    return [
      ["Mon–Fri this week", mon, shiftDay(mon, 4)],
      ["Mon–Fri next week", nextMon, shiftDay(nextMon, 4)],
      ["This whole week", mon, shiftDay(mon, 6)],
      ["This weekend", shiftDay(mon, 5), shiftDay(mon, 6)]
    ];
  }
  function setPlanKind(k) {
    pe.kind = k;
    document.querySelectorAll("#pKind button").forEach(b => b.classList.toggle("on", b.dataset.k === k));
    $("pOnce").classList.toggle("hidden", k !== "once");
    $("pPeriod").classList.toggle("hidden", k !== "period");
    planHint();
  }
  function planHint() {
    const s = $("pStart").value, e = $("pEnd").value, amt = parseFloat(String($("pAmt").value).replace(/[^0-9.]/g, ""));
    document.querySelectorAll("#pQuick .chip").forEach(c => c.setAttribute("aria-pressed", String(c.dataset.s === s && c.dataset.e === e)));
    if (!s || !e || e < s) { $("pHint").textContent = ""; return; }
    const days = dayDiff(s, e) + 1;
    $("pHint").textContent = days + (days === 1 ? " day" : " days") + (amt > 0 ? " · about " + money(amt / days) + " a day" : "") + ($("pRepeat").checked ? " · starts again every week" : "");
  }
  $("pKind").addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (b) setPlanKind(b.dataset.k); });
  $("pQuick").addEventListener("click", e => { const b = e.target.closest("[data-s]"); if (!b) return; $("pStart").value = b.dataset.s; $("pEnd").value = b.dataset.e; planHint(); });
  ["pStart", "pEnd", "pAmt"].forEach(id => $(id).addEventListener("input", planHint));
  $("pRepeat").addEventListener("change", planHint);
  function renderPlanChips() {
    const list = st.settings.expenseCats;
    const all = pe.category && !list.includes(pe.category) ? [...list, pe.category] : list;
    $("pChips").innerHTML = all.map(c => '<button type="button" class="chip" data-c="' + esc(c) + '" aria-pressed="' + (c === pe.category) + '"><span class="dot" style="background:' + catColor(c, "expense") + '"></span>' + esc(c) + '</button>').join("");
  }
  function openPlan(x) {
    pe.id = x ? x.id : null; pe.category = x ? x.category : null;
    $("planTitle").textContent = x ? "Edit plan" : "New plan";
    $("pTitle").value = x ? x.title : ""; $("pAmt").value = x ? String(x.amount) : ""; $("pDue").value = x && x.due_date ? x.due_date : "";
    $("pStart").value = x && x.start_date ? x.start_date : ""; $("pEnd").value = x && x.end_date ? x.end_date : ""; $("pRepeat").checked = !!(x && x.repeat === "weekly");
    $("pQuick").innerHTML = quickRanges().map(r => '<button type="button" class="chip" data-s="' + r[1] + '" data-e="' + r[2] + '">' + esc(r[0]) + '</button>').join("");
    setPlanKind(x && isPeriod(x) ? "period" : "once");
    $("pErr").textContent = "";
    $("pDel").classList.toggle("hidden", !x);
    $("pUndo").classList.toggle("hidden", !(x && x.done && !isPeriod(x)));
    renderPlanChips();
    $("planOv").classList.add("open");
    if (!x) setTimeout(() => $("pTitle").focus(), 50);
  }
  function closePlan() { $("planOv").classList.remove("open"); }
  $("addPlan").addEventListener("click", () => openPlan(null));
  $("pCancel").addEventListener("click", closePlan);
  $("planOv").addEventListener("click", e => { if (e.target === $("planOv")) closePlan(); });
  $("pChips").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; pe.category = b.dataset.c; $("pErr").textContent = ""; renderPlanChips(); });
  $("planForm").addEventListener("submit", async e => {
    e.preventDefault();
    let title = $("pTitle").value.trim().slice(0, 80);
    const amt = parseFloat(String($("pAmt").value).replace(/[^0-9.]/g, ""));
    const period = pe.kind === "period", ps = $("pStart").value, pend = $("pEnd").value, weekly = period && $("pRepeat").checked;
    if (!title && !period) { $("pErr").textContent = "Say what this money is for."; $("pTitle").focus(); return; }
    if (!(amt > 0)) { $("pErr").textContent = "Enter an amount above zero."; $("pAmt").focus(); return; }
    if (!pe.category) { $("pErr").textContent = "Choose what it falls under."; return; }
    if (period && (!ps || !pend)) { $("pErr").textContent = "Pick the first and last day, or tap one of the quick options."; return; }
    if (period && pend < ps) { $("pErr").textContent = "The last day can't be before the first day."; return; }
    if (weekly && dayDiff(ps, pend) > 6) { $("pErr").textContent = "A plan that repeats every week can cover up to 7 days."; return; }
    if (!title) title = (pe.category + " · " + rangeLabel(ps, pend)).slice(0, 80);
    const row = period
      ? { title, amount: Math.round(amt * 100) / 100, category: pe.category, due_date: null, start_date: ps, end_date: pend, repeat: weekly ? "weekly" : "none" }
      : { title, amount: Math.round(amt * 100) / 100, category: pe.category, due_date: $("pDue").value || null, start_date: null, end_date: null, repeat: "none" };
    $("pSave").disabled = true;
    try {
      const prev = pe.id ? st.plans.find(x => x.id === pe.id) : null;
      const saved = prev ? { ...prev, ...row } : { ...row, id: uuid(), done: false, paid_tx_id: null, done_at: null, created_at: new Date().toISOString() };
      await putEnc("plans", saved);
      st.plans = pe.id ? st.plans.map(x => x.id === pe.id ? saved : x) : [...st.plans, saved];
      const wasEdit = !!pe.id;
      closePlan(); render(); toast(wasEdit ? "Plan updated" : "Plan added · " + saved.title);
    } catch (err) { $("pErr").textContent = "Couldn't save the plan. Try again."; }
    finally { $("pSave").disabled = false; }
  });
  $("pUndo").addEventListener("click", async () => {
    try { await setPlanDone(pe.id, false); closePlan(); render(); toast("Moved back to plans"); } catch (e) { $("pErr").textContent = "Couldn't update. Try again."; }
  });
  $("pDel").addEventListener("click", async () => {
    if ($("pDel").dataset.confirm !== "1") { $("pDel").dataset.confirm = "1"; $("pDel").textContent = "Tap again to delete"; setTimeout(() => { $("pDel").dataset.confirm = ""; $("pDel").textContent = "Delete"; }, 3000); return; }
    $("pDel").dataset.confirm = ""; $("pDel").textContent = "Delete";
    const { error } = await sb.from("plans").delete().eq("id", pe.id);
    if (error) { $("pErr").textContent = "Couldn't delete. Try again."; return; }
    st.plans = st.plans.filter(x => x.id !== pe.id); closePlan(); render(); toast("Plan deleted");
  });

  function showReminder(amount) {
    const open = sortPlans(openPlans()); if (!open.length) return;
    const planned = open.reduce((a, x) => a + planLeft(x), 0);
    $("remSub").innerHTML = '<span class="num">' + esc(money(amount)) + '</span> just came in. <span class="num">' + esc(money(planned)) + '</span> of your money is already promised to these:';
    $("remList").innerHTML = open.map(x => planRow(x, false)).join("");
    $("remOv").classList.add("open");
  }
  $("remOk").addEventListener("click", () => $("remOv").classList.remove("open"));
  $("remOv").addEventListener("click", e => { if (e.target === $("remOv")) $("remOv").classList.remove("open"); });

  /* linking an expense to a plan */
  function renderPlanPick() {
    const linked = ed.id ? st.plans.find(x => x.paid_tx_id === ed.id) : null;
    const list = sortPlans(openPlans()).filter(x => !isPeriod(x));
    if (linked && !list.includes(linked)) list.unshift(linked);
    const show = ed.type === "expense" && list.length > 0;
    $("planPick").classList.toggle("hidden", !show);
    if (!show) return;
    $("planChips").innerHTML = list.map(x => '<button type="button" class="chip" data-p="' + esc(x.id) + '" aria-pressed="' + (x.id === ed.planId) + '">' + esc(x.title) + ' · <span class="num">' + esc(money(x.amount)) + '</span></button>').join("");
  }
  $("planChips").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (ed.planId === b.dataset.p) { ed.planId = null; renderPlanPick(); return; }
    ed.planId = b.dataset.p;
    const x = st.plans.find(p => p.id === ed.planId);
    if (x) {
      if (!$("fAmt").value) $("fAmt").value = x.amount.toFixed(2);
      if (!$("fNote").value) $("fNote").value = x.title;
      if (!ed.category) { ed.category = x.category; renderChips(); }
    }
    renderPlanPick();
  });

  /* ---------- entry sheet ---------- */
  const ed = { planId: null, id: null, type: "expense", category: null, receiptBlob: null, receiptPath: null, suggested: null, abort: null, fromReceipt: false };

  function openEntry(opts) {
    Object.assign(ed, { planId: null, id: null, type: "expense", category: null, receiptBlob: null, receiptPath: null, suggested: null, fromReceipt: false }, opts || {});
    const t = opts && opts.tx;
    if (t) { Object.assign(ed, { id: t.id, type: t.type, category: t.category, receiptPath: t.receipt_path || null }); const lp = st.plans.find(x => x.paid_tx_id === t.id); ed.planId = lp ? lp.id : null; }
    $("entryTitle").textContent = t ? "Edit entry" : ed.fromReceipt ? "New receipt" : ed.type === "income" ? "Money in" : "New expense";
    $("fAmt").value = t ? String(t.amount) : "";
    $("fDate").value = t ? t.date : today();
    $("fNote").value = t ? (t.note || "") : "";
    $("fErr").textContent = "";
    $("delBtn").classList.toggle("hidden", !t);
    $("viewRcpt").classList.toggle("hidden", !(t && t.receipt_path));
    $("rBox").classList.toggle("hidden", !ed.fromReceipt);
    $("newCatRow").classList.add("hidden");
    syncType();
    $("entryOv").classList.add("open");
    if (!ed.fromReceipt && !t) setTimeout(() => $("fAmt").focus(), 50);
  }
  function closeEntry() { if (ed.abort) ed.abort.abort(); $("entryOv").classList.remove("open"); }
  function syncType() {
    document.querySelectorAll("#typeToggle button").forEach(b => b.classList.toggle("on", b.dataset.t === ed.type));
    $("fNoteLbl").textContent = ed.type === "income" ? "From / for what" : "Where / what";
    $("fNote").placeholder = ed.type === "income" ? "e.g. Shift pay, allowance" : "e.g. Winners supermarket";
    $("askLbl").textContent = ed.type === "income" ? "What kind of money is this?" : "What does this fall under?";
    renderChips();
    renderPlanPick();
  }
  function renderChips() {
    const list = ed.type === "income" ? st.settings.incomeCats : st.settings.expenseCats;
    const all = ed.category && !list.includes(ed.category) ? [...list, ed.category] : list;
    $("chips").innerHTML = all.map(c =>
      '<button type="button" class="chip" data-c="' + esc(c) + '" aria-pressed="' + (c === ed.category) + '"><span class="dot" style="background:' + catColor(c, ed.type) + '"></span>' + esc(c) +
      (c === ed.suggested && c !== ed.category ? '<span class="sugg">suggested</span>' : "") + '</button>').join("") +
      '<button type="button" class="chip add" id="chipAdd">+ New</button>';
    updateBudgetHint();
  }

  $("typeToggle").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; if (ed.type !== b.dataset.t) { ed.type = b.dataset.t; ed.category = null; ed.suggested = null; if (ed.type === "income") ed.planId = null; syncType(); } });
  $("chips").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "chipAdd") { $("newCatRow").classList.remove("hidden"); $("newCat").focus(); return; }
    ed.category = b.dataset.c; $("fErr").textContent = ""; renderChips();
  });
  async function addCategory() {
    const name = $("newCat").value.trim().slice(0, 40); if (!name) return;
    const key = ed.type === "income" ? "incomeCats" : "expenseCats";
    if (!st.settings[key].some(c => c.toLowerCase() === name.toLowerCase())) {
      st.settings[key] = [...st.settings[key], name];
      try { await saveSettings(); } catch (e) { toast("Couldn't save the new category"); }
    }
    ed.category = st.settings[key].find(c => c.toLowerCase() === name.toLowerCase());
    $("newCat").value = ""; $("newCatRow").classList.add("hidden"); renderChips();
  }
  $("newCatAdd").addEventListener("click", addCategory);
  $("newCat").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } });

  $("entryForm").addEventListener("submit", async e => {
    e.preventDefault();
    const amt = parseFloat(String($("fAmt").value).replace(/[^0-9.]/g, ""));
    if (!(amt > 0)) { $("fErr").textContent = "Enter an amount above zero."; $("fAmt").focus(); return; }
    if (!$("fDate").value) { $("fErr").textContent = "Pick a date."; return; }
    if (!ed.category) { $("fErr").textContent = ed.type === "income" ? "Choose what kind of money this is." : "Choose what this falls under."; return; }
    $("saveBtn").disabled = true; $("fErr").textContent = "";
    try {
      let receipt_path = ed.receiptPath;
      if (ed.receiptBlob) {
        const path = st.user.id + "/" + uuid() + ".bin";
        const sealed = await Vault.encBytes(st.key, await ed.receiptBlob.arrayBuffer());
        const up = await sb.storage.from("receipts").upload(path, new Blob([sealed], { type: "application/octet-stream" }), { contentType: "application/octet-stream" });
        if (up.error) throw up.error;
        receipt_path = path;
      }
      const row = { type: ed.type, amount: Math.round(amt * 100) / 100, category: ed.category, note: $("fNote").value.trim().slice(0, 120), date: $("fDate").value, receipt_path };
      const prevTx = ed.id ? st.txs.find(t => t.id === ed.id) : null;
      const saved = { ...row, id: ed.id || uuid(), created_at: prevTx ? prevTx.created_at : new Date().toISOString() };
      await putEnc("transactions", saved);
      st.txs = ed.id ? st.txs.map(t => t.id === ed.id ? saved : t) : [saved, ...st.txs];
      const wasEdit = !!ed.id, planId = saved.type === "expense" ? ed.planId : null;
      const prevPlan = st.plans.find(x => x.paid_tx_id === saved.id);
      let planMsg = "";
      try {
        if (prevPlan && prevPlan.id !== planId) await setPlanDone(prevPlan.id, false);
        if (planId && (!prevPlan || prevPlan.id !== planId)) { await setPlanDone(planId, true, saved.id); planMsg = " · plan paid"; }
      } catch (_) { planMsg = " · couldn't tick off the plan"; }
      closeEntry();
      if (saved.date.slice(0, 7) !== st.month) st.month = saved.date.slice(0, 7);
      render();
      if (!wasEdit && saved.type === "income" && openPlans().length) showReminder(saved.amount);
      else {
        const bs = saved.type === "expense" ? budgetState(saved.category, saved.date.slice(0, 7)) : null;
        const bMsg = bs ? (bs.left >= 0 ? " · " + money(bs.left) + " left in budget" : " · over budget by " + money(-bs.left)) : "";
        toast((wasEdit ? "Updated" : (saved.type === "income" ? "Money in added" : "Expense added") + " · " + saved.category) + (bMsg || planMsg));
      }
    } catch (err) {
      $("fErr").textContent = /fetch|network/i.test((err && err.message) || "") ? "No internet connection. Try again when you're online." : "Couldn't save. Try again.";
    } finally { $("saveBtn").disabled = false; }
  });
  $("cancelBtn").addEventListener("click", closeEntry);
  $("entryOv").addEventListener("click", e => { if (e.target === $("entryOv")) closeEntry(); });
  $("delBtn").addEventListener("click", async () => {
    if ($("delBtn").dataset.confirm !== "1") { $("delBtn").dataset.confirm = "1"; $("delBtn").textContent = "Tap again to delete"; setTimeout(() => { $("delBtn").dataset.confirm = ""; $("delBtn").textContent = "Delete"; }, 3000); return; }
    $("delBtn").dataset.confirm = ""; $("delBtn").textContent = "Delete";
    const t = st.txs.find(x => x.id === ed.id);
    const { error } = await sb.from("transactions").delete().eq("id", ed.id);
    if (error) { $("fErr").textContent = "Couldn't delete. Try again."; return; }
    if (t && t.receipt_path) sb.storage.from("receipts").remove([t.receipt_path]);
    st.txs = st.txs.filter(x => x.id !== ed.id);
    st.plans = st.plans.map(x => x.paid_tx_id === ed.id ? { ...x, paid_tx_id: null } : x);
    closeEntry(); render(); toast("Deleted");
  });
  $("viewRcpt").addEventListener("click", async () => {
    if (/\.bin$/.test(ed.receiptPath)) {
      const { data, error } = await sb.storage.from("receipts").download(ed.receiptPath);
      if (error) return toast("Couldn't open the receipt");
      try {
        const plain = await Vault.decBytes(st.key, await data.arrayBuffer());
        if ($("rcptFull").dataset.url) URL.revokeObjectURL($("rcptFull").dataset.url);
        const url = URL.createObjectURL(new Blob([plain], { type: "image/jpeg" }));
        $("rcptFull").dataset.url = url; $("rcptFull").src = url;
      } catch (_) { return toast("Couldn't unlock this receipt"); }
    } else {
      const { data, error } = await sb.storage.from("receipts").createSignedUrl(ed.receiptPath, 300);
      if (error) return toast("Couldn't open the receipt");
      $("rcptFull").src = data.signedUrl;
    }
    $("rcptOv").classList.add("open");
  });
  $("rcptClose").addEventListener("click", () => $("rcptOv").classList.remove("open"));
  $("rcptOv").addEventListener("click", e => { if (e.target === $("rcptOv")) $("rcptOv").classList.remove("open"); });

  $("addIn").addEventListener("click", () => openEntry({ type: "income" }));
  $("addOut").addEventListener("click", () => openEntry({ type: "expense" }));
  $("txList").addEventListener("click", e => { const b = e.target.closest(".tx"); if (!b) return; const t = st.txs.find(x => x.id === b.dataset.id); if (t) openEntry({ tx: t }); });

  /* ---------- receipts ---------- */
  function loadImage(file) {
    return new Promise((res, rej) => { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 1000); }; img.onerror = () => rej(new Error("bad image")); img.src = url; });
  }
  function toCanvas(img, max) {
    const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  const toBlob = (c, q) => new Promise(res => c.toBlob(res, "image/jpeg", q));

  $("scanBtn").addEventListener("click", () => { $("fileIn").value = ""; $("fileIn").click(); });
  $("fileIn").addEventListener("change", async () => {
    const file = $("fileIn").files && $("fileIn").files[0]; if (!file) return;
    let img;
    try { img = await loadImage(file); } catch (e) { toast("That photo couldn't be opened. Try a JPG or PNG."); return; }
    const store = toCanvas(img, 1400);
    openEntry({ type: "expense", fromReceipt: true });
    ed.receiptBlob = await toBlob(store, 0.72);
    $("rImg").src = store.toDataURL("image/jpeg", 0.5);
    $("rStatus").innerHTML = '<span class="spinner"></span>Reading your receipt…';
    ed.abort = new AbortController();
    try {
      const ai = toCanvas(img, 1600).toDataURL("image/jpeg", 0.85).split(",")[1];
      const cats = st.settings.expenseCats;
      const { data, error } = await sb.functions.invoke("read-receipt", { body: { image: ai, mimeType: "image/jpeg", categories: cats, today: today() } });
      if (!$("entryOv").classList.contains("open")) return;
      if (error) {
        let code = ""; try { code = (await error.context.json()).error; } catch (_) {}
        $("rStatus").textContent = code === "no_key" ? "Receipt reading isn't switched on yet. Type the total and choose a category." :
          code === "rate_limited" ? "Too many receipts in a short time. Type the total for this one." :
          "Couldn't read this receipt automatically. Type the total and choose a category.";
        $("fAmt").focus();
        return;
      }
      const r = (data && data.result) || {};
      if (typeof r.total === "number" && r.total > 0 && !$("fAmt").value) $("fAmt").value = r.total.toFixed(2);
      if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date <= today()) $("fDate").value = r.date;
      if ((r.merchant || r.summary) && !$("fNote").value) $("fNote").value = [r.merchant, r.summary].filter(Boolean).join(" · ").slice(0, 120);
      if (r.suggested_category && cats.includes(r.suggested_category)) { ed.suggested = r.suggested_category; renderChips(); }
      const found = typeof r.total === "number" && r.total > 0;
      $("rStatus").textContent = found ? "Got it. Check the amount, then tell me what this falls under." : "Couldn't read the total. Type it in, then choose a category.";
      if (!found) $("fAmt").focus();
    } catch (e) {
      $("rStatus").textContent = "Couldn't read this receipt automatically. Type the total and choose a category.";
    } finally { ed.abort = null; }
  });

  /* ---------- settings ---------- */
  function renderSettings() {
    $("sCur").value = st.settings.currency;
    $("sName").value = st.settings.name || "";
    renderLookPickers();
    const row = (c, key) => '<div class="catedit"><span><span class="dot" style="display:inline-block;margin-right:8px;background:' + catColor(c, key === "incomeCats" ? "income" : "expense") + '"></span>' + esc(c) + '</span><button type="button" data-k="' + key + '" data-c="' + esc(c) + '" aria-label="Remove ' + esc(c) + '">×</button></div>';
    $("sExp").innerHTML = st.settings.expenseCats.map(c => row(c, "expenseCats")).join("");
    $("sInc").innerHTML = st.settings.incomeCats.map(c => row(c, "incomeCats")).join("");
  }
  let lookBefore = null;
  function openSettings() { lookBefore = { theme: st.settings.theme, avatar: st.settings.avatar, skin: st.settings.skin, name: st.settings.name }; renderSettings(); $("setOv").classList.add("open"); }
  $("openSettings").addEventListener("click", openSettings);
  $("openSettings2").addEventListener("click", openSettings);
  function renderLookPickers() {
    const s = st.settings;
    document.querySelectorAll("#sTheme .themeopt").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === s.theme)));
    $("sAvatar").innerHTML = ["girl", "boy"].map(k => '<button type="button" data-v="' + k + '" aria-pressed="' + (s.avatar === k) + '" aria-label="' + (k === "girl" ? "Girl avatar" : "Boy avatar") + '"><img src="' + avatarSrc(k, s.skin) + '" alt=""></button>').join("");
    const tones = { deep: "#6E3F27", brown: "#9A5C37", tan: "#C98F62", light: "#E2AE8A" };
    $("sSkin").innerHTML = Object.keys(tones).map(k => '<button type="button" data-v="' + k + '" aria-pressed="' + (s.skin === k) + '" aria-label="' + k + ' skin tone" style="background:' + tones[k] + '"></button>').join("");
  }
  $("sTheme").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (!b) return; st.settings.theme = b.dataset.v; applyLook(); renderLookPickers(); });
  $("sAvatar").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (!b) return; st.settings.avatar = b.dataset.v; applyLook(); renderLookPickers(); });
  $("sSkin").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (!b) return; st.settings.skin = b.dataset.v; applyLook(); renderLookPickers(); });
  $("setOv").addEventListener("click", async e => {
    if (e.target === $("setOv")) return closeSettings();
    const b = e.target.closest(".catedit button"); if (!b) return;
    const key = b.dataset.k; if (st.settings[key].length <= 1) return toast("Keep at least one category");
    st.settings[key] = st.settings[key].filter(c => c !== b.dataset.c);
    renderSettings();
    try { await saveSettings(); } catch (err) { toast("Couldn't save that change"); }
  });
  async function closeSettings() {
    const cur = $("sCur").value.trim().slice(0, 6) || "Rs";
    const name = $("sName").value.trim().slice(0, 40);
    $("setOv").classList.remove("open");
    const b = lookBefore || {};
    const changed = cur !== st.settings.currency || name !== (st.settings.name || "") || b.theme !== st.settings.theme || b.avatar !== st.settings.avatar || b.skin !== st.settings.skin;
    st.settings.currency = cur; st.settings.name = name;
    applyLook(); render();
    if (changed) { try { await saveSettings(); } catch (e) { toast("Couldn't save your settings. Check your connection."); } }
  }
  $("setDone").addEventListener("click", closeSettings);
  $("signOut").addEventListener("click", async () => { $("setOv").classList.remove("open"); await Vault.forget(); await sb.auth.signOut(); });
  $("copyCsv").addEventListener("click", async () => {
    const rows = [["date","type","amount","category","note"]].concat([...st.txs].sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.date, t.type, t.amount, t.category, t.note || ""]));
    const csv = rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(",")).join("\n");
    try { await navigator.clipboard.writeText(csv); toast("Copied " + plural(st.txs.length) + ". Paste into a spreadsheet."); } catch (e) { toast("Copy was blocked by the browser"); }
  });

  /* ---------- misc ---------- */
  $("prevM").addEventListener("click", () => { st.month = shiftMonth(st.month, -1); render(); });
  $("nextM").addEventListener("click", () => { st.month = shiftMonth(st.month, 1); render(); });
  document.querySelector(".seg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return; st.filter = b.dataset.f;
    document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); render();
  });
  $("search").addEventListener("input", e => { st.q = e.target.value; render(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { if ($("cpOv").classList.contains("open")) $("cpOv").classList.remove("open"); else if ($("trkOv").classList.contains("open")) closeTrk(); else if ($("addOv").classList.contains("open")) $("addOv").classList.remove("open"); else if ($("holdOv").classList.contains("open")) closeHold(); else if ($("budOv").classList.contains("open")) closeBudget(); else if ($("remOv").classList.contains("open")) $("remOv").classList.remove("open"); else if ($("planOv").classList.contains("open")) closePlan(); else if ($("rcptOv").classList.contains("open")) $("rcptOv").classList.remove("open"); else if ($("setOv").classList.contains("open")) closeSettings(); else if ($("entryOv").classList.contains("open")) closeEntry(); } });

  /* ---------- install tip ---------- */
  (function installTip() {
    const tip = $("installTip");
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    let hidden = false; try { hidden = localStorage.getItem("mm-install-hidden") === "1"; } catch (_) {}
    if (standalone || hidden) return;
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const inApp = /FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|TikTok|GSA\//.test(ua);
    const shareIcon = '<svg class="share" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
    function place() {
      const slot = document.body.classList.contains("signedout") ? $("installSlotAuth") : $("installSlotHome");
      if (tip.parentNode !== slot) slot.appendChild(tip);
    }
    function show(html, withBtn) { $("installHow").innerHTML = html; $("installBtn").classList.toggle("hidden", !withBtn); tip.classList.remove("hidden"); place(); }
    if (ios) {
      show(inApp ? "Open this page in Safari first (tap ••• then Open in Safari), then tap " + shareIcon + " Share → Add to Home Screen."
        : "In Safari, tap " + shareIcon + " Share at the bottom, scroll down, then tap <b>Add to Home Screen</b>.", false);
    }
    let deferred = null;
    window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; show("Install it like an app, with its own icon.", true); });
    $("installBtn").addEventListener("click", async () => { if (!deferred) return; deferred.prompt(); try { await deferred.userChoice; } catch (_) {} deferred = null; tip.classList.add("hidden"); });
    $("installClose").addEventListener("click", () => { tip.classList.add("hidden"); try { localStorage.setItem("mm-install-hidden", "1"); } catch (_) {} });
    window.addEventListener("appinstalled", () => tip.classList.add("hidden"));
    new MutationObserver(place).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  })();

  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
