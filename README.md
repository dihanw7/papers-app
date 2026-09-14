# Papers

MCQ / SBA / TF exam practice app: sign in with a MED number, take a paper, review locked
answers with percentage breakdowns, and see rankings + hardest-question analytics.

Stack: static frontend (Vite, no framework) + Supabase (Postgres, Auth, row-level security),
deployed on Vercel.

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project. Pick any name/region, set a
   database password (you won't need it day-to-day, Supabase manages connections for you).
2. Once it's ready, open **SQL Editor → New query**, paste in the entire contents of
   `supabase/schema.sql` from this project, and run it. This creates all five tables,
   the auto-profile trigger, and the row-level security policies.
3. Go to **Authentication → Providers → Email** and turn **"Confirm email" OFF**.
   Students sign up with a MED number, not a real inbox, so there's nothing for them to
   confirm — leaving this on will lock everyone out after sign-up.
4. Go to **Project Settings → API**. You'll need two values for step 3 below:
   - **Project URL**
   - **anon / public key** (not the service_role key — never put that in frontend code)

## 2. Configure the app locally

```bash
npm install
cp .env.example .env
```

Edit `.env` and paste in your Project URL and anon key:

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Run it locally to check everything connects:

```bash
npm run dev
```

Open the printed local URL, sign up with a test name/group/MED number, and confirm you land
on the Subjects screen.

## 3. Make yourself an admin

Sign up once through the app with the account you want to use as admin. Then, back in the
Supabase SQL Editor, run:

```sql
update public.profiles set role = 'admin' where med_no = 'YOUR_MED_NUMBER';
```

Log out and back in (or just refresh) and you'll see the **Admin** tab. This is deliberately
a manual, dashboard-only step — nobody can grant themselves admin from the app itself.
Repeat for any other lecturers/admins.

## 4. Deploy to Vercel

**Option A — from GitHub (recommended, gives you auto-deploys on every push):**

1. Push this folder to a new GitHub repo.
2. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import that repo.
   Vercel auto-detects Vite; no build settings to change.
3. Under **Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   with the same values as your `.env`.
4. Deploy. You'll get a `your-project.vercel.app` URL immediately — share that with
   students, or add a custom domain under **Project → Settings → Domains**.

**Option B — straight from your machine, no GitHub:**

```bash
npm install -g vercel
vercel login
vercel --prod
```

Follow the prompts (link/create project), then when asked, add the same two environment
variables — or set them ahead of time with:

```bash
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_ANON_KEY production
```

then `vercel --prod` again to rebuild with them applied.

## 5. Day-to-day admin use

- **Add a subject / paper**: Admin tab → Manage papers. You can type questions in by hand,
  or upload an Excel/CSV file with columns `Type` (TF or SBA), `Stem`, `OptionA`–`OptionE`,
  `Correct` (a letter, or True/False for TF rows).
- **See rankings / hardest questions**: Analytics tab, pick subject then paper. Visible to
  every signed-in user; students see their own name only, admins see everyone's.
- **Reset a student's attempt** (e.g. they were cut off mid-exam): there's no button for
  this on purpose, since attempts can't be edited from the app. In Supabase, go to
  **Table Editor → attempts**, find their row (filter by `paper_id` / `user_id`), and delete
  it — they can then retake the paper.

---

## What's different from a "real" institutional system

This is a solid tool for a class or department, not a hardened multi-tenant SaaS product.
Worth knowing before you roll it out widely:

- **Data is broadly readable to any signed-in user.** Every student can technically query
  every other student's raw attempt data via the Supabase API (not just what the UI shows),
  because the leaderboard/percentage features need that. Fine for an internal cohort tool;
  not appropriate if students shouldn't see each other's data at all.
- **No password reset flow.** If a student forgets their password, you'd currently need to
  reset it for them from Supabase's Authentication tab. Easy to add a "forgot password"
  email flow later if you switch students to real email addresses instead of MED-number
  placeholders.
- **No rate limiting / abuse protection beyond Supabase's defaults** — fine for a known,
  small user base; worth revisiting if this ever opens up publicly.

## Suggestions for running it

- Treat each paper as a timed sitting: post the link, give students a window (e.g. "live
  9–10am"), then walk through the hardest questions together in the Analytics tab right
  after — that's the moment the percentage breakdowns are most useful for teaching.
  If it's meant to be assessed as untimed practice, no changes needed — students can attempt
  in their own time and revisit results whenever.
- Keep your Excel question bank as the master copy and re-upload per paper rather than
  hand-typing — faster and fewer transcription errors.
- Because rankings are visible to the whole cohort, consider whether you want students
  identified by name (current default for admins; students only see their own name and
  "Student N" for others) — if you'd rather everyone stay anonymous to each other,
  that's a small change to the analytics rendering.
