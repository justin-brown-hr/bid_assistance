(() => {
  const root = document.getElementById("appRoot");
  const toastEl = document.getElementById("toast");
  const themeBtn = document.getElementById("themeBtn");

  const THEME_KEY = "fh_theme";
  const state = new Map(); // id -> item

  let me = null;
  let settings = null;
  let selectedStyleId = "";
  let selectedProjectId = "";

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 1400);
  }

  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {}
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(cur === "dark" ? "light" : "dark");
  }
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);
  try {
    setTheme(localStorage.getItem(THEME_KEY) || "dark");
  } catch {
    setTheme("dark");
  }

  function esc(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function route() {
    const h = window.location.hash || "#/app";
    return h.startsWith("#") ? h.slice(1) : h;
  }
  function nav(path) {
    window.location.hash = "#" + path;
  }
  function render(html) {
    if (root) root.innerHTML = html;
  }

  async function api(url, opts) {
    const res = await fetch(url, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || (json && json.ok === false)) {
      throw new Error((json && json.error) ? json.error : "Request failed");
    }
    return json;
  }

  async function loadMe() {
    const j = await api("/api/me");
    me = j.username || null;
    return me;
  }

  async function loadSettings() {
    const j = await api("/api/settings");
    settings = j.settings || null;
    me = settings ? settings.username : me;
    return settings;
  }

  async function copyText(text) {
    const s = String(text || "");
    if (!s) {
      toast("Nothing to copy");
      return;
    }
    // Clipboard API only works on HTTPS or localhost — not on http://192.168.x.x:port
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(s);
        toast("Copied");
        return;
      } catch {
        /* fall through */
      }
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, s.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      toast(ok ? "Copied" : "Copy failed — select text manually");
    } catch {
      toast("Copy failed — select text manually");
    }
  }

  function buildDetailsText(p) {
    const lines = [
      `Title: ${p?.title || "(unknown)"}`,
      `URL: ${p?.url || "(unknown)"}`,
      `Budget: ${p?.budgetText || "(unknown)"}`,
      `Skills: ${Array.isArray(p?.skills) ? p.skills.join(", ") : "(unknown)"}`,
      `Client: ${p?.clientName || "(unknown)"}`,
      `Verification: ${p?.clientVerificationText || "(unknown)"}`,
      `Rate/Completion: ${p?.completionRateText || "(unknown)"}`,
      `Cool score: ${p?.scoreText || "(unknown)"}`,
      "",
      String(p?.description || ""),
    ];
    return lines.join("\n");
  }

  async function generateBidForProject(project) {
    // Always read latest selection from the DOM to avoid stale state
    const stylePickEl = document.getElementById("stylePick");
    const liveStyleId = (stylePickEl && stylePickEl.value) ? stylePickEl.value : selectedStyleId;
    selectedStyleId = liveStyleId || "";
    if (!selectedStyleId) throw new Error("Select a bid style first");
    const j = await api("/api/bid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project, styleId: selectedStyleId }),
    });
    return String(j.bid || "");
  }

  function renderAuth(kind) {
    const title = kind === "signup" ? "Sign up" : "Sign in";
    const endpoint = kind === "signup" ? "/api/signup" : "/api/signin";

    render(`
      <div class="panel" style="max-width:520px; margin:18px auto; position:static;">
        <h2>${title}</h2>
        <div class="sub">Each user has their own OpenAI key + bid styles.</div>
        <div class="field"><div class="label">Username</div><input id="u" type="text" /></div>
        <div class="field"><div class="label">Passcode</div><input id="p" type="password" /></div>
        <div class="panelActions">
          <button id="go" class="btnPrimary" type="button">${title}</button>
          <button id="swap" class="btn" type="button">${kind === "signup" ? "Have account? Sign in" : "New user? Sign up"}</button>
        </div>
        <div id="msg" class="resultMeta"></div>
      </div>
    `);

    document.getElementById("swap")?.addEventListener("click", () =>
      nav(kind === "signup" ? "/signin" : "/signup"),
    );

    document.getElementById("go")?.addEventListener("click", async () => {
      const username = (document.getElementById("u")?.value || "").trim();
      const passcode = document.getElementById("p")?.value || "";
      const msg = document.getElementById("msg");

      try {
        await api(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, passcode }),
        });
        await loadMe();
        await loadSettings();
        nav("/app");
      } catch (e) {
        if (msg) msg.textContent = "Error: " + (e?.message || String(e));
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
          <div class="sub">${esc(me || "")}</div>
          <div class="panelActions">
            <button id="back" class="btn" type="button">Back</button>
            <button id="logout" class="btn" type="button">Logout</button>
          </div>
        </aside>
        <div>
          <div class="card">
            <div class="metaRow"><span><b>OpenAI key:</b> <span class="muted">${hasKey ? "Saved" : "Missing"}</span></span></div>
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
                ${styles.map((s) => `<option value="${esc(s.styleId)}">${esc(s.name)}</option>`).join("")}
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

    document.getElementById("back")?.addEventListener("click", () => nav("/app"));
    document.getElementById("logout")?.addEventListener("click", async () => {
      await fetch("/api/logout", { method: "POST" }).catch(() => {});
      nav("/signin");
    });

    document.getElementById("saveKey")?.addEventListener("click", async () => {
      const openaiKey = document.getElementById("key")?.value || "";
      const kmsg = document.getElementById("kmsg");
      try {
        await api("/api/settings/openai", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ openaiKey }),
        });
        await loadSettings();
        if (kmsg) kmsg.textContent = "Saved.";
      } catch (e) {
        if (kmsg) kmsg.textContent = "Error: " + (e?.message || String(e));
      }
    });

    let curStyleId = "";
    document.getElementById("styleSel")?.addEventListener("change", async (ev) => {
      curStyleId = ev.target.value || "";
      if (!curStyleId) return;
      const smsg = document.getElementById("smsg");
      try {
        const j = await api("/api/settings/styles/" + encodeURIComponent(curStyleId));
        document.getElementById("sn").value = j.style.name || "";
        document.getElementById("st").value = j.style.text || "";
      } catch (e) {
        if (smsg) smsg.textContent = "Error: " + (e?.message || String(e));
      }
    });

    document.getElementById("newS")?.addEventListener("click", () => {
      curStyleId = "";
      document.getElementById("styleSel").value = "";
      document.getElementById("sn").value = "";
      document.getElementById("st").value = "";
    });

    document.getElementById("saveS")?.addEventListener("click", async () => {
      const name = document.getElementById("sn")?.value || "";
      const text = document.getElementById("st")?.value || "";
      const smsg = document.getElementById("smsg");
      try {
        await api("/api/settings/styles", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ styleId: curStyleId || undefined, name, text }),
        });
        await loadSettings();
        nav("/profile");
      } catch (e) {
        if (smsg) smsg.textContent = "Error: " + (e?.message || String(e));
      }
    });

    document.getElementById("delS")?.addEventListener("click", async () => {
      if (!curStyleId) return;
      await api("/api/settings/styles/" + encodeURIComponent(curStyleId), { method: "DELETE" });
      await loadSettings();
      nav("/profile");
    });
  }

  function fmtTimeAgo(ms) {
    const d = Date.now() - ms;
    const s = Math.max(0, Math.floor(d / 1000));
    if (s < 60) return s + "s ago";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 48) return h + "h ago";
    const days = Math.floor(h / 24);
    return days + "d ago";
  }

  function renderCard(item) {
    const p = item.project || {};
    const title = esc(p.title || "(no title)");
    const url = esc(p.url || "#");
    const budget = esc(p.budgetText || "—");
    const score = esc(p.scoreText || "—");
    const rate = esc(p.completionRateText || "—");
    const client = esc(p.clientName || "Unknown");
    const verif = esc(p.clientVerificationText || "None");
    const desc = p.description ? String(p.description) : "";
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
            <div class="metaRow">
              <span>Client <span class="muted">${client}</span></span>
              <span>Verification <span class="muted">${verif}</span></span>
            </div>
            <div class="actions">
              <button class="btnPrimary" type="button" data-action="write-bid">Write bid</button>
              <button class="btn" type="button" data-action="toggle">${exp ? "Hide" : "More"}</button>
            </div>
            ${exp ? `<div class="details"><div class="descBox">${esc(desc || "(no description)")}</div></div>` : ""}
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
    else gridEl.insertAdjacentHTML("afterbegin", html);
  }

  function renderListRow(item, isSelected) {
    const p = item.project || {};
    const title = esc(p.title || "(no title)");
    const url = esc(p.url || "#");
    const budget = esc(p.budgetText || "—");
    const score = esc(p.scoreText || "—");
    const rate = esc(p.completionRateText || "—");
    const client = esc(p.clientName || "Unknown");
    const country = esc(p.clientCountry || "—");
    const verif = esc(p.clientVerificationText || "None");
    const desc = p.description ? String(p.description) : "";
    const snippet = desc ? esc(desc.slice(0, 220)) + (desc.length > 220 ? "… " : "") : "";
    const skills = Array.isArray(p.skills) ? p.skills.slice(0, 8) : [];
    return `
      <div class="listRow ${isSelected ? "listRowActive" : ""}" data-id="${esc(item.id)}" role="button" tabindex="0">
        <div class="listRowTop">
          <div class="listRowMain">
            <a class="listRowTitleLink" href="${url}" target="_blank" rel="noreferrer">${title}</a>
            ${snippet ? `<div class="listRowSnippet">${snippet}<span class="listRowMore">more</span></div>` : ""}
            ${skills.length ? `<div class="listRowSkills">${skills.map((s) => `<span>${esc(s)}</span>`).join('<span class="skillsDot">·</span>')}</div>` : ""}
            <div class="listRowMeta">
              <span class="muted">${esc(fmtTimeAgo(item.foundAt))}</span>
              <span class="muted">${budget}</span>
              <span class="muted">${score}</span>
              <span class="muted">${rate}</span>
              <span class="muted">${client}</span>
              <span class="muted">${verif}</span>
            </div>
          </div>
          <div class="listRowActions">
            <button class="btn" type="button" data-action="copy-url" data-id="${esc(item.id)}">Copy URL</button>
            <button class="btn" type="button" data-action="copy-details" data-id="${esc(item.id)}">Copy details</button>
            <button class="btnPrimary" type="button" data-action="write-bid" data-id="${esc(item.id)}">Write bid</button>
            <div class="listRowSideMeta">
              <div class="muted">${budget}</div>
              <div class="muted">${country}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderApp() {
    const hasKey = settings?.hasOpenaiKey === true;
    const styles = settings?.styles || [];

    render(`
      <div class="layout">
        <div class="pane">
          <div class="panel" style="position:static; top:auto; margin-bottom:12px;">
            <h2>Projects</h2>
            <div class="sub">Freelancer-style list with actions.</div>
          </div>
          <div id="list" class="list"></div>
        </div>
        <aside class="panel panelScroll pane">
          <h2>Main</h2>
          <div class="sub">Key: ${hasKey ? "Saved" : "Missing"} • User: ${esc(me || "")}</div>
          <div class="panelActions">
            <button id="profile" class="btn" type="button">Profile</button>
            <button id="logout" class="btn" type="button">Logout</button>
          </div>
          <div class="field">
            <div class="label">Bid style</div>
            <select id="stylePick" style="width:100%; border:1px solid var(--border); border-radius:10px; padding:10px; font-size:13px; background:var(--input); color:var(--text);">
              <option value="">Select style…</option>
              ${styles.map((s) => `<option value="${esc(s.styleId)}">${esc(s.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <div class="label">Manual input (separate)</div>
            <textarea id="manualBox" placeholder="Paste project details here (no URL required)."></textarea>
            <div class="panelActions">
              <button id="writeBidManual" class="btn" type="button">Write bid (manual)</button>
            </div>
          </div>
          <div class="field">
            <div class="label">Generated bid</div>
            <div class="bidTopActions">
              <button id="copyBid" class="btn" type="button" disabled>Copy</button>
            </div>
            <div id="bidOut" class="resultBox">Use “Write bid” on a project row, or “Write bid (manual)”.</div>
          </div>
        </aside>
      </div>
    `);

    const listEl = document.getElementById("list");
    const bidOut = document.getElementById("bidOut");
    const copyBtn = document.getElementById("copyBid");
    const writeManualBtn = document.getElementById("writeBidManual");
    const manualBoxEl = document.getElementById("manualBox");

    document.getElementById("profile")?.addEventListener("click", () => nav("/profile"));
    document.getElementById("logout")?.addEventListener("click", async () => {
      await fetch("/api/logout", { method: "POST" }).catch(() => {});
      nav("/signin");
    });
    document.getElementById("stylePick")?.addEventListener("change", (ev) => {
      selectedStyleId = ev.currentTarget?.value || ev.target?.value || "";
    });

    copyBtn.addEventListener("click", async () => {
      await copyText(String(bidOut.textContent || ""));
    });

    function setBid(text, isErr) {
      bidOut.textContent = text;
      copyBtn.disabled = !text || isErr;
    }

    function rerenderList() {
      if (!listEl) return;
      const items = Array.from(state.values()).sort((a, b) => (b.foundAt || 0) - (a.foundAt || 0));
      const max = 50;
      const sliced = items.slice(0, max);
      listEl.innerHTML = sliced
        .map((it) => renderListRow(it, it.id === selectedProjectId))
        .join("");
    }

    listEl?.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest("button[data-action][data-id]");
      if (btn) {
        const action = btn.getAttribute("data-action");
        const id = btn.getAttribute("data-id") || "";
        const item = state.get(id);
        if (!item) return;
        if (action === "copy-url") {
          void copyText(item.project?.url || "");
          return;
        }
        if (action === "copy-details") {
          void copyText(buildDetailsText(item.project));
          return;
        }
        if (action === "write-bid") {
          (async () => {
            try {
              setBid("Generating…", false);
              const bid = await generateBidForProject(item.project);
              setBid(bid, false);
            } catch (err) {
              setBid("Error: " + (err?.message || String(err)), true);
            }
          })();
          return;
        }
      }

      const row = e.target.closest && e.target.closest("div.listRow[data-id]");
      if (!row) return;
      selectedProjectId = row.getAttribute("data-id") || "";
      rerenderList();
    });

    writeManualBtn?.addEventListener("click", async () => {
      const raw = String(manualBoxEl?.value || "").trim();
      if (!raw) return setBid("Error: paste project details first", true);
      try {
        setBid("Generating…", false);
        const urlMatch = raw.match(/https?:\/\/\S+/i);
        const url = (urlMatch?.[0] || "").replace(/[)\],.]+$/, "");
        const firstLine = raw.split("\n").map((l) => l.trim()).find(Boolean) || "Manual project";
        const title = firstLine.length > 4 ? firstLine.slice(0, 120) : "Manual project";
        const project = { title, url: url || "manual://input", description: raw, skills: [] };
        const bid = await generateBidForProject(project);
        setBid(bid, false);
      } catch (err) {
        setBid("Error: " + (err?.message || String(err)), true);
      }
    });

    (async () => {
      try {
        const j = await api("/api/items");
        (j.items || []).forEach((it) => state.set(it.id, it));
        rerenderList();
        if (!selectedProjectId) {
          const first = (j.items || [])[0];
          if (first?.id) selectedProjectId = first.id;
        }
      } catch {}
      try {
        const es = new EventSource("/events");
        es.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg && msg.item) {
              state.set(msg.item.id, msg.item);
              rerenderList();
              if (!selectedProjectId) selectedProjectId = msg.item.id;
            }
          } catch {}
        };
      } catch {}
    })();
  }

  async function router() {
    const r = route();
    if (r === "/signin") return renderAuth("signin");
    if (r === "/signup") return renderAuth("signup");
    try {
      await loadMe();
      if (!me) {
        nav("/signin");
        return;
      }
      await loadSettings();
    } catch {
      nav("/signin");
      return;
    }
    if (r === "/profile") return renderProfile();
    return renderApp();
  }

  window.addEventListener("hashchange", () => void router());
  void router();
})();

