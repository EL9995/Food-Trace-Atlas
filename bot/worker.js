// Cloudflare Worker for the Food Trace Atlas LINE bot.
//   POST /line   LINE webhook: follow, unfollow and text messages (replies are free on LINE).
//   cron         Daily run: pushes reports to subscribers (pushes count toward LINE's monthly quota).
// Storage: Workers KV, one key per subscriber ("u:<LINE user ID>") holding only their settings.
// Secrets (set in Cloudflare, never in this repo): LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN.
import { onFollow, onText, scheduled, SITE } from './core.js';

const LINE = 'https://api.line.me/v2/bot/message';
const DATA_URL = SITE + 'data/recalls.json';

async function validSignature(body, signature, secret) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

async function line(env, path, payload) {
  const res = await fetch(`${LINE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error(`LINE ${path} ${res.status}: ${await res.text()}`);
  return res.ok;
}

async function loadData() {
  const res = await fetch(DATA_URL, { cf: { cacheTtl: 600 } });
  if (!res.ok) throw new Error(`recall data ${res.status}`);
  return res.json();
}

const getUser = async (env, id) => JSON.parse((await env.SUBSCRIBERS.get(`u:${id}`)) || 'null');
const saveUser = (env, id, user) => (user ? env.SUBSCRIBERS.put(`u:${id}`, JSON.stringify(user)) : env.SUBSCRIBERS.delete(`u:${id}`));

async function handle(env, ev) {
  const id = ev.source?.userId;
  if (!id || ev.source.type !== 'user') return; // ignore group chats
  const now = new Date().toISOString();
  if (ev.type === 'unfollow') return saveUser(env, id, null); // blocked the bot: delete settings
  let result;
  if (ev.type === 'follow') result = onFollow(now);
  else if (ev.type === 'message' && ev.message.type === 'text') {
    const user = await getUser(env, id);
    const needsData = user?.step === 'done';
    result = onText(user, ev.message.text, { now, data: needsData ? await loadData() : null });
  } else return;
  await saveUser(env, id, result.user);
  if (ev.replyToken && result.messages.length) await line(env, 'reply', { replyToken: ev.replyToken, messages: result.messages.slice(0, 5) });
}

async function runReports(env) {
  const data = await loadData();
  const users = [];
  let cursor;
  do {
    const page = await env.SUBSCRIBERS.list({ prefix: 'u:', cursor });
    for (const k of page.keys) users.push([k.name.slice(2), JSON.parse(await env.SUBSCRIBERS.get(k.name))]);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const sends = scheduled(users.filter(([, u]) => u), data, new Date().toISOString());
  for (const s of sends) {
    if (await line(env, 'push', { to: s.id, messages: s.messages.slice(0, 5) })) await saveUser(env, s.id, s.user);
  }
  console.log(`report run: ${users.length} subscribers, ${sends.length} reports sent`);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return new Response('Food Trace Atlas LINE bot is running.');
    if (req.method !== 'POST' || url.pathname !== '/line') return new Response('Not found', { status: 404 });
    const body = await req.text();
    if (!(await validSignature(body, req.headers.get('x-line-signature'), env.LINE_CHANNEL_SECRET))) return new Response('Bad signature', { status: 401 });
    const { events = [] } = JSON.parse(body);
    ctx.waitUntil(Promise.all(events.map((ev) => handle(env, ev).catch((e) => console.error('event failed', e)))));
    return new Response('OK');
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReports(env));
  },
};
