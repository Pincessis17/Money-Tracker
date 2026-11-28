// Shows the app in the chosen language. The app is written in English; this swaps the English text on screen
// for French or Kreol Morisien as it appears, and formats dates in that language.
(() => {
  const D = window.I18N_DATA, COL = { fr: 0, mfe: 1 };
  const LANGS = [["en", "English"], ["fr", "Français"], ["mfe", "Kreol Morisien"]];
  const PATS = D.P.map(([s, fr, mfe]) => [new RegExp(s), fr, mfe]);
  let lang = "en";
  try { lang = localStorage.getItem("mm-lang") || ((navigator.language || "").toLowerCase().startsWith("fr") ? "fr" : "en"); } catch (_) {}
  if (!(lang in COL) && lang !== "en") lang = "en";

  function core(c, i, depth) {
    const e = D.T[c]; if (e) return e[i];
    for (const p of PATS) {
      const m = c.match(p[0]);
      if (m) return p[1 + i].replace(/\{(\d)\}/g, (_, k) => { const g = m[k] || ""; const t = depth < 3 ? core(g, i, depth + 1) : null; return t == null ? g : t; });
    }
    if (depth < 3 && c.includes(" · ")) {
      let any = false;
      const out = c.split(" · ").map(part => { const t = core(part, i, depth + 1); if (t != null) { any = true; return t; } return part; });
      if (any) return out.join(" · ");
    }
    return null;
  }
  function tr(s) {
    if (lang === "en" || !s) return s;
    const c = s.trim(); if (!c || !/[A-Za-z]/.test(c)) return s;
    const out = core(c, COL[lang], 0);
    return out == null ? s : s.slice(0, s.indexOf(c[0])) + out + s.slice(s.lastIndexOf(c[c.length - 1]) + 1);
  }

  // ---- dates ----
  const KR = {
    dl: ["Dimans", "Lindi", "Mardi", "Merkredi", "Zedi", "Vandredi", "Samdi"], ds: ["Dim", "Lin", "Mar", "Mer", "Zed", "Van", "Sam"],
    ml: ["Zanvie", "Fevrie", "Mars", "Avril", "Me", "Zin", "Zilye", "Out", "Septam", "Oktob", "Novam", "Desam"], ms: ["Zan", "Fev", "Mar", "Avr", "Me", "Zin", "Zil", "Out", "Sep", "Okt", "Nov", "Des"]
  };
  const nativeDate = Date.prototype.toLocaleDateString;
  Date.prototype.toLocaleDateString = function (loc, opts) {
    if (loc !== "en-GB" || lang === "en") return nativeDate.call(this, loc, opts);
    if (lang === "fr") return nativeDate.call(this, "fr-FR", opts);
    try {
      return new Intl.DateTimeFormat("en-GB", opts).formatToParts(this).map(p =>
        p.type === "weekday" ? (opts && opts.weekday === "long" ? KR.dl : KR.ds)[this.getDay()] :
        p.type === "month" && isNaN(+p.value) ? (opts && opts.month === "long" ? KR.ml : KR.ms)[this.getMonth()] : p.value).join("");
    } catch (_) { return nativeDate.call(this, loc, opts); }
  };

  // ---- the page ----
  const ORIG = new WeakMap(), SHOWN = new WeakMap(), ATTRS = ["placeholder", "aria-label", "title"];
  const skip = el => !el || el.closest("script,style,textarea,[translate=no]");
  function doText(n) {
    if (skip(n.parentElement)) return;
    let en = ORIG.get(n);
    if (en === undefined || n.nodeValue !== SHOWN.get(n)) { en = n.nodeValue; ORIG.set(n, en); }
    const out = tr(en); SHOWN.set(n, out);
    if (n.nodeValue !== out) n.nodeValue = out;
  }
  function doAttr(el, a) {
    if (!el || el.closest("[translate=no]")) return;
    let m = ORIG.get(el); if (!m) { m = {}; ORIG.set(el, m); }
    const cur = el.getAttribute(a); if (cur == null) return;
    const shown = (SHOWN.get(el) || {})[a];
    if (m[a] === undefined || cur !== shown) m[a] = cur;
    const out = tr(m[a]); const s = SHOWN.get(el) || {}; s[a] = out; SHOWN.set(el, s);
    if (cur !== out) el.setAttribute(a, out);
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    ATTRS.forEach(a => root.hasAttribute(a) && doAttr(root, a));
    root.querySelectorAll("[placeholder],[aria-label],[title]").forEach(el => ATTRS.forEach(a => el.hasAttribute(a) && doAttr(el, a)));
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) doText(n);
  }
  let obs;
  function start() {
    walk(document.body);
    obs = new MutationObserver(recs => {
      for (const r of recs) {
        if (r.type === "childList") r.addedNodes.forEach(walk);
        else if (r.type === "characterData") doText(r.target);
        else if (r.type === "attributes") doAttr(r.target, r.attributeName);
      }
      obs.takeRecords();
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();

  window.I18N = {
    t: tr, langs: LANGS,
    get lang() { return lang; },
    set(l, quiet) {
      if (!(l in COL) && l !== "en") return;
      lang = l;
      try { localStorage.setItem("mm-lang", l); } catch (_) {}
      document.documentElement.lang = l;
      walk(document.body); if (obs) obs.takeRecords();
      document.querySelectorAll("select[data-lang]").forEach(s => { s.value = l; });
      if (!quiet && typeof window.onLangChange === "function") window.onLangChange(l);
    }
  };
  document.documentElement.lang = lang;
})();
