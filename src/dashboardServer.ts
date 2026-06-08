import http from "node:http";
import type { FastDecision, Project } from "./types.js";
import { cfg } from "./config.js";
import OpenAI from "openai";
import crypto from "node:crypto";
import { DashboardDbSqlite } from "./dashboardDbSqlite.js";
import { readFileSync } from "node:fs";
import path from "node:path";

// Static assets served from src/dashboard-static/
function dashboardStaticPath(relPath: string): string {
  return path.join(process.cwd(), "src", "dashboard-static", relPath);
}

function getStaticAppJs(): string {
  return readFileSync(dashboardStaticPath("app.js"), "utf8");
}

/* const DASHBOARD_APP_JS = String.raw`(() => {
  const root = document.getElementById('appRoot');
  const toastEl = document.getElementById('toast');
  const themeBtn = document.getElementById('themeBtn');
  const THEME_KEY = 'fh_theme';

  const state = new Map(); // id -> item
  let me = null;
  let settings = null;
  let selectedStyleId = '';

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 1400);
  }

  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch {}
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    setTheme(cur === 'dark' ? 'light' : 'dark');
  }
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  try { setTheme(localStorage.getItem(THEME_KEY) || 'dark'); } catch { setTheme('dark'); }

  function esc(s) {
    return String(s)
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#39;");
  }

  function route() {
    const h = window.location.hash || '#/app';
    return h.startsWith('#') ? h.slice(1) : h;
  }
  function nav(path) {
    window.location.hash = '#' + path;
  }
  function render(html) {
    if (root) root.innerHTML = html;
  }

  async function api(url, opts) {
    const res = await fetch(url, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || (json && json.ok === false)) {
      throw new Error((json && json.error) ? json.error : 'Request failed');
    }
    return json;
  }

  async function loadMe() {
    const j = await api('/api/me');
    me = j.username || null;
    return me;
  }

  async function loadSettings() {
    const j = await api('/api/settings');
    settings = j.settings || null;
    me = settings ? settings.username : me;
    return settings;
  }

  function fmtTimeAgo(ms) {
    const d = Date.now() - ms;
    const s = Math.max(0, Math.floor(d / 1000));
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 48) return h + 'h ago';
    const days = Math.floor(h / 24);
    return days + 'd ago';
  }

  function renderCard(item) {
    const p = item.project || {};
    const title = esc(p.title || '(no title)');
    const url = esc(p.url || '#');
    const budget = esc(p.budgetText || '—');
    const score = esc(p.scoreText || '—');
    const rate = esc(p.completionRateText || '—');
    const client = esc(p.clientName || 'Unknown');
    const verif = esc(p.clientVerificationText || 'None');
    const desc = p.description ? String(p.description) : '';
    const snippet = desc ? esc(desc.slice(0, 180)) + (desc.length > 180 ? '…' : '') : '';
    const exp = item.__expanded === true;
    return `
      <div class="card" data-id="${esc(item.id)}">
        <div class="top">
          <div style="min-width:0;">
            <p class="title"><a href="${url}" target="_blank" rel="noreferrer">${title}</a></p>
            <div class="metaRow">
              <span class="muted">${esc(fmtTimeAgo(item.foundAt))}</span>
              <span>Budget <span class="muted">${budget}</span></span>
              <span>Cool <span class="muted">${score}</span></span>
              <span>Rate <span class="muted">${rate}</span></span>
            </div>
            ${snippet ? `<div class="subtitle">${snippet}</div>` : ''}
            <div class="metaRow">
              <span>Client <span class="muted">${client}</span></span>
              <span>Verification <span class="muted">${verif}</span></span>
            </div>
            <div class="actions">
              <button class="btnPrimary" type="button" data-action="write-bid">Write bid</button>
              <button class="btn" type="button" data-action="toggle">${exp ? 'Hide' : 'More'}</button>
            </div>
            ${exp ? `<div class="details"><div class="descBox">${esc(desc || '(no description)')}</div></div>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function upsertGrid(gridEl, item) {
    state.set(item.id, item);
    const existing = gridEl.querySelector('[data-id="' + CSS.escape(item.id) + '"]');
    const html = renderCard(item);
    if (existing) existing.outerHTML = html;
    else gridEl.insertAdjacentHTML('afterbegin', html);
    const cards = gridEl.querySelectorAll('.card');
    const max = 50;
    for (let i = max; i < cards.length; i++) cards[i].remove();
  }

  function renderAuth(kind) {
    const title = kind === 'signup' ? 'Sign up' : 'Sign in';
    const endpoint = kind === 'signup' ? '/api/signup' : '/api/signin';
    render(`
      <div class="panel" style="max-width:520px; margin:18px auto; position:static;">
        <h2>${title}</h2>
        <div class="sub">Each user has their own OpenAI key + bid styles.</div>
        <div class="field"><div class="label">Username</div><input id="u" type="text" /></div>
        <div class="field"><div class="label">Passcode</div><input id="p" type="password" /></div>
        <div class="panelActions">
          <button id="go" class="btnPrimary" type="button">${title}</button>
          <button id="swap" class="btn" type="button">${kind === 'signup' ? 'Have account? Sign in' : 'New user? Sign up'}</button>
        </div>
        <div id="msg" class="resultMeta"></div>
      </div>
    `);
    document.getElementById('swap')?.addEventListener('click', () => nav(kind === 'signup' ? '/signin' : '/signup'));
    document.getElementById('go')?.addEventListener('click', async () => {
      try {
        const username = (document.getElementById('u')?.value || '').trim();
        const passcode = (document.getElementById('p')?.value || '');
        await api(endpoint, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ username, passcode }) });
        await loadMe();
        await loadSettings();
        nav('/app');
      } catch (e) {
        document.getElementById('msg').textContent = 'Error: ' + (e?.message || String(e));
      }
    });
  }

  function renderProfile() {
    const styles = settings?.styles || [];
    const hasKey = settings?.hasOpenaiKey === true;
    render(`
      <div class="layout">
        <aside class="panel">
          <h2>Profile</h2>
          <div class="sub">${esc(me || '')}</div>
          <div class="panelActions">
            <button id="back" class="btn" type="button">Back</button>
            <button id="logout" class="btn" type="button">Logout</button>
          </div>
        </aside>
        <div>
          <div class="card">
            <div class="metaRow"><span><b>OpenAI key:</b> <span class="muted">${hasKey ? 'Saved' : 'Missing'}</span></span></div>
            <div class="field"><div class="label">Set key</div><input id="key" type="password" placeholder="sk-..." /></div>
            <div class="panelActions"><button id="saveKey" class="btnPrimary" type="button">Save key</button></div>
            <div id="kmsg" class="resultMeta"></div>
          </div>
          <div class="card" style="margin-top:12px;">
            <div class="metaRow"><span><b>Bid styles</b></span></div>
            <div class="field">
              <div class="label">Select</div>
              <select id="styleSel" style="width:100%; border:1px solid var(--border); border-radius:10px; padding:10px; font-size:13px; background:var(--input); color:var(--text);">
                <option value="">Select style…</option>
                ${styles.map(s => `<option value="${esc(s.styleId)}">${esc(s.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field"><div class="label">Name</div><input id="sn" type="text" /></div>
            <div class="field"><div class="label">Text</div><textarea id="st"></textarea></div>
            <div class="panelActions">
              <button id="newS" class="btn" type="button">New</button>
              <button id="saveS" class="btnPrimary" type="button">Save</button>
              <button id="delS" class="btn" type="button">Delete</button>
            </div>
            <div id="smsg" class="resultMeta"></div>
          </div>
        </div>
      </div>
    `);
    document.getElementById('back')?.addEventListener('click', () => nav('/app'));
    document.getElementById('logout')?.addEventListener('click', async () => { await fetch('/api/logout', { method:'POST' }).catch(() => {}); nav('/signin'); });
    document.getElementById('saveKey')?.addEventListener('click', async () => {
      try {
        const openaiKey = document.getElementById('key')?.value || '';
        await api('/api/settings/openai', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ openaiKey }) });
        await loadSettings();
        document.getElementById('kmsg').textContent = 'Saved.';
      } catch (e) {
        document.getElementById('kmsg').textContent = 'Error: ' + (e?.message || String(e));
      }
    });
    let curStyleId = '';
    document.getElementById('styleSel')?.addEventListener('change', async (ev) => {
      curStyleId = ev.target.value || '';
      if (!curStyleId) return;
      try {
        const j = await api('/api/settings/styles/' + encodeURIComponent(curStyleId));
        document.getElementById('sn').value = j.style.name || '';
        document.getElementById('st').value = j.style.text || '';
      } catch (e) {
        document.getElementById('smsg').textContent = 'Error: ' + (e?.message || String(e));
      }
    });
    document.getElementById('newS')?.addEventListener('click', () => { curStyleId=''; document.getElementById('styleSel').value=''; document.getElementById('sn').value=''; document.getElementById('st').value=''; });
    document.getElementById('saveS')?.addEventListener('click', async () => {
      try {
        const name = document.getElementById('sn')?.value || '';
        const text = document.getElementById('st')?.value || '';
        await api('/api/settings/styles', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ styleId: curStyleId || undefined, name, text }) });
        await loadSettings();
        nav('/profile');
      } catch (e) {
        document.getElementById('smsg').textContent = 'Error: ' + (e?.message || String(e));
      }
    });
    document.getElementById('delS')?.addEventListener('click', async () => {
      if (!curStyleId) return;
      await api('/api/settings/styles/' + encodeURIComponent(curStyleId), { method:'DELETE' });
      await loadSettings();
      nav('/profile');
    });
  }

  function renderApp() {
    const hasKey = settings?.hasOpenaiKey === true;
    const styles = settings?.styles || [];
    render(`
      <div class="layout">
        <div><div id="grid" class="grid"></div></div>
        <aside class="panel">
          <h2>Main</h2>
          <div class="sub">Key: ${hasKey ? 'Saved' : 'Missing'} • User: ${esc(me || '')}</div>
          <div class="panelActions">
            <button id="profile" class="btn" type="button">Profile</button>
            <button id="logout" class="btn" type="button">Logout</button>
          </div>
          <div class="field">
            <div class="label">Bid style</div>
            <select id="stylePick" style="width:100%; border:1px solid var(--border); border-radius:10px; padding:10px; font-size:13px; background:var(--input); color:var(--text);">
              <option value="">Select style…</option>
              ${styles.map(s => `<option value="${esc(s.styleId)}">${esc(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <div class="label">Generated bid</div>
            <div id="bidOut" class="resultBox">Click “Write bid” on a project.</div>
            <div class="panelActions">
              <button id="copyBid" class="btn" type="button" disabled>Copy</button>
            </div>
          </div>
        </aside>
      </div>
    `);
    document.getElementById('profile')?.addEventListener('click', () => nav('/profile'));
    document.getElementById('logout')?.addEventListener('click', async () => { await fetch('/api/logout', { method:'POST' }).catch(() => {}); nav('/signin'); });
    document.getElementById('stylePick')?.addEventListener('change', (ev) => { selectedStyleId = ev.target.value || ''; });

    const gridEl = document.getElementById('grid');
    const bidOut = document.getElementById('bidOut');
    const copyBtn = document.getElementById('copyBid');
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(String(bidOut.textContent || '')); toast('Copied'); } catch { toast('Copy failed'); }
    });
    function setBid(text, err) { bidOut.textContent = text; copyBtn.disabled = !text || err; }

    gridEl.addEventListener('click', async (e) => {
      const btn = e.target.closest && e.target.closest('button[data-action]');
      if (!btn) return;
      const card = btn.closest('.card');
      const id = card?.getAttribute('data-id');
      if (!id) return;
      const item = state.get(id);
      if (!item) return;
      if (btn.dataset.action === 'toggle') {
        item.__expanded = !item.__expanded;
        upsertGrid(gridEl, item);
      }
      if (btn.dataset.action === 'write-bid') {
        if (!selectedStyleId) { setBid('Error: select a bid style first', true); return; }
        try {
          setBid('Generating…', false);
          const j = await api('/api/bid', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ project: item.project, styleId: selectedStyleId }) });
          setBid(String(j.bid || ''), false);
        } catch (err) {
          setBid('Error: ' + (err?.message || String(err)), true);
        }
      }
    });

    (async () => {
      try {
        const j = await api('/api/items');
        (j.items || []).forEach(it => upsertGrid(gridEl, it));
      } catch {}
      try {
        const es = new EventSource('/events');
        es.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg && msg.item) upsertGrid(gridEl, msg.item);
          } catch {}
        };
      } catch {}
    })();
  }

  async function router() {
    const r = route();
    if (r === '/signin') return renderAuth('signin');
    if (r === '/signup') return renderAuth('signup');
    try {
      await loadMe();
      if (!me) { nav('/signin'); return; }
      await loadSettings();
    } catch {
      nav('/signin'); return;
    }
    if (r === '/profile') return renderProfile();
    return renderApp();
  }

  window.addEventListener('hashchange', () => { void router(); });
  void router();
})();`; */

