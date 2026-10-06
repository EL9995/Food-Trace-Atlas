# LINE bot setup

The bot lets family and friends add a LINE account, pick how often and which recalls, and get reports as swipeable cards with FDA's photos. It runs free on Cloudflare Workers and reads the recall data the site already publishes.

Try it first with no accounts: open `bot/sim.html` through a local web server (for example `python3 -m http.server` in the repo, then http://localhost:8000/bot/sim.html).

## What it stores

Only each person's LINE user ID, how often they want reports, and their picks. Sending **Stop**, or blocking the account, deletes it. Phone numbers, names and emails are never seen or stored.

## One-time setup (about 20 minutes)

Menus move around, so if a step doesn't match what you see, follow LINE's or Cloudflare's current help pages.

### 1. LINE (you do this; it needs your LINE login)

1. Create a LINE Official Account (free plan) in LINE Official Account Manager.
2. In its **Settings → Messaging API**, enable the Messaging API. This creates a channel in the LINE Developers Console.
3. In LINE Developers Console → your channel:
   - **Basic settings:** copy the **Channel secret**.
   - **Messaging API:** issue a long-lived **Channel access token** and copy it.
4. In LINE Official Account Manager → **Response settings:** turn **off** the automatic greeting and auto-reply messages, and turn **on** webhooks. Otherwise people get two answers.
5. Check the free plan's monthly message allowance for your account's country. Replies are free; scheduled reports count toward it.

### 2. Cloudflare (you do this; it needs your account)

1. Create a free Cloudflare account.
2. **Storage & Databases → KV → Create** a namespace named `food-trace-subscribers`. Send Claude its **ID** (not a secret) to put in `bot/wrangler.toml`.
3. **My Profile → API Tokens → Create Token** with the "Edit Cloudflare Workers" template. Copy the token.
4. Copy your **Account ID** (shown on the Workers & Pages overview).

### 3. GitHub secrets (you do this)

In the repo on GitHub: **Settings → Secrets and variables → Actions → New repository secret**, add:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token from Cloudflare step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | account ID from Cloudflare step 4 |
| `LINE_CHANNEL_SECRET` | channel secret from LINE step 3 |
| `LINE_CHANNEL_ACCESS_TOKEN` | access token from LINE step 3 |

Never paste these into a chat, a commit or a file.

### 4. Deploy and connect

1. Once the KV ID is in `bot/wrangler.toml` and pushed, the **Deploy LINE bot** workflow publishes the Worker. Its address looks like `https://food-trace-line-bot.<your-subdomain>.workers.dev`.
2. In LINE Developers Console → **Messaging API → Webhook URL**, enter that address plus `/line`, turn on **Use webhook**, and press **Verify**.
3. Share the account's QR code or add-friend link (Messaging API tab) with family and friends.

## How it behaves

- **Add friend:** asks Daily or Weekly, then which recalls (Groceries, Pet food, Supplements, Baby food, Cosmetics, Drugs & devices, or Everything).
- **Weekly:** every Monday around 10 am Eastern (9 am in winter; the schedule runs on UTC), the previous Monday–Sunday, even if quiet.
- **Daily:** around 10 am Eastern, only when FDA posted something new in their picks.
- **Any time:** "Latest report", "Settings", "Help", "Stop".
- Report facts come straight from FDA.gov data. The bot never writes or rewords them.
