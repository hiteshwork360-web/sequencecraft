# SequenceCraft 🚀
### AI-Powered Cold Email Sequence Generator

A hyper-personalised cold email tool that researches each prospect and writes 5-email sequences engineered for replies and booked demos.

---

## 🗂 Project Structure

```
sequencecraft/
├── api/
│   └── generate.js        ← Vercel Edge Function (your API key lives here, safely)
├── public/
│   └── index.html         ← The full app (HTML + CSS + JS, single file)
├── vercel.json            ← Routing config
└── README.md
```

---

## 🚀 Deploy to Vercel in 10 Minutes

### Step 1 — Get your Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Click **"API Keys"** in the left sidebar
4. Click **"Create Key"** → give it a name → copy the key (starts with `sk-ant-...`)
5. **Save it somewhere safe** — you won't see it again

> 💡 **Cost estimate:** Claude Sonnet costs ~$3 per million input tokens. One full sequence generation for 5 prospects ≈ $0.05–0.10. Very cheap.

---

### Step 2 — Put the code on GitHub

1. Go to [github.com](https://github.com) → Sign up / Log in
2. Click the **"+"** top right → **"New repository"**
3. Name it `sequencecraft` → set to **Public** → click **"Create repository"**
4. On the next screen, click **"uploading an existing file"**
5. Upload ALL files maintaining the folder structure:
   - `api/generate.js`
   - `public/index.html`
   - `vercel.json`
   - `README.md`
6. Click **"Commit changes"**

> 💡 **Easier alternative:** Install [GitHub Desktop](https://desktop.github.com/), create a new repo, drag the `sequencecraft` folder in, and push.

---

### Step 3 — Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) → Sign up with your GitHub account
2. Click **"Add New Project"**
3. Find your `sequencecraft` repo → click **"Import"**
4. Leave all settings as default (Vercel auto-detects the config)
5. Click **"Deploy"**
6. ⏳ Wait ~60 seconds for the first deploy to finish
7. You'll see a green ✅ and a URL like `sequencecraft-abc123.vercel.app`

---

### Step 4 — Add your API Key (the important bit)

Your app will be live but won't work yet — we need to add the API key securely.

1. In Vercel dashboard, click your project
2. Go to **Settings** → **Environment Variables**
3. Click **"Add New"**
4. Set:
   - **Key:** `ANTHROPIC_API_KEY`
   - **Value:** `sk-ant-your-key-here` (paste your key)
   - **Environment:** select all three (Production, Preview, Development)
5. Click **"Save"**
6. Go to **Deployments** tab → click the **three dots** on the latest deploy → **"Redeploy"**
7. Wait ~30 seconds

✅ **Your app is now live and working for everyone!**

---

## 🌐 Your Live URL

After deploy, Vercel gives you:
- `https://sequencecraft-[random].vercel.app` (auto-generated)
- You can set a **custom domain** (e.g. `sequencecraft.yourdomain.com`) for free in Vercel Settings → Domains

---

## 🔒 Security — How the Key Stays Safe

```
User's browser  →  /api/generate (your Vercel function)  →  Anthropic API
                        ↑
                  API key lives here
                  (in Vercel env vars, never sent to browser)
```

- The `ANTHROPIC_API_KEY` never appears in the HTML file
- Users cannot see or steal it through browser DevTools
- Vercel encrypts it and only injects it server-side at runtime

---

## 💸 Cost Management (Optional)

To avoid surprise bills, set spending limits:

1. Anthropic Console → **Settings** → **Billing** → **Usage Limits**
2. Set a monthly hard cap (e.g. $20/month)
3. Vercel free tier includes 100GB bandwidth + 100 serverless function invocations/day — more than enough to start

---

## ✏️ Making Changes

1. Edit `public/index.html` on your computer
2. Commit and push to GitHub
3. Vercel auto-deploys every push within ~30 seconds

---

## 🆘 Troubleshooting

| Problem | Fix |
|---|---|
| "Generation failed" error | Check API key is set correctly in Vercel env vars and redeployed |
| Blank page | Check browser console (F12) for errors; make sure `vercel.json` was uploaded |
| "401 Unauthorized" | API key is wrong or expired — regenerate at console.anthropic.com |
| "429 Rate limit" | Too many requests — Anthropic free tier has limits; upgrade to paid |
| Changes not showing | Hard refresh (Ctrl+Shift+R) or check Vercel deployments tab |

---

## 📦 Tech Stack

- **Frontend:** Pure HTML/CSS/JS — zero build step, zero dependencies (except SheetJS CDN for Excel parsing)
- **Backend:** Vercel Edge Function (Node.js) — single 50-line file
- **AI:** Anthropic Claude Sonnet 4 via REST API
- **Hosting:** Vercel free tier

---

Built with SequenceCraft · Powered by Claude