type GenerateBidRequest = {
  apiKey: string;
  model?: string;
  style: string;
  project: Project;
};

type GenerateBidResponse =
  | { ok: true; bid: string }
  | { ok: false; error: string };

export type DashboardItem = {
  id: string;
  foundAt: number;
  project: Project;
  decision: FastDecision;
  notified: boolean;
};

function escHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const ADMIN_USERNAME = "riora";

export class DashboardServer {
  private readonly items: DashboardItem[] = [];
  private readonly clients = new Set<http.ServerResponse>();
  private server: http.Server | null = null;
  private db: DashboardDbSqlite | null = null;

  constructor(private readonly opts: { port: number; maxItems?: number }) {}

  private isAdmin(username: string | null | undefined): boolean {
    return Boolean(username && username.toLowerCase() === ADMIN_USERNAME);
  }

  private requireAdmin(cookie: string | undefined): string {
    const username = this.verifySession(cookie);
    if (!username) throw new Error("Not logged in");
    if (!this.isAdmin(username)) throw new Error("Forbidden");
    return username;
  }

  private signSession(username: string): string {
    const ts = Date.now();
    const payload = `${username}.${ts}`;
    const sig = crypto.createHmac("sha256", cfg.dashboard.authSecret).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }

  private verifySession(cookie: string | undefined): string | null {
    if (!cookie) return null;
    const m = cookie.match(/dash_session=([^;]+)/);
    if (!m) return null;
    const token = decodeURIComponent(m[1] ?? "");
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [username, tsStr, sig] = parts;
    const ts = Number(tsStr);
    if (!username || !Number.isFinite(ts)) return null;
    // 14 days
    if (Date.now() - ts > 1000 * 60 * 60 * 24 * 14) return null;
    const payload = `${username}.${tsStr}`;
    const expected = crypto.createHmac("sha256", cfg.dashboard.authSecret).update(payload).digest("base64url");
    try {
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    } catch {
      return null;
    }
    return username;
  }

