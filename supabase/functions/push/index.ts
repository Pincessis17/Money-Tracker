// Daily reminders for My Money.
// GET  -> the public key phones need to sign up for notifications (made once, kept in app_keys).
// POST -> run by the scheduler every 15 minutes: sends "Did you spend anything today?" to each
//         phone whose chosen time has passed today, at most once a day, and not if they already
//         added something today. Nothing about anyone's money is read or sent.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TEXT: Record<string, { title: string; body: string }> = {
  en: { title: "My Money", body: "Did you spend anything today? Tap to add it." },
  fr: { title: "My Money", body: "Avez-vous dépensé quelque chose aujourd'hui ? Touchez pour l'ajouter." },
  mfe: { title: "My Money", body: "Eski ou finn depans kiksoz azordi? Tap pou azout li." },
};

async function keys() {
  const { data } = await db.from("app_keys").select("public_key, private_key").eq("name", "vapid").maybeSingle();
  if (data) return data;
  const k = webpush.generateVAPIDKeys();
  await db.from("app_keys").upsert({ name: "vapid", public_key: k.publicKey, private_key: k.privateKey }, { onConflict: "name", ignoreDuplicates: true });
  const again = await db.from("app_keys").select("public_key, private_key").eq("name", "vapid").single();
  return again.data!;
}

// The phone's own clock: date and HH:MM in its time zone.
function localNow(tz: string) {
  let zone = tz; try { new Intl.DateTimeFormat("en-GB", { timeZone: zone }); } catch { zone = "Indian/Mauritius"; }
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const k = await keys();
    if (req.method === "GET") return json({ publicKey: k.public_key });

    webpush.setVapidDetails("mailto:addaiprincessnhyira@gmail.com", k.public_key, k.private_key);
    const { data: subs, error } = await db.from("push_subs").select("*");
    if (error) throw error;
    let sent = 0, removed = 0;
    for (const s of subs || []) {
      const now = localNow(s.tz);
      if (now.time < s.remind_at || s.last_sent === now.date || s.last_active === now.date) continue;
      const t = TEXT[s.lang] || TEXT.en;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: t.title, body: t.body, url: "./?add=expense", tag: "daily-reminder" }), { TTL: 6 * 3600 });
        sent++;
        await db.from("push_subs").update({ last_sent: now.date }).eq("id", s.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { await db.from("push_subs").delete().eq("id", s.id); removed++; }
        else await db.from("push_subs").update({ last_sent: now.date }).eq("id", s.id); // don't retry all day
      }
    }
    return json({ checked: subs?.length || 0, sent, removed });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
