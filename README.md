# My Money

A personal money tracker you install on your phone's home screen (PWA).
Log money in and expenses, snap a receipt, pick what it falls under, and the dashboard updates.

- **Frontend:** plain HTML/CSS/JS, hosted on GitHub Pages
- **Backend:** Supabase project `money-tracker` (auth, `transactions` + `settings` tables with row-level security, private `receipts` storage bucket)
- **Receipt reading:** Supabase Edge Function `read-receipt`, which calls Google Gemini using the `GEMINI_API_KEY` secret

The key in `config.js` is Supabase's *publishable* key, which is meant to be public; row-level security keeps each account's data private.