  private async readJsonBody(req: http.IncomingMessage, maxBytes = 200_000): Promise<unknown> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += b.length;
      if (total > maxBytes) throw new Error("Request too large");
      chunks.push(b);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(raw);
  }

  private async generateBid(body: GenerateBidRequest): Promise<string> {
    const apiKey = body.apiKey?.trim();
    if (!apiKey) throw new Error("Missing OpenAI API key");
    const model = (body.model?.trim() || "gpt-4.1-mini");
    const style = (body.style ?? "").trim();
    if (!style) throw new Error("Bid style is empty");
    const p = body.project;
    if (!p?.title) throw new Error("Invalid project payload");

    const prompt = [
      "You are an expert freelancer writing a proposal (bid) for a Freelancer.com project.",
      "Write a concise, high-converting bid in plain text (no markdown).",
      "Keep it under 1800 characters unless the style explicitly requests longer.",
      "Include a short greeting, 2-4 bullet points of relevant experience/plan, 1-2 clarifying questions, and a friendly call to action.",
      "Do not mention that you are an AI.",
      "",
      "=== BID STYLE (follow strictly) ===",
      style,
      "",
      "=== PROJECT ===",
      `Title: ${p.title}`,
      `URL: ${p.url ?? "(none)"}`,
      `Budget: ${p.budgetText ?? "(unknown)"}`,
      `Skills: ${p.skills?.join(", ") || "(unknown)"}`,
      `Client: ${p.clientName ?? "(unknown)"}`,
      `Client country: ${p.clientCountry ?? "(unknown)"}`,
      `Verification: ${p.clientVerificationText ?? "(unknown)"}`,
      `Rate/Completion: ${p.completionRateText ?? "(unknown)"}`,
      `Cool score: ${p.scoreText ?? "(unknown)"}`,
      `Description: ${p.description ?? "(none)"}`,
    ].join("\n");

    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    });
    const text = resp.choices[0]?.message?.content ?? "";
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Empty bid generated");
    return trimmed;
  }

  start(): void {
    if (this.server) return;

    this.db = new DashboardDbSqlite({
      sqlitePath: cfg.dashboard.sqlitePath,
      authSecret: cfg.dashboard.authSecret,
    });
    try {
      this.db.connect();
      console.log(`[dashboard] SQLite ready: ${cfg.dashboard.sqlitePath}`);
    } catch (e) {
      console.error("[dashboard] SQLite init failed:", e);
    }

    this.server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname === "/app.js") {
        res.setHeader("content-type", "application/javascript; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(getStaticAppJs());
        return;
      }
      if (url.pathname === "/api/items") {
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ updatedAt: Date.now(), items: this.items }));
        return;
      }

      if (url.pathname === "/api/me") {
        const username = this.verifySession(req.headers.cookie);
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true, username, isAdmin: this.isAdmin(username) }));
        return;
      }

      if (url.pathname === "/api/admin/users" && req.method === "GET") {
        (async () => {
          try {
            if (!this.db) throw new Error("DB not ready");
            this.requireAdmin(req.headers.cookie);
            const users = this.db.listUsers();
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, users }));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.statusCode = msg === "Forbidden" ? 403 : msg === "Not logged in" ? 401 : 400;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: msg }));
          }
        })();
        return;
      }

      if (url.pathname.startsWith("/api/admin/users/") && req.method === "DELETE") {
        (async () => {
          try {
            if (!this.db) throw new Error("DB not ready");
            this.requireAdmin(req.headers.cookie);
            const target = decodeURIComponent(url.pathname.slice("/api/admin/users/".length));
            this.db.deleteUser(target);
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.statusCode = msg === "Forbidden" ? 403 : msg === "Not logged in" ? 401 : 400;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: msg }));
          }
        })();
        return;
      }

      if (url.pathname === "/api/signin" && req.method === "POST") {
        (async () => {
          try {
            if (!this.db) throw new Error("DB not ready");
            const body = (await this.readJsonBody(req)) as { username: string; passcode: string };
            const out = this.db.verifyUser(body.username, body.passcode);
            const token = this.signSession(out.username);
            res.setHeader("set-cookie", [
              `dash_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
            ]);
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, username: out.username }));
          } catch (e) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
        })();
        return;
      }

      if (url.pathname === "/api/signup" && req.method === "POST") {
        (async () => {
          try {
            if (!this.db) throw new Error("DB not ready");
            const body = (await this.readJsonBody(req)) as { username: string; passcode: string };
            const out = this.db.createUser(body.username, body.passcode);
            const token = this.signSession(out.username);
            res.setHeader("set-cookie", [
              `dash_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
            ]);
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, username: out.username }));
          } catch (e) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
        })();
        return;
      }

      if (url.pathname === "/api/logout" && req.method === "POST") {
        res.setHeader("set-cookie", ["dash_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"]);
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (url.pathname === "/api/settings") {
        (async () => {
          try {
            if (!this.db) throw new Error("DB not ready");
            const username = this.verifySession(req.headers.cookie);
            if (!username) throw new Error("Not logged in");
            const settings = {
              ...this.db.getUserSettings(username),
              isAdmin: this.isAdmin(username),
            };
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, settings }));
          } catch (e) {
            res.statusCode = 401;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
        })();
        return;
      }

      if (url.pathname.startsWith("/api/settings/styles/") && req.method === "GET") {
        (async () => {
          try {
            if (!this.db) throw new Error("DB not ready");
            const username = this.verifySession(req.headers.cookie);
            if (!username) throw new Error("Not logged in");
            const styleId = url.pathname.split("/").pop() ?? "";
            const style = this.db.getStyle(username, styleId);
            if (!style) throw new Error("Style not found");
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, style }));
          } catch (e) {
            res.statusCode = 404;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
        })();
        return;
      }

      if (url.pathname === "/api/settings/openai" && req.method === "POST") {
        (async () => {
          try {
            if (!this.db) throw new Error("DB not ready");
            const username = this.verifySession(req.headers.cookie);
            if (!username) throw new Error("Not logged in");
            const body = (await this.readJsonBody(req)) as { openaiKey: string };
            this.db.upsertOpenAiKey(username, body.openaiKey);
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
        })();
        return;
      }

      if (url.pathname === "/api/settings/styles" && req.method === "POST") {
        (async () => {
          try {
            if (!this.db) throw new Error("DB not ready");
            const username = this.verifySession(req.headers.cookie);
            if (!username) throw new Error("Not logged in");
            const body = (await this.readJsonBody(req)) as { styleId?: string; name: string; text: string };
            const r = this.db.upsertStyle(username, body);
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, styleId: r.styleId }));
          } catch (e) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
        })();
        return;
      }

      if (url.pathname.startsWith("/api/settings/styles/") && req.method === "DELETE") {
        (async () => {
          try {
            if (!this.db) throw new Error("DB not ready");
            const username = this.verifySession(req.headers.cookie);
            if (!username) throw new Error("Not logged in");
            const styleId = url.pathname.split("/").pop() ?? "";
            this.db.deleteStyle(username, styleId);
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
        })();
        return;
      }

      if (url.pathname === "/api/bid" && req.method === "POST") {
        (async () => {
          try {
            const username = this.verifySession(req.headers.cookie);
            if (!username) throw new Error("Not logged in");
            if (!this.db) throw new Error("DB not ready");
            const body = (await this.readJsonBody(req)) as {
              project: Project;
              styleId?: string;
              model?: string;
              apiKey?: string;
            };
            const apiKey = body.apiKey?.trim() || (this.db.getOpenAiKey(username) ?? "").trim();
            const styleId = (body.styleId ?? "").trim();
            if (!styleId) throw new Error("Missing styleId");
            const style = this.db.getStyle(username, styleId);
            if (!style?.text?.trim()) throw new Error("Bid style is empty");
            const bid = await this.generateBid({
              apiKey,
              model: body.model,
              style: style.text,
              project: body.project,
            });
            const out: GenerateBidResponse = { ok: true, bid };
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify(out));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const out: GenerateBidResponse = { ok: false, error: msg };
            res.statusCode = 400;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify(out));
          }
        })();
        return;
      }

      if (url.pathname === "/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "access-control-allow-origin": "*",
        });
        res.write("\n");
        this.clients.add(res);
        req.on("close", () => {
          this.clients.delete(res);
          try { res.end(); } catch { /* ignore */ }
        });
        return;
      }

      if (url.pathname !== "/") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(this.renderHtml());
    });

    this.server.listen(this.opts.port, () => {
      console.log(`[dashboard] UI: http://localhost:${this.opts.port}`);
      if (cfg?.dashboard?.bindInfo) {
        console.log(`[dashboard] ${cfg.dashboard.bindInfo}`);
      }
    });
  }

  record(item: Omit<DashboardItem, "id">): void {
    const id = `${item.project.id}:${item.foundAt}`;
    const full: DashboardItem = { ...item, id };
    this.items.unshift(full);
    const max = this.opts.maxItems ?? 200;
    if (this.items.length > max) this.items.splice(max);
    this.broadcast({ type: "project", item: full });
  }

  markNotified(projectId: string): void {
    const it = this.items.find((x) => x.project.id === projectId);
    if (!it || it.notified) return;
    it.notified = true;
    this.broadcast({ type: "update", item: it });
  }

  private broadcast(obj: unknown): void {
    const payload = `data: ${JSON.stringify(obj)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  private renderHtml(): string {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Freelancer Helper</title>
    <link rel="icon" href="https://www.freelancer.com/favicon.ico" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
    <style>
      :root { color-scheme: light dark; }
      :root[data-theme="dark"] {
        --bg: #14161e;
        --panel: #1c1f28;
        --nav-bg: #1a1d26;
        --nav-toolbar: #23262f;
        --nav-head-bg: linear-gradient(180deg, #2c303a 0%, #252830 100%);
        --nav-head-text: #c5cad3;
        --nav-border: #3a3f4b;
        --nav-row: #1a1d26;
        --nav-row-alt: #1f222c;
        --nav-row-hover: #263045;
        --nav-accent: #5b9fd4;
        --card: #1c1f28;
        --border: #2a2f3d;
        --text: #d8dce3;
        --text-desc: #e2e6ed;
        --muted: #8892a0;
        --link: #3288ff;
        --input: #232733;
        --btn: #232733;
        --btnHover: #262b38;
        --accent: #3288ff;
      }
      :root[data-theme="light"] {
        --bg: #f7f8fa;
        --panel: #ffffff;
        --card: #ffffff;
        --border: #e5e7eb;
        --text: #111827;
        --text-desc: #374151;
        --muted: #6b7280;
        --link: #0b65c2;
        --input: #ffffff;
        --btn: #ffffff;
        --btnHover: #f9fafb;
        --accent: #0b65c2;
        --nav-bg: #ffffff;
        --nav-toolbar: #f0f1f3;
        --nav-head-bg: linear-gradient(180deg, #f8f9fb 0%, #e9ecf1 100%);
        --nav-head-text: #4b5563;
        --nav-border: #c8cdd5;
        --nav-row: #ffffff;
        --nav-row-alt: #f7f8fa;
        --nav-row-hover: #e3f2fd;
        --nav-accent: #2563eb;
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body {
        margin: 0;
        font-family: Inter, Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
        font-size: 15px;
        line-height: 1.5;
        background: var(--bg);
        color: var(--text);
        overflow: hidden;
        -webkit-font-smoothing: antialiased;
        display: flex;
        flex-direction: column;
        height: 100vh;
        height: 100dvh;
      }
      header {
        background: var(--panel);
        border-bottom: 1px solid var(--border);
        padding: 14px 18px;
        display:flex;
        justify-content:space-between;
        gap:12px;
        align-items:center;
        flex-shrink: 0;
        z-index: 20;
      }
      .brandHome {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        text-decoration: none;
        color: inherit;
        border-radius: 6px;
        cursor: pointer;
      }
      .brandHome:hover { opacity: 0.92; }
      .markIcon {
        width: 34px;
        height: 34px;
        object-fit: contain;
        flex-shrink: 0;
        background: transparent;
        border-radius: 0;
        cursor: pointer;
      }
      header h1 { font-size: 14px; margin:0; font-weight: 700; letter-spacing: .2px; }
      header .meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
      .headerActions {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      .headerSession {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .headerSession.hidden { display: none; }
      .headerAdminIcon {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 38px;
        height: 38px;
        padding: 0;
        border: 1px solid rgba(37, 99, 235, 0.45);
        border-radius: 50%;
        background: var(--btn);
        color: #2563eb;
        cursor: pointer;
        flex-shrink: 0;
      }
      .headerAdminIcon:hover {
        background: rgba(37, 99, 235, 0.1);
        border-color: #2563eb;
      }
      .headerUserWrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      .headerUserRow {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .headerLogoutIcon {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 38px;
        height: 38px;
        padding: 0;
        border: 1px solid var(--border);
        border-radius: 50%;
        background: var(--btn);
        color: var(--muted);
        cursor: pointer;
      }
      .headerLogoutIcon:hover {
        background: var(--btnHover);
        color: #dc2626;
        border-color: rgba(220, 38, 38, 0.35);
      }
      .headerUserBtn {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        padding: 0;
        border: 2px solid var(--border);
        border-radius: 50%;
        background: var(--btn);
        color: var(--text);
        cursor: pointer;
        box-sizing: border-box;
      }
      .headerUserBtn.keyBorderOk {
        border-color: #2563eb;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.22);
      }
      .headerUserBtn.keyBorderMissing {
        border-color: #dc2626;
        box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.22);
      }
      .headerUserBtn:hover { background: var(--btnHover); }
      .keyStatusRing {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 2px solid var(--border);
        vertical-align: middle;
        margin-left: 6px;
        box-sizing: border-box;
      }
      .keyStatusRing.keyBorderOk { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.22); }
      .keyStatusRing.keyBorderMissing { border-color: #dc2626; box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.22); }
      .headerUserName {
        font-size: 11px;
        font-weight: 600;
        color: var(--muted);
        max-width: 88px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.2;
        text-align: center;
      }
      .adminPage {
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-sizing: border-box;
      }
      .adminPageHeader {
        flex-shrink: 0;
        margin-bottom: 12px;
      }
      .adminPageHeader h2 { margin: 0 0 4px; font-size: 18px; font-weight: 700; }
      .adminPageSub { margin: 0; font-size: 12px; color: var(--muted); }
      .adminTableHost {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .navTableShell {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--nav-border);
        border-radius: 4px;
        background: var(--nav-bg);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
        overflow: hidden;
      }
      .navTableToolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 10px;
        background: var(--nav-toolbar);
        border-bottom: 1px solid var(--nav-border);
        flex-shrink: 0;
      }
      .navTableToolbarLeft,
      .navTableToolbarRight {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .navTableIcon {
        font-size: 14px;
        color: var(--nav-accent);
        line-height: 1;
      }
      .navTableName {
        font-size: 12px;
        font-weight: 700;
        color: var(--text);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .navTableCount {
        font-size: 11px;
        color: var(--muted);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .navToolbarBtn {
        appearance: none;
        padding: 3px 10px;
        font-size: 11px;
        font-weight: 600;
        border: 1px solid var(--nav-border);
        border-radius: 3px;
        background: var(--nav-bg);
        color: var(--text);
        cursor: pointer;
      }
      .navToolbarBtn:hover { background: var(--nav-row-hover); border-color: var(--nav-accent); }
      .navTableViewport {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
      .navTable {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 12px;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .navTableHead {
        position: sticky;
        top: 0;
        z-index: 2;
        padding: 7px 10px;
        text-align: left;
        font-size: 11px;
        font-weight: 700;
        color: var(--nav-head-text);
        background: var(--nav-head-bg);
        border-bottom: 1px solid var(--nav-border);
        border-right: 1px solid var(--nav-border);
        white-space: nowrap;
        user-select: none;
      }
      .navTableHead:last-child { border-right: none; }
      .navTableCell {
        padding: 6px 10px;
        border-bottom: 1px solid var(--nav-border);
        border-right: 1px solid var(--nav-border);
        color: var(--text);
        vertical-align: middle;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        background: var(--nav-row);
      }
      .navTableCell:last-child { border-right: none; }
      .navTableRow:nth-child(even) .navTableCell { background: var(--nav-row-alt); }
      .navTableRow:hover .navTableCell { background: var(--nav-row-hover); }
      .navColNum { width: 44px; text-align: center; color: var(--muted); font-family: ui-monospace, monospace; }
      .navColCenter { width: 72px; text-align: center; }
      .navColDate { width: 168px; font-family: ui-monospace, monospace; font-size: 11px; color: var(--muted); }
      .navColAction { width: 88px; text-align: center; }
      .navTableHead.navColNum,
      .navTableHead.navColCenter,
      .navTableHead.navColAction { text-align: center; }
      .navCellUser {
        font-weight: 600;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .navCellTag {
        display: inline-block;
        margin-left: 6px;
        padding: 1px 6px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        color: #2563eb;
        background: rgba(37, 99, 235, 0.12);
        border: 1px solid rgba(37, 99, 235, 0.28);
        border-radius: 3px;
        vertical-align: middle;
      }
      .navKeyPill {
        display: inline-block;
        padding: 1px 8px;
        font-size: 11px;
        font-weight: 600;
        font-family: ui-monospace, monospace;
        border-radius: 3px;
        border: 1px solid transparent;
      }
      .navKeyOk { color: #166534; background: #dcfce7; border-color: #86efac; }
      .navKeyNo { color: #991b1b; background: #fee2e2; border-color: #fca5a5; }
      :root[data-theme="dark"] .navKeyOk { color: #86efac; background: rgba(22, 101, 52, 0.35); border-color: rgba(134, 239, 172, 0.4); }
      :root[data-theme="dark"] .navKeyNo { color: #fca5a5; background: rgba(153, 27, 27, 0.35); border-color: rgba(252, 165, 165, 0.35); }
      .navRowBtn {
        appearance: none;
        padding: 2px 10px;
        font-size: 11px;
        font-weight: 600;
        border: 1px solid var(--nav-border);
        border-radius: 3px;
        background: var(--nav-bg);
        color: var(--text);
        cursor: pointer;
      }
      .navRowBtn:hover:not(:disabled) { background: var(--nav-row-hover); }
      .navRowBtnDanger { color: #b91c1c; border-color: rgba(220, 38, 38, 0.45); }
      .navRowBtnDanger:hover:not(:disabled) { background: rgba(220, 38, 38, 0.1); color: #dc2626; }
      .navRowBtn:disabled { opacity: 0.4; cursor: not-allowed; }
      .navTableEmpty {
        padding: 24px;
        text-align: center;
        font-size: 13px;
        color: var(--muted);
        border: 1px dashed var(--nav-border);
        border-radius: 4px;
        background: var(--nav-bg);
      }
      .profilePage {
        max-width: 720px;
        margin: 0 auto;
        height: 100%;
        min-height: 0;
        overflow: auto;
        padding-bottom: 28px;
        box-sizing: border-box;
      }
      .profilePage h2 { margin: 0 0 16px; font-size: 18px; font-weight: 700; }
      .themeFab {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 60;
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 46px;
        height: 46px;
        padding: 0;
        border: 1px solid var(--border);
        border-radius: 50%;
        background: var(--panel);
        color: var(--text);
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
      }
      .themeFab:hover { background: var(--btnHover); }
      main {
        flex: 1;
        min-height: 0;
        padding: 14px 18px 20px;
        max-width: 1280px;
        width: 100%;
        margin: 0 auto;
        overflow: hidden;
        box-sizing: border-box;
      }
      .pill {
        display:inline-flex;
        align-items:center;
        gap:6px;
        padding: 4px 10px;
        border: 1px solid var(--border);
        border-radius: 999px;
        font-size: 12px;
        color: var(--muted);
        background: var(--panel);
      }
      .layout { display:grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 0.65fr); gap: 24px; align-items:start; height: 100%; min-width: 0; }
      .pane {
        min-height: 0;
        height: 100%;
        overflow: auto;
        padding-right: 6px;
        padding-bottom: 28px;
        min-width: 0;
        scrollbar-width: none;
        -ms-overflow-style: none;
        box-sizing: border-box;
      }
      .pane::-webkit-scrollbar { width: 0; height: 0; }
      .panelScroll { position: static; top: auto; }
      .bidLabelRow {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }
      .bidLabelRow .label { margin-bottom: 0; }
      .iconBtn {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--btn);
        color: var(--muted);
        cursor: pointer;
      }
      .iconBtn:hover:not(:disabled) { background: var(--btnHover); color: var(--text); }
      .iconBtn:disabled { opacity: 0.45; cursor: not-allowed; }
      .grid { display:grid; grid-template-columns: 1fr; gap: 12px; }
      .panel {
        border: 1px solid var(--border);
        background: var(--panel);
        border-radius: 8px;
        padding: 16px;
        position: sticky;
        top: 76px;
      }
      .panel h2 { margin:0; font-size:16px; font-weight: 700; color: var(--text); }
      .panel .sub { margin-top: 6px; font-size: 14px; color: var(--muted); }
      .field { margin-top: 12px; }
      .label { font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
      input[type="password"], input[type="text"], textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px;
        font-size: 15px;
        outline: none;
        background: var(--input);
        color: var(--text);
      }
      textarea { min-height: 130px; resize: vertical; }
      input:focus, textarea:focus { border-color:#93c5fd; box-shadow: 0 0 0 3px rgba(59,130,246,0.12); }
      .panelActions { display:flex; gap:8px; flex-wrap:wrap; margin-top: 12px; }
      .btnPrimary {
        appearance:none; border:1px solid var(--accent); background:var(--accent); color:#fff;
        border-radius:8px; padding:9px 14px; font-size:15px; font-weight:600; cursor:pointer;
        font-family: inherit;
      }
      .btnPrimary:hover { filter: brightness(1.06); }
      .resultBox {
        margin-top: 12px;
        background: var(--input);
        color: var(--text);
        border-radius: 8px;
        padding: 12px;
        border: 1px solid var(--border);
        white-space: pre-wrap;
        line-height: 1.5;
        font-size: 15px;
        min-height: 140px;
      }
      .resultMeta { margin-top: 10px; font-size:14px; color: var(--muted); }
      .card {
        border: 1px solid var(--border);
        background: var(--card);
        border-radius: 10px;
        padding: 14px 14px 12px;
        box-shadow: 0 1px 0 rgba(17,24,39,0.02);
      }
      .top { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
      .title { font-weight: 700; font-size: 18px; line-height: 1.25; margin:0; }
      .title a { color: var(--link); text-decoration:none; }
      .title a:hover { text-decoration:underline; }
      .subtitle { margin-top: 6px; color:#111827; font-size: 14px; line-height: 1.4; }
      .metaRow {
        margin-top: 10px;
        display:flex;
        flex-wrap:wrap;
        gap:10px 14px;
        color:#374151;
        font-size:13px;
      }
      .metaRow .muted { color:#6b7280; }
      .skillsRow {
        margin-top: 10px;
        color:#0b65c2;
        font-size: 13px;
      }
      .skillsRow span { color:#0b65c2; }
      .skillsDot { color: var(--muted); margin: 0 8px; opacity: 0.7; }
      .rightStats { min-width: 220px; text-align:right; }
      .statBig { font-size: 18px; font-weight: 800; color:#111827; }
      .statSmall { font-size: 12px; color:#6b7280; margin-top: 2px; }
      .badge {
        display:inline-flex;
        align-items:center;
        gap:6px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        border: 1px solid transparent;
      }
      .badgePass { background:#ecfdf5; color:#065f46; border-color:#a7f3d0; }
      .badgeFail { background:#fff1f2; color:#9f1239; border-color:#fecdd3; }
      .badgeCool { background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe; }
      .badgeRecruit { background:#fefce8; color:#854d0e; border-color:#fde68a; }
      .divider { margin-top: 12px; border-top: 1px solid #eef2f7; }
      .reasons { margin-top: 10px; font-size: 12px; color:#6b7280; }
      .reasons ul { margin: 6px 0 0 18px; padding: 0; }
      .reasons li { margin: 2px 0; }
      .actions { margin-top: 10px; display:flex; flex-wrap:wrap; gap:8px; }
      .btn {
        appearance: none;
        border: 1px solid var(--border);
        background: var(--btn);
        color: var(--text);
        border-radius: 8px;
        padding: 7px 12px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
      }
      .btn:hover { background: var(--btnHover); }
      .btn:active { transform: translateY(0.5px); }
      .btnLink {
        appearance: none;
        border: none;
        background: transparent;
        color: #0b65c2;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        padding: 0;
      }
      .btnLink:hover { text-decoration: underline; }
      .details {
        margin-top: 12px;
        background: #f9fafb;
        border: 1px solid #eef2f7;
        border-radius: 10px;
        padding: 12px;
        color: #111827;
      }
      .detailsGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
      .detailsGrid .k { font-size: 12px; color:#6b7280; }
      .detailsGrid .v { font-size: 13px; color:#111827; font-weight: 650; overflow-wrap:anywhere; }
      .descBox {
        margin-top: 10px;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 10px;
        white-space: pre-wrap;
        line-height: 1.45;
        font-size: 13px;
        color: #111827;
      }
      .listHeader { margin-bottom: 12px; padding: 0 2px; }
      .listHeader h2 { margin: 0; font-size: 16px; font-weight: 700; color: var(--text); }
      .listHeader .sub { margin-top: 6px; font-size: 14px; color: var(--muted); }
      .list { display:flex; flex-direction:column; gap:0; }
      .listFeed {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 8px;
        overflow: hidden;
      }
      .listRow {
        width: 100%;
        border: none;
        border-bottom: 1px solid var(--border);
        background: var(--card);
        border-radius: 0;
        padding: 20px;
        cursor: pointer;
      }
      .listRow:last-child { border-bottom: none; }
      .listRow:hover { background: var(--btnHover); }
      .listRowActive { background: var(--btnHover); outline: none; box-shadow: inset 3px 0 0 var(--link); }
      @keyframes writeBidFlash {
        0%, 100% {
          background-color: #22c55e !important;
          border-color: #16a34a !important;
          color: #fff !important;
          box-shadow: 0 0 16px rgba(34, 197, 94, 0.55) !important;
        }
        50% {
          background-color: var(--accent) !important;
          border-color: var(--accent) !important;
          box-shadow: none !important;
        }
      }
      .btnPrimary.writeBidHighlight {
        animation: writeBidFlash 0.75s ease-in-out infinite;
      }
      .listRowTop { display:flex; gap:14px; justify-content:space-between; align-items:flex-start; }
      .listRowMain { min-width:0; flex: 1; }
      .listRowActions { min-width: 0; }
      .listRowTitleLink {
        display:inline-block;
        font-weight: 700;
        font-size: 20px;
        line-height: 1.3;
        color: var(--link);
        text-decoration: none;
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        text-align: left;
        font-family: inherit;
      }
      .listRowTitleLink:hover { text-decoration: underline; }
      .listRowMeta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
        font-size: 14px;
        line-height: 1.35;
      }
      .listRowMetaLabel {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--muted);
      }
      .listRowBudget {
        font-weight: 600;
        color: var(--text);
      }
      .listRowCurrency {
        margin-left: 6px;
        font-weight: 700;
        font-size: 13px;
        color: var(--link);
        letter-spacing: 0.02em;
      }
      .clientReviewRow {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        flex-wrap: wrap;
      }
      .clientStars {
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }
      .clientStar { display: block; flex-shrink: 0; }
      .clientStarOn { color: #29b2fe; }
      .clientStarOff { color: #9ca3af; }
      :root[data-theme="dark"] .clientStarOff { color: #5c6573; }
      .clientRatingNum {
        font-size: 14px;
        font-weight: 600;
        color: var(--muted);
        min-width: 28px;
      }
      .clientReviewMsg {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 14px;
        font-weight: 600;
        color: var(--muted);
      }
      .clientReviewMsgIco { display: block; flex-shrink: 0; opacity: 0.85; }
      .listRowCountry { color: var(--text-desc); font-weight: 500; }
      .listRowCountryFlag {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .countryFlagImg {
        width: 20px;
        height: 15px;
        object-fit: cover;
        border-radius: 2px;
        border: 1px solid var(--border);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
        flex-shrink: 0;
      }
      .listRowMetaSep { color: var(--muted); opacity: 0.55; user-select: none; }
      .listRowSnippet {
        margin-top: 8px;
        font-size: 16px;
        line-height: 1.5;
        color: var(--text-desc);
      }
      .listRowSnippet[data-action="copy-details"] { cursor: pointer; }
      .listRowSnippet[data-action="copy-details"]:hover { opacity: 0.92; }
      .listRowMore { color: var(--link); font-weight: 600; margin-left: 4px; font-size: 16px; }
      .listRowSkills { margin-top: 10px; font-size: 15px; color: var(--link); line-height: 1.4; }
      .listRowSkills span { color: var(--link); }
      .listRowActions {
        display:flex;
        flex-direction:column;
        gap:8px;
        justify-content:flex-start;
        align-items:flex-end;
        min-width: 148px;
      }
      .listRowActions .btn, .listRowActions .btnPrimary { white-space: nowrap; }
      .listRowStats {
        width: 100%;
        display:flex;
        flex-direction:column;
        gap:8px;
        align-items:stretch;
      }
      .rowProgHead {
        display:flex;
        justify-content:space-between;
        gap:8px;
        font-size: 14px;
        font-weight: 600;
        color: var(--muted);
      }
      .progTrack {
        height: 6px;
        margin-top: 4px;
        background: var(--border);
        border-radius: 999px;
        overflow: hidden;
      }
      .progFill {
        height: 100%;
        border-radius: 999px;
      }
      .progFillCool {
        background: linear-gradient(90deg, #16a34a, #22c55e, #4ade80);
      }
      .progFillRate {
        background: linear-gradient(90deg, #2563eb, #3288ff, #60a5fa);
      }
      .verifRow {
        display:flex;
        gap:6px;
        justify-content:flex-end;
        flex-wrap:wrap;
        margin-top: 2px;
      }
      .verifBadge {
        display:inline-flex;
        align-items:center;
        justify-content:center;
        width: 26px;
        height: 26px;
        border-radius: 6px;
        background: rgba(50, 136, 255, 0.12);
        color: var(--link);
        border: 1px solid rgba(50, 136, 255, 0.35);
      }
      .verifIco { display:block; }
      .toast {
        position: fixed;
        right: 16px;
        bottom: 76px;
        background: rgba(17,24,39,0.92);
        color: #fff;
        padding: 10px 12px;
        border-radius: 10px;
        font-size: 12px;
        box-shadow: 0 10px 24px rgba(0,0,0,0.18);
        opacity: 0;
        pointer-events: none;
        transition: opacity .18s ease;
        max-width: 320px;
      }
      .toast.show { opacity: 1; }
    </style>
  </head>
  <body>
    <header>
      <a href="#/app" class="brandHome" id="brandHome" title="Home" aria-label="Home">
        <img class="markIcon" src="https://www.freelancer.com/favicon.ico" width="34" height="34" alt="" />
        <div>
          <h1>Freelancer Helper</h1>
          <div class="meta">Projects feed + bid writer.</div>
        </div>
      </a>
      <div class="headerActions">
        <div id="headerSession" class="headerSession hidden"></div>
      </div>
    </header>
    <main id="appRoot"></main>
    <button id="themeBtn" class="themeFab" type="button" aria-label="Toggle theme" title="Toggle theme"></button>
    <div id="toast" class="toast"></div>
    <script>
      /*
      const grid = document.getElementById('grid');
      const state = new Map();
      const MAX = ${Number(this.opts.maxItems ?? 50)};
      const toastEl = document.getElementById('toast');
      let toastTimer = null;
      const expanded = new Set();
      let selectedId = null;

      const usernameEl = document.getElementById('username');
      const passcodeEl = document.getElementById('passcode');
      const loginBtn = document.getElementById('loginBtn');
      const logoutBtn = document.getElementById('logoutBtn');
      const loginStatusEl = document.getElementById('loginStatus');

      const apiKeyEl = document.getElementById('apiKey');
      const saveKeyBtn = document.getElementById('saveKeyBtn');

      const styleSelectEl = document.getElementById('styleSelect');
      const newStyleBtn = document.getElementById('newStyleBtn');
      const saveStyleBtn = document.getElementById('saveStyleBtn');
      const deleteStyleBtn = document.getElementById('deleteStyleBtn');
      const styleNameEl = document.getElementById('styleName');
      const styleEl = document.getElementById('style');
      const genBtn = document.getElementById('genBtn');
      const copyBidBtn = document.getElementById('copyBidBtn');
      const clearBtn = document.getElementById('clearBtn');
      const pickedEl = document.getElementById('picked');
      const resultEl = document.getElementById('result');
      let loggedInUser = null;
      let currentStyleId = '';

      function syncGenEnabled() {
        const hasKey = apiKeyEl && apiKeyEl.value && apiKeyEl.value.trim().length > 0;
        const hasStyle = styleEl && styleEl.value && styleEl.value.trim().length > 0;
        const hasProject = Boolean(selectedId);
        if (genBtn) genBtn.disabled = !(hasKey && hasStyle && hasProject);
      }

      function setPicked(item) {
        selectedId = item ? item.id : null;
        if (pickedEl) {
          if (!item) pickedEl.textContent = 'No project selected.';
          else pickedEl.textContent = 'Selected: ' + (item.project?.title || item.project?.id || '');
        }
        syncGenEnabled();
      }

      function setResult(text, isError) {
        if (!resultEl) return;
        resultEl.textContent = text;
        if (copyBidBtn) copyBidBtn.disabled = !text || isError;
      }

      function setLoginUi(on) {
        const enabled = Boolean(on);
        if (logoutBtn) logoutBtn.disabled = !enabled;
        if (apiKeyEl) apiKeyEl.disabled = !enabled;
        if (saveKeyBtn) saveKeyBtn.disabled = !enabled;
        if (styleEl) styleEl.disabled = !enabled;
        if (styleNameEl) styleNameEl.disabled = !enabled;
        if (newStyleBtn) newStyleBtn.disabled = !enabled;
        if (saveStyleBtn) saveStyleBtn.disabled = !enabled;
        if (deleteStyleBtn) deleteStyleBtn.disabled = !enabled;
        if (styleSelectEl) styleSelectEl.disabled = !enabled;
        if (loginStatusEl) loginStatusEl.textContent = enabled ? ('Logged in as ' + loggedInUser) : 'Not logged in.';
        syncGenEnabled();
      }

      function fillStyles(styles) {
        if (!styleSelectEl) return;
        styleSelectEl.innerHTML = '<option value="">Select style…</option>' + (styles || []).map(s =>
          '<option value="' + esc(s.styleId) + '">' + esc(s.name) + '</option>'
        ).join('');
      }

      async function loadSettings() {
        try {
          const res = await fetch('/api/settings');
          const json = await res.json();
          if (!json || !json.ok) throw new Error(json && json.error ? json.error : 'Failed to load');
          const s = json.settings || {};
          loggedInUser = s.username || loggedInUser;
          if (apiKeyEl) apiKeyEl.value = s.openaiKey || '';
          fillStyles(s.styles || []);
          currentStyleId = '';
          if (styleNameEl) styleNameEl.value = '';
          if (styleEl) styleEl.value = '';
          setLoginUi(true);
        } catch (e) {
          toast('Settings load failed');
        }
      }

      async function login() {
        try {
          const username = usernameEl ? usernameEl.value.trim() : '';
          const passcode = passcodeEl ? passcodeEl.value : '';
          const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username, passcode }),
          });
          const json = await res.json();
          if (!json || !json.ok) throw new Error(json && json.error ? json.error : 'Login failed');
          loggedInUser = json.username;
          toast(json.created ? 'Account created' : 'Logged in');
          await loadSettings();
        } catch (e) {
          toast('Login failed');
          if (loginStatusEl) loginStatusEl.textContent = 'Login failed: ' + (e && e.message ? e.message : String(e));
          loggedInUser = null;
          setLoginUi(false);
        }
      }

      async function logout() {
        try { await fetch('/api/logout', { method: 'POST' }); } catch {}
        loggedInUser = null;
        currentStyleId = '';
        if (apiKeyEl) apiKeyEl.value = '';
        if (styleNameEl) styleNameEl.value = '';
        if (styleEl) styleEl.value = '';
        fillStyles([]);
        setLoginUi(false);
        toast('Logged out');
      }

      async function saveKey() {
        try {
          const openaiKey = apiKeyEl ? apiKeyEl.value : '';
          const res = await fetch('/api/settings/openai', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ openaiKey }),
          });
          const json = await res.json();
          if (!json || !json.ok) throw new Error(json && json.error ? json.error : 'Save failed');
          toast('Key saved');
        } catch (e) {
          toast('Key save failed');
        }
      }

      function pickStyleById(styleId) {
        if (!styleSelectEl) return;
        const opt = styleSelectEl.querySelector('option[value="' + CSS.escape(styleId) + '"]');
        if (!opt) return;
        currentStyleId = styleId;
        if (styleSelectEl) styleSelectEl.value = styleId;
      }

      async function saveStyle() {
        try {
          const name = styleNameEl ? styleNameEl.value : '';
          const text = styleEl ? styleEl.value : '';
          const res = await fetch('/api/settings/styles', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ styleId: currentStyleId || undefined, name, text }),
          });
          const json = await res.json();
          if (!json || !json.ok) throw new Error(json && json.error ? json.error : 'Save failed');
          toast('Style saved');
          await loadSettings();
          if (json.styleId) pickStyleById(json.styleId);
        } catch (e) {
          toast('Style save failed');
        }
      }

      async function deleteStyle() {
        if (!currentStyleId) return;
        try {
          const res = await fetch('/api/settings/styles/' + encodeURIComponent(currentStyleId), { method: 'DELETE' });
          const json = await res.json();
          if (!json || !json.ok) throw new Error(json && json.error ? json.error : 'Delete failed');
          toast('Style deleted');
          currentStyleId = '';
          await loadSettings();
        } catch {
          toast('Delete failed');
        }
      }

      function toast(msg) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400);
      }

      function fmtTimeAgo(ms) {
        const d = Date.now() - ms;
        const s = Math.max(0, Math.floor(d / 1000));
        if (s < 60) return s + 's ago';
        const m = Math.floor(s / 60);
        if (m < 60) return m + 'm ago';
        const h = Math.floor(m / 60);
        if (h < 48) return h + 'h ago';
        const days = Math.floor(h / 24);
        return days + 'd ago';
      }
      function esc(s) {
        return String(s)
          .replaceAll('&','&amp;')
          .replaceAll('<','&lt;')
          .replaceAll('>','&gt;')
          .replaceAll('"','&quot;')
          .replaceAll("'","&#39;");
      }

      async function copyText(text) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', 'true');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
          } catch {
            return false;
          }
        }
      }

      function buildDetails(p) {
        const title = p.title || '';
        const url = p.url || '';
        const budget = p.budgetText || '—';
        const client = p.clientName || 'Unknown';
        const country = p.clientCountry || '';
        const joinDate = p.joinDate || '';
        const verif = p.clientVerificationText || 'None';
        const cool = p.scoreText || '—';
        const rate = p.completionRateText || '—';
        const skills = Array.isArray(p.skills) ? p.skills.join(', ') : '';
        const desc = p.description || '';

        const lines = [
          'Title: ' + title,
          'URL: ' + url,
          'Budget: ' + budget,
          'Client: ' + client + (country ? ' | ' + country : '') + (joinDate ? ' | ' + joinDate : ''),
          'Verification: ' + verif,
          'Cool: ' + cool,
          'Rate: ' + rate,
          skills ? ('Skills: ' + skills) : null,
          desc ? ('Description: ' + desc) : null,
        ].filter(Boolean);
        return lines.join('\\n');
      }

      grid.addEventListener('click', async (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
        if (!btn) return;
        const card = btn.closest('.card');
        if (!card) return;
        const id = card.getAttribute('data-id');
        if (!id) return;
        const item = state.get(id);
        if (!item || !item.project) return;

        const action = btn.getAttribute('data-action');
        if (action === 'copy-url') {
          const ok = await copyText(String(item.project.url || ''));
          toast(ok ? 'URL copied' : 'Copy failed');
        } else if (action === 'copy-details') {
          const ok = await copyText(buildDetails(item.project));
          toast(ok ? 'Details copied' : 'Copy failed');
        } else if (action === 'pick') {
          setPicked(item);
          toast('Project selected');
        } else if (action === 'write-bid') {
          setPicked(item);
          await generateBidForSelected();
        } else if (action === 'toggle') {
          if (expanded.has(id)) expanded.delete(id);
          else expanded.add(id);
          upsert(item);
        }
      });

      async function generateBidForSelected() {
        const item = selectedId ? state.get(selectedId) : null;
        if (!item) return;
        syncGenEnabled();
        if (genBtn && genBtn.disabled) {
          toast('Login + set key/style first');
          return;
        }
        setResult('Generating bid…', false);
        if (genBtn) genBtn.disabled = true;
        try {
          const payload = {
            // apiKey is optional here; server will use stored per-user key when absent.
            model: undefined,
            style: styleEl ? styleEl.value : '',
            project: item.project,
          };
          const res = await fetch('/api/bid', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const json = await res.json();
          if (json && json.ok) {
            setResult(String(json.bid || ''), false);
            toast('Bid generated');
          } else {
            setResult('Error: ' + (json && json.error ? json.error : 'Failed to generate'), true);
            toast('Generation failed');
          }
        } catch (e) {
          setResult('Error: ' + (e && e.message ? e.message : String(e)), true);
          toast('Generation failed');
        } finally {
          syncGenEnabled();
        }
      }

      if (genBtn) genBtn.addEventListener('click', () => { void generateBidForSelected(); });
      if (copyBidBtn) copyBidBtn.addEventListener('click', async () => {
        const text = resultEl ? resultEl.textContent : '';
        const ok = await copyText(String(text || ''));
        toast(ok ? 'Bid copied' : 'Copy failed');
      });
      if (clearBtn) clearBtn.addEventListener('click', () => {
        if (styleEl) styleEl.value = '';
        setResult('Your generated bid will appear here.', false);
        savePrefs();
        syncGenEnabled();
      });
      if (styleEl) styleEl.addEventListener('input', syncGenEnabled);
      if (apiKeyEl) apiKeyEl.addEventListener('input', syncGenEnabled);
      if (loginBtn) loginBtn.addEventListener('click', () => { void login(); });
      if (logoutBtn) logoutBtn.addEventListener('click', () => { void logout(); });
      if (saveKeyBtn) saveKeyBtn.addEventListener('click', () => { void saveKey(); });
      if (newStyleBtn) newStyleBtn.addEventListener('click', () => {
        currentStyleId = '';
        if (styleSelectEl) styleSelectEl.value = '';
        if (styleNameEl) styleNameEl.value = '';
        if (styleEl) styleEl.value = '';
        toast('New style');
        syncGenEnabled();
      });
      if (saveStyleBtn) saveStyleBtn.addEventListener('click', () => { void saveStyle(); });
      if (deleteStyleBtn) deleteStyleBtn.addEventListener('click', () => { void deleteStyle(); });
      if (styleSelectEl) styleSelectEl.addEventListener('change', async () => {
        const styleId = styleSelectEl.value || '';
        currentStyleId = styleId;
        if (!styleId) {
          if (styleNameEl) styleNameEl.value = '';
          if (styleEl) styleEl.value = '';
          syncGenEnabled();
          return;
        }
        // Load settings and fill selected style text from list
        try {
          const res = await fetch('/api/settings');
          const json = await res.json();
          const styles = (json && json.ok && json.settings && json.settings.styles) ? json.settings.styles : [];
          const s = styles.find(x => x.styleId === styleId);
          if (s) {
            if (styleNameEl) styleNameEl.value = s.name || '';
            if (styleEl) styleEl.value = s.text || '';
          }
        } catch {}
        syncGenEnabled();
      });

      function renderItem(item) {
        const p = item.project || {};
        const ok = item.decision && item.decision.ok;
        const reasons = (item.decision && item.decision.reasons) ? item.decision.reasons : [];
        const skills = Array.isArray(p.skills) ? p.skills.slice(0, 8) : [];
        const budget = p.budgetText || '—';
        const country = p.clientCountry || '';
        const client = p.clientName || 'Unknown';
        const verif = p.clientVerificationText || 'None';
        const title = esc(p.title || '(no title)');
        const url = esc(p.url || '#');
        const score = p.scoreText ? String(p.scoreText) : '—';
        const scoreEsc = esc(score);
        const isCool = score.includes('🎅');
        const isRecruiter = p.recruiter === true;
        const joinDate = p.joinDate ? ' | ' + esc(p.joinDate) : '';
        const posted = p.postedAtText ? esc(p.postedAtText) : '';
        const rate = p.completionRateText ? esc(p.completionRateText) : '—';
        const desc = p.description ? String(p.description) : '';
        const snippet = desc ? esc(desc.slice(0, 220)) + (desc.length > 220 ? '…' : '') : '';
        const isExpanded = expanded.has(String(item.id));
        const toggleText = isExpanded ? 'Hide' : 'More';

        return \`
          <div class="card" data-id="\${esc(item.id)}">
            <div class="top">
              <div style="min-width:0;">
                <p class="title"><a href="\${url}" target="_blank" rel="noreferrer">\${title}</a></p>
                <div class="metaRow">
                  <span class="muted">\${esc(fmtTimeAgo(item.foundAt))}</span>
                  <span>Budget <span class="muted">\${esc(budget)}</span></span>
                  <span>Cool <span class="muted">\${esc(scoreEsc)}</span></span>
                  <span>Rate <span class="muted">\${esc(rate)}</span></span>
                </div>
                \${snippet ? \`<div class="subtitle">\${snippet} \${desc.length > 220 ? \`<button class="btnLink" type="button" data-action="toggle">\${toggleText}</button>\` : ''}</div>\` : ''}
                \${skills.length ? \`<div class="skillsRow">\${skills.map(s => '<span>' + esc(s) + '</span>').join('<span class="skillsDot">·</span>')}</div>\` : ''}
                <div class="metaRow">
                  <span>Client <span class="muted">\${esc(client)}\${country ? ' | ' + esc(country) : ''}\${joinDate}</span></span>
                  <span>Verification <span class="muted">\${esc(verif)}</span></span>
                </div>
                <div class="actions">
                  <button class="btnPrimary" type="button" data-action="write-bid">Write bid</button>
                  <button class="btn" type="button" data-action="pick">Select</button>
                  <button class="btn" type="button" data-action="copy-url">Copy URL</button>
                  <button class="btn" type="button" data-action="copy-details">Copy details</button>
                  \${desc.length > 0 ? \`<button class="btn" type="button" data-action="toggle">\${toggleText}</button>\` : ''}
                </div>
                \${isExpanded ? \`
                  <div class="details">
                    <div class="detailsGrid">
                      <div><div class="k">Project URL</div><div class="v">\${esc(p.url || '')}</div></div>
                      <div><div class="k">Posted</div><div class="v">\${posted || '—'}</div></div>
                      <div><div class="k">Client</div><div class="v">\${esc(client)}\${country ? ' | ' + esc(country) : ''}\${joinDate}</div></div>
                      <div><div class="k">Verification</div><div class="v">\${esc(verif)}</div></div>
                      <div><div class="k">Budget</div><div class="v">\${esc(budget)}</div></div>
                      <div><div class="k">Cool / Rate</div><div class="v">\${esc(scoreEsc)} | \${esc(rate)}</div></div>
                    </div>
                    \${desc ? \`<div class="descBox">\${esc(desc)}</div>\` : ''}
                  </div>
                \` : ''}
              </div>
              <div class="rightStats">
                <div>\${ok ? '<span class="badge badgePass">PASS</span>' : '<span class="badge badgeFail">FILTER</span>'}</div>
                <div style="margin-top:8px;">
                  \${isCool ? '<span class="badge badgeCool">COOL</span>' : ''}
                  \${isRecruiter ? '<span class="badge badgeRecruit" style="margin-left:6px;">RECRUITER</span>' : ''}
                </div>
                \${posted ? \`<div class="statSmall" style="margin-top:10px;">Posted: \${posted}</div>\` : ''}
              </div>
            </div>
            <div class="divider"></div>
            <div class="reasons">
              <span class="muted">Decision reasons:</span>
              <ul>\${reasons.map(r => '<li>' + esc(r) + '</li>').join('')}</ul>
            </div>
          </div>\`;
      }

      function upsert(item) {
        state.set(item.id, item);
        const existing = grid.querySelector('[data-id="' + CSS.escape(item.id) + '"]');
        const html = renderItem(item);
        if (existing) {
          existing.outerHTML = html;
        } else {
          grid.insertAdjacentHTML('afterbegin', html);
        }
        // Trim DOM to MAX
        const cards = grid.querySelectorAll('.card');
        for (let i = MAX; i < cards.length; i++) {
          cards[i].remove();
        }
      }

      async function loadInitial() {
        const res = await fetch('/api/items');
        const json = await res.json();
        (json.items || []).forEach(upsert);
      }

      function connectEvents() {
        const es = new EventSource('/events');
        es.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg && msg.item) upsert(msg.item);
          } catch {}
        };
      }

      loadInitial().then(connectEvents).catch(connectEvents);
      (async () => {
        try {
          const res = await fetch('/api/me');
          const json = await res.json();
          if (json && json.ok && json.username) {
            loggedInUser = json.username;
            await loadSettings();
          } else {
            setLoginUi(false);
          }
        } catch {
          setLoginUi(false);
        }
      })();
      */
    </script>
    <script src="/app.js" defer></script>
  </body>
</html>`;
  }
}

