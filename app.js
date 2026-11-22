(() => {
  const $ = (id) => document.getElementById(id);
  const sb = window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const PALETTE = ["#2f4bd8","#12805a","#c8433a","#d48a12","#7a4fd6","#0e8fa3","#c2417f","#5b7a14","#8a5a3c","#4a6378","#d0602a","#3d9970","#9b59b6"];
  const DEFAULTS = {
    currency: "Rs",
    expenseCats: ["Groceries","Eating out","Transport","Rent & housing","Bills & phone","School & books","Health","Personal care","Clothes","Fun & going out","Business","Family & gifts","Other"],
    incomeCats: ["Job / salary","Allowance","Freelance","Business","Gift","Other"]
  };
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const st = { user: null, txs: [], plans: [], showDone: false, settings: structuredClone(DEFAULTS), hasSettingsRow: false, month: ym(new Date()), filter: "all", q: "" };

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
    $("authTitle").textContent = up ? "Create your account" : "Sign in";
    $("aSubmit").textContent = up ? "Create account" : "Sign in";
    $("aSwitch").textContent = up ? "Already have an account? Sign in" : "New here? Create an account";
    $("aPass").autocomplete = up ? "new-password" : "current-password";
    $("aErr").textContent = ""; $("aOk").textContent = "";
  }
  $("aSwitch").addEventListener("click", () => setAuthMode(!signUpMode));
  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("aEmail").value.trim(), password = $("aPass").value;
    $("aErr").textContent = ""; $("aOk").textContent = "";
    if (!/^\S+@\S+\.\S+$/.test(email)) return ($("aErr").textContent = "Enter a valid email address.");
    if (password.length < 6) return ($("aErr").textContent = "Password needs at least 6 characters.");
    $("aSubmit").disabled = true;
    try {
      if (signUpMode) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session) {
          setAuthMode(false);
          $("aOk").textContent = "Account created. Check your email and tap the confirmation link, then come back here and sign in.";
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      const m = (err && err.message) || "";
      $("aErr").textContent = /confirm/i.test(m) ? "Confirm your email first: open the link we sent you, then sign in." :
        /invalid login/i.test(m) ? "That email and password don't match." :
        /already registered/i.test(m) ? "That email already has an account. Sign in instead." :
        /fetch|network/i.test(m) ? "No internet connection. Try again when you're online." : (m || "Something went wrong. Try again.");
    } finally { $("aSubmit").disabled = false; }
  });

  sb.auth.onAuthStateChange((_evt, session) => {
    const u = session ? session.user : null;
    if ((u && u.id) === (st.user && st.user.id)) return;
    st.user = u;
    document.body.classList.toggle("signedout", !u);
    if (u) { $("aPass").value = ""; loadAll(); } else { st.txs = []; st.plans = []; st.settings = structuredClone(DEFAULTS); }
  });

  /* ---------- data ---------- */
  async function loadAll() {
    $("syncNote").textContent = "Loading your records…";
    render();
    const [tx, set, pl] = await Promise.all([
      sb.from("transactions").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }),
      sb.from("settings").select("*").maybeSingle(),
      sb.from("plans").select("*").order("created_at", { ascending: true })
    ]);
    if (tx.error || set.error || pl.error) {
      $("syncNote").textContent = "Not synced";
      banner("Couldn't load your records. Check your connection and pull down or reopen the app.");
      return;
    }
    banner("");
    st.txs = tx.data.map(t => ({ ...t, amount: Number(t.amount) }));
    st.plans = pl.data.map(x => ({ ...x, amount: Number(x.amount) }));
    if (set.data) {
      st.hasSettingsRow = true;
      st.settings = { currency: set.data.currency, expenseCats: set.data.expense_cats, incomeCats: set.data.income_cats };
    }
    $("syncNote").textContent = "Synced " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    render();
  }
  async function saveSettings() {
    const row = { currency: st.settings.currency, expense_cats: st.settings.expenseCats, income_cats: st.settings.incomeCats, updated_at: new Date().toISOString() };
    const { error } = await sb.from("settings").upsert({ user_id: st.user.id, ...row });
    if (error) throw error;
    st.hasSettingsRow = true;
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && st.user) loadAll(); });

  /* ---------- render ---------- */
  function monthTx(m) { return st.txs.filter(t => (t.date || "").startsWith(m)); }
  function sums(list) { let i = 0, o = 0; for (const t of list) { if (t.type === "income") i += t.amount; else o += t.amount; } return { i, o }; }

  function render() {
    document.querySelectorAll(".curLbl").forEach(e => e.textContent = st.settings.currency);
    $("monthLabel").textContent = monthName(st.month, true);
    const cur = monthTx(st.month), prev = monthTx(shiftMonth(st.month, -1));
    const s = sums(cur), p = sums(prev);
    $("kIn").textContent = money(s.i);
    $("kOut").textContent = money(s.o);
    const net = s.i - s.o;
    $("kNet").textContent = (net < 0 ? "−" : "") + money(Math.abs(net));
    $("kNet").style.color = net < 0 ? "var(--expense)" : "";
    $("kInHint").textContent = plural(cur.filter(t => t.type === "income").length);
    const diff = s.o - p.o;
    $("kOutHint").innerHTML = p.o > 0 ? (diff > 0 ? '<span class="pill bad">▲ ' + esc(money(diff)) + '</span> vs last month' : '<span class="pill good">▼ ' + esc(money(-diff)) + '</span> vs last month') : esc(plural(cur.filter(t => t.type !== "income").length));
    const planned = openPlans().reduce((a, x) => a + x.amount, 0);
    if (planned > 0) {
      const free = net - planned;
      $("kNetHint").innerHTML = esc(money(planned)) + ' planned · ' + (free >= 0 ? '<span class="pill good">' + esc(money(free)) + ' free</span>' : '<span class="pill bad">Short ' + esc(money(-free)) + '</span>');
    } else $("kNetHint").innerHTML = s.i > 0 ? (net >= 0 ? '<span class="pill good">' + Math.round(net / s.i * 100) + '% kept</span>' : '<span class="pill bad">Over by ' + esc(money(-net)) + '</span>') : (s.o > 0 ? '<span class="pill bad">No money in logged</span>' : "Nothing logged yet");
    renderPlans(net);
    renderCats(cur, s.o);
    renderTrend();
    renderList(cur);
  }

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
      $("txList").innerHTML = '<div class="empty">' + (cur.length ? "Nothing matches that filter." : "No entries in " + esc(monthName(st.month, true)) + " yet.<br>Use the buttons below to log money in, an expense, or snap a receipt.") + '</div>';
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
      for (const t of items) {
        const inc = t.type === "income", col = catColor(t.category || "Other", t.type);
        html += '<button class="tx" data-id="' + esc(t.id) + '"><span class="ic" style="background:' + col + '">' + esc((t.category || "?").slice(0, 2)) + '</span>' +
          '<span style="min-width:0"><div class="t1">' + esc(t.note || t.category || "Entry") + '</div><div class="t2">' + esc(t.category || "Uncategorised") + (t.receipt_path ? " · receipt" : "") + '</div></span>' +
          '<span class="amt num ' + (inc ? "in" : "out") + '">' + (inc ? "+" : "−") + esc(money(t.amount)) + '</span></button>';
      }
      html += '</div>';
    }
    $("txList").innerHTML = html;
  }


  /* ---------- plans ---------- */
  function openPlans() { return st.plans.filter(x => !x.done); }
  function sortPlans(list) { return list.sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || (a.created_at || "").localeCompare(b.created_at || "")); }
  function dueText(x) {
    if (!x.due_date) return "";
    const d = new Date(x.due_date + "T12:00:00"), t = today();
    const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    if (!x.done && x.due_date < t) return ' · <span class="late">was due ' + esc(label) + '</span>';
    return x.due_date === t ? " · due today" : " · by " + esc(label);
  }
  function planRow(x, withTick) {
    return '<div class="plan' + (x.done ? " done" : "") + '">' +
      (withTick ? '<button type="button" class="tick" data-tick="' + esc(x.id) + '" aria-label="' + (x.done ? "Mark not paid: " : "Mark paid: ") + esc(x.title) + '">✓</button>' : '<span class="dot" style="background:' + catColor(x.category, "expense") + ';justify-self:center"></span>') +
      '<button type="button" class="body" data-plan="' + esc(x.id) + '"><div class="t1">' + esc(x.title) + '</div><div class="t2">' + esc(x.category) + (x.done ? " · paid" : dueText(x)) + '</div></button>' +
      '<span class="amt num">' + esc(money(x.amount)) + '</span></div>';
  }
  function renderPlans(net) {
    const open = sortPlans(openPlans()), done = st.plans.filter(x => x.done).sort((a, b) => (b.done_at || "").localeCompare(a.done_at || "")).slice(0, 10);
    const planned = open.reduce((a, x) => a + x.amount, 0);
    if (!open.length && !done.length) {
      $("planSum").innerHTML = "";
      $("planList").innerHTML = '<div class="empty">Nothing planned yet. Add what your next money is for, like rent, bus fare or a gift, so you don\'t spend it on something else.</div>';
      return;
    }
    const free = net - planned;
    $("planSum").innerHTML = open.length ? '<div class="plansum"><span>' + open.length + ' to pay · <b class="num">' + esc(money(planned)) + '</b></span>' +
      '<span class="free">Left over this month after plans: <b class="num" style="color:' + (free < 0 ? "var(--expense)" : "var(--income)") + '">' + (free < 0 ? "−" : "") + esc(money(Math.abs(free))) + '</b></span></div>' :
      '<div class="plansum"><span>All plans paid.</span></div>';
    let html = open.map(x => planRow(x, true)).join("");
    if (done.length) {
      html += '<button type="button" class="donetoggle" id="doneToggle">' + (st.showDone ? "Hide paid plans" : "Show paid plans (" + done.length + ")") + '</button>';
      if (st.showDone) html += done.map(x => planRow(x, true)).join("");
    }
    $("planList").innerHTML = html;
  }
  async function setPlanDone(id, done, txId) {
    const patch = { done, paid_tx_id: done ? (txId || null) : null, done_at: done ? new Date().toISOString() : null };
    const { error } = await sb.from("plans").update(patch).eq("id", id);
    if (error) throw error;
    st.plans = st.plans.map(x => x.id === id ? { ...x, ...patch } : x);
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

  const pe = { id: null, category: null };
  function renderPlanChips() {
    const list = st.settings.expenseCats;
    const all = pe.category && !list.includes(pe.category) ? [...list, pe.category] : list;
    $("pChips").innerHTML = all.map(c => '<button type="button" class="chip" data-c="' + esc(c) + '" aria-pressed="' + (c === pe.category) + '"><span class="dot" style="background:' + catColor(c, "expense") + '"></span>' + esc(c) + '</button>').join("");
  }
  function openPlan(x) {
    pe.id = x ? x.id : null; pe.category = x ? x.category : null;
    $("planTitle").textContent = x ? "Edit plan" : "New plan";
    $("pTitle").value = x ? x.title : ""; $("pAmt").value = x ? String(x.amount) : ""; $("pDue").value = x && x.due_date ? x.due_date : "";
    $("pErr").textContent = "";
    $("pDel").classList.toggle("hidden", !x);
    $("pUndo").classList.toggle("hidden", !(x && x.done));
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
    const title = $("pTitle").value.trim().slice(0, 80);
    const amt = parseFloat(String($("pAmt").value).replace(/[^0-9.]/g, ""));
    if (!title) { $("pErr").textContent = "Say what this money is for."; $("pTitle").focus(); return; }
    if (!(amt > 0)) { $("pErr").textContent = "Enter an amount above zero."; $("pAmt").focus(); return; }
    if (!pe.category) { $("pErr").textContent = "Choose what it falls under."; return; }
    const row = { title, amount: Math.round(amt * 100) / 100, category: pe.category, due_date: $("pDue").value || null };
    $("pSave").disabled = true;
    try {
      const res = pe.id ? await sb.from("plans").update(row).eq("id", pe.id).select().single() : await sb.from("plans").insert(row).select().single();
      if (res.error) throw res.error;
      const saved = { ...res.data, amount: Number(res.data.amount) };
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
    const planned = open.reduce((a, x) => a + x.amount, 0);
    $("remSub").innerHTML = '<span class="num">' + esc(money(amount)) + '</span> just came in. <span class="num">' + esc(money(planned)) + '</span> of your money is already promised to these:';
    $("remList").innerHTML = open.map(x => planRow(x, false)).join("");
    $("remOv").classList.add("open");
  }
  $("remOk").addEventListener("click", () => $("remOv").classList.remove("open"));
  $("remOv").addEventListener("click", e => { if (e.target === $("remOv")) $("remOv").classList.remove("open"); });

  /* linking an expense to a plan */
  function renderPlanPick() {
    const linked = ed.id ? st.plans.find(x => x.paid_tx_id === ed.id) : null;
    const list = sortPlans(openPlans());
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
        const path = st.user.id + "/" + crypto.randomUUID() + ".jpg";
        const up = await sb.storage.from("receipts").upload(path, ed.receiptBlob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        receipt_path = path;
      }
      const row = { type: ed.type, amount: Math.round(amt * 100) / 100, category: ed.category, note: $("fNote").value.trim().slice(0, 120), date: $("fDate").value, receipt_path };
      const res = ed.id
        ? await sb.from("transactions").update(row).eq("id", ed.id).select().single()
        : await sb.from("transactions").insert(row).select().single();
      if (res.error) throw res.error;
      const saved = { ...res.data, amount: Number(res.data.amount) };
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
      else toast((wasEdit ? "Updated" : (saved.type === "income" ? "Money in added" : "Expense added") + " · " + saved.category) + planMsg);
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
    const { data, error } = await sb.storage.from("receipts").createSignedUrl(ed.receiptPath, 300);
    if (error) return toast("Couldn't open the receipt");
    $("rcptFull").src = data.signedUrl; $("rcptOv").classList.add("open");
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
    const row = (c, key) => '<div class="catedit"><span><span class="dot" style="display:inline-block;margin-right:8px;background:' + catColor(c, key === "incomeCats" ? "income" : "expense") + '"></span>' + esc(c) + '</span><button type="button" data-k="' + key + '" data-c="' + esc(c) + '" aria-label="Remove ' + esc(c) + '">×</button></div>';
    $("sExp").innerHTML = st.settings.expenseCats.map(c => row(c, "expenseCats")).join("");
    $("sInc").innerHTML = st.settings.incomeCats.map(c => row(c, "incomeCats")).join("");
  }
  $("openSettings").addEventListener("click", () => { renderSettings(); $("setOv").classList.add("open"); });
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
    $("setOv").classList.remove("open");
    if (cur !== st.settings.currency) { st.settings.currency = cur; render(); try { await saveSettings(); } catch (e) { toast("Couldn't save the currency"); } }
  }
  $("setDone").addEventListener("click", closeSettings);
  $("signOut").addEventListener("click", async () => { $("setOv").classList.remove("open"); await sb.auth.signOut(); });
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
  document.addEventListener("keydown", e => { if (e.key === "Escape") { if ($("remOv").classList.contains("open")) $("remOv").classList.remove("open"); else if ($("planOv").classList.contains("open")) closePlan(); else if ($("rcptOv").classList.contains("open")) $("rcptOv").classList.remove("open"); else if ($("setOv").classList.contains("open")) closeSettings(); else if ($("entryOv").classList.contains("open")) closeEntry(); } });

  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
