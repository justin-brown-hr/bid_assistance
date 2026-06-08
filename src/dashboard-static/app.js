(() => {
  const root = document.getElementById("appRoot");
  const toastEl = document.getElementById("toast");
  const themeBtn = document.getElementById("themeBtn");
  const headerSessionEl = document.getElementById("headerSession");

  const THEME_KEY = "fh_theme";
  const NEW_HIGHLIGHT_MS = 10000;
  const state = new Map(); // id -> item
  const newProjectHighlights = new Set();
  const highlightTimers = new Map();

  const ADMIN_USER = "riora";

  let me = null;
  let settings = null;
  let isAdmin = false;
  let selectedStyleId = "";
  let selectedProjectId = "";
  let eventSource = null;
  let feedReady = false;

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 1400);
  }

  function themeIconSvg() {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    if (cur === "dark") {
      return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M21 14.5A8.5 8.5 0 0110.5 4 7 7 0 0021 14.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>`;
    }
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;
  }

  function updateThemeFabIcon() {
    if (!themeBtn) return;
    themeBtn.innerHTML = themeIconSvg();
  }

  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {}
    updateThemeFabIcon();
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(cur === "dark" ? "light" : "dark");
  }
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

  const brandHome = document.getElementById("brandHome");
  if (brandHome) {
    brandHome.addEventListener("click", (e) => {
      e.preventDefault();
      void (async () => {
        try {
          if (!me) await loadMe();
        } catch {}
        nav(me ? "/app" : "/signin");
      })();
    });
  }
  try {
    setTheme(localStorage.getItem(THEME_KEY) || "light");
  } catch {
    setTheme("light");
  }
  updateThemeFabIcon();

  function stopWriteBidHighlight(itemId) {
    const t = highlightTimers.get(itemId);
    if (t) clearTimeout(t);
    highlightTimers.delete(itemId);
    newProjectHighlights.delete(itemId);
  }

  function focusNewProject(itemId) {
    stopWriteBidHighlight(itemId);
    newProjectHighlights.add(itemId);
    refreshListIfOnApp();
    toast("New project");

    if (route() === "/app") {
      requestAnimationFrame(() => {
        const row = document.querySelector(`.listRow[data-id="${CSS.escape(itemId)}"]`);
        row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }

    const t = setTimeout(() => {
      stopWriteBidHighlight(itemId);
      refreshListIfOnApp();
    }, NEW_HIGHLIGHT_MS);
    highlightTimers.set(itemId, t);
  }

  function clearNewHighlights() {
    for (const id of [...highlightTimers.keys()]) stopWriteBidHighlight(id);
    newProjectHighlights.clear();
  }

  function refreshListIfOnApp() {
    const listEl = document.getElementById("list");
    if (!listEl || route() !== "/app") return;
    const items = Array.from(state.values()).sort((a, b) => (b.foundAt || 0) - (a.foundAt || 0));
    const max = 50;
    listEl.innerHTML = items
      .slice(0, max)
      .map((it) => renderListRow(it, it.id === selectedProjectId))
      .join("");
  }

  function handleSseMessage(msg) {
    if (!msg?.item) return;
    const isNewProject = feedReady && !state.has(msg.item.id);
    state.set(msg.item.id, msg.item);
    if (!feedReady) return;
    if (route() === "/app" && !selectedProjectId && isNewProject) {
      selectedProjectId = msg.item.id;
    }
    if (isNewProject) {
      focusNewProject(msg.item.id);
    } else {
      refreshListIfOnApp();
    }
  }

  function stopEventStream() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    feedReady = false;
    clearNewHighlights();
  }

  function startEventStream() {
    if (eventSource) return;
    try {
      eventSource = new EventSource("/events");
      eventSource.onmessage = (ev) => {
        try {
          handleSseMessage(JSON.parse(ev.data));
        } catch {}
      };
    } catch {}
  }

  async function bootstrapFeed() {
    stopEventStream();
    try {
      const j = await api("/api/items");
      (j.items || []).forEach((it) => state.set(it.id, it));
      refreshListIfOnApp();
      if (route() === "/app" && !selectedProjectId) {
        const first = (j.items || [])[0];
        if (first?.id) selectedProjectId = first.id;
        refreshListIfOnApp();
      }
    } catch {}
    feedReady = true;
    startEventStream();
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

  function clearHeaderSession() {
    if (!headerSessionEl) return;
    headerSessionEl.classList.add("hidden");
    headerSessionEl.innerHTML = "";
  }

  function userIconSvg() {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.8"/>
      <path d="M5 20c0-3.314 3.134-6 7-6s7 2.686 7 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;
  }

  function logoutIconSvg() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M16 17l5-5-5-5M21 12H9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  function adminIconSvg() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.418-3.134 8.168-7 9-3.866-.832-7-4.582-7-9V6l7-3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  function isAdminUser() {
    return isAdmin || (me && me.toLowerCase() === ADMIN_USER);
  }

  function updateHeaderSession() {
    if (!headerSessionEl || !me) {
      clearHeaderSession();
      return;
    }
    const hasKey = settings?.hasOpenaiKey === true;
    const keyClass = hasKey ? "keyBorderOk" : "keyBorderMissing";
    const admin = isAdminUser();
    headerSessionEl.classList.remove("hidden");
    headerSessionEl.innerHTML = `
      <div class="headerUserWrap">
        <div class="headerUserRow">
          ${
            admin
              ? `<button type="button" class="headerAdminIcon" id="headerAdminBtn" title="Admin — user management" aria-label="Admin">
              ${adminIconSvg()}
            </button>`
              : ""
          }
          <button type="button" class="headerUserBtn ${keyClass}" id="headerUserBtn" title="OpenAI key ${hasKey ? "saved" : "not saved"} — Profile" aria-label="Profile">
            ${userIconSvg()}
          </button>
          <button type="button" class="headerLogoutIcon" id="headerLogoutBtn" title="Logout" aria-label="Logout">
            ${logoutIconSvg()}
          </button>
        </div>
        <div class="headerUserName">${esc(me)}</div>
      </div>
    `;
    document.getElementById("headerAdminBtn")?.addEventListener("click", () => nav("/admin"));
    document.getElementById("headerUserBtn")?.addEventListener("click", () => nav("/profile"));
    document.getElementById("headerLogoutBtn")?.addEventListener("click", () => void doLogout());
  }

  async function doLogout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    me = null;
    settings = null;
    isAdmin = false;
    stopEventStream();
    state.clear();
    clearHeaderSession();
    nav("/signin");
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
    isAdmin = j.isAdmin === true;
    return me;
  }

  async function loadSettings() {
    const j = await api("/api/settings");
    settings = j.settings || null;
    me = settings ? settings.username : me;
    isAdmin = settings?.isAdmin === true || (me && me.toLowerCase() === ADMIN_USER);
    return settings;
  }

  async function loadAdminUsers() {
    const j = await api("/api/admin/users");
    return j.users || [];
  }

  async function deleteAdminUser(username) {
    await api("/api/admin/users/" + encodeURIComponent(username), { method: "DELETE" });
  }

  function formatDate(ms) {
    if (!ms) return "—";
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return "—";
    }
  }

  function renderAdminUserTable(users) {
    if (!users.length) {
      return `<div class="navTableEmpty">No users found.</div>`;
    }
    const rows = users
      .map((u, i) => {
        const isAdminAccount = u.username === ADMIN_USER;
        const canDelete = u.username !== ADMIN_USER && u.username !== me;
        return `
          <tr class="navTableRow">
            <td class="navTableCell navColNum">${i + 1}</td>
            <td class="navTableCell">
              <span class="navCellUser">${esc(u.username)}</span>
              ${isAdminAccount ? '<span class="navCellTag">admin</span>' : ""}
            </td>
            <td class="navTableCell">
              <span class="navKeyPill ${u.hasOpenaiKey ? "navKeyOk" : "navKeyNo"}">${u.hasOpenaiKey ? "saved" : "missing"}</span>
            </td>
            <td class="navTableCell navColCenter">${u.styleCount}</td>
            <td class="navTableCell navColDate">${esc(formatDate(u.createdAt))}</td>
            <td class="navTableCell navColAction">
              <button type="button" class="navRowBtn navRowBtnDanger" data-delete-user="${esc(u.username)}" ${canDelete ? "" : "disabled"} title="${canDelete ? "Delete user" : "Cannot delete"}">Delete</button>
            </td>
          </tr>
        `;
      })
      .join("");

    return `
      <div class="navTableShell">
        <div class="navTableToolbar">
          <div class="navTableToolbarLeft">
            <span class="navTableIcon" aria-hidden="true">▦</span>
            <span class="navTableName">users</span>
          </div>
          <div class="navTableToolbarRight">
            <span class="navTableCount">${users.length} row(s)</span>
            <button type="button" class="navToolbarBtn" id="adminRefreshBtn" title="Refresh">Refresh</button>
          </div>
        </div>
        <div class="navTableViewport">
          <table class="navTable">
            <thead>
              <tr>
                <th class="navTableHead navColNum">#</th>
                <th class="navTableHead">username</th>
                <th class="navTableHead">openai_key</th>
                <th class="navTableHead navColCenter">styles</th>
                <th class="navTableHead">created_at</th>
                <th class="navTableHead navColAction">actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  async function mountAdminPanel() {
    const listEl = document.getElementById("adminUserList");
    if (!listEl || !isAdminUser()) return;
    listEl.textContent = "Loading…";
    try {
      const users = await loadAdminUsers();
      listEl.innerHTML = renderAdminUserTable(users);
      document.getElementById("adminRefreshBtn")?.addEventListener("click", () => void mountAdminPanel());
      listEl.querySelectorAll("[data-delete-user]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const username = btn.getAttribute("data-delete-user") || "";
          if (!username || username === ADMIN_USER || username === me) return;
          if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
          try {
            await deleteAdminUser(username);
            toast("User deleted");
            await mountAdminPanel();
          } catch (e) {
            toast("Error: " + (e?.message || String(e)));
          }
        });
      });
    } catch (e) {
      listEl.textContent = "Error: " + (e?.message || String(e));
    }
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
      `Client country: ${p?.clientCountry || "(unknown)"}`,
      `Client review: ${p?.clientReviewText || "(unknown)"}`,
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
    stopEventStream();
    clearHeaderSession();
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
        await bootstrapFeed();
        nav("/app");
      } catch (e) {
        if (msg) msg.textContent = "Error: " + (e?.message || String(e));
      }
    });
  }

  function renderAdmin() {
    if (!isAdminUser()) {
      nav("/app");
      return;
    }
    updateHeaderSession();
    render(`
      <div class="adminPage">
        <div class="adminPageHeader">
          <h2>User management</h2>
          <p class="adminPageSub">Database-style user table · admin: <b>${esc(ADMIN_USER)}</b></p>
        </div>
        <div id="adminUserList" class="adminTableHost">Loading…</div>
      </div>
    `);
    void mountAdminPanel();
  }

  function renderProfile() {
    updateHeaderSession();
    const styles = settings?.styles || [];
    const hasKey = settings?.hasOpenaiKey === true;

    render(`
      <div class="profilePage">
        <h2>Profile</h2>
        <div class="card">
          <div class="metaRow"><span><b>OpenAI key:</b> <span class="keyStatusRing ${hasKey ? "keyBorderOk" : "keyBorderMissing"}" title="${hasKey ? "Saved" : "Not saved"}"></span></span></div>
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
    `);

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
        updateHeaderSession();
        const ok = settings?.hasOpenaiKey === true;
        const keyClass = ok ? "keyBorderOk" : "keyBorderMissing";
        const profileRing = document.querySelector(".profilePage .keyStatusRing");
        if (profileRing) {
          profileRing.className = "keyStatusRing " + keyClass;
          profileRing.title = ok ? "Saved" : "Not saved";
        }
        const headerBtn = document.getElementById("headerUserBtn");
        if (headerBtn) {
          headerBtn.classList.remove("keyBorderOk", "keyBorderMissing");
          headerBtn.classList.add(keyClass);
          headerBtn.title = `OpenAI key ${ok ? "saved" : "not saved"} — Profile`;
        }
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

  const COUNTRY_NAME_TO_CODE = {
    "united states": "US", "united kingdom": "GB", india: "IN", australia: "AU", canada: "CA",
    germany: "DE", france: "FR", pakistan: "PK", bangladesh: "BD", philippines: "PH",
    nigeria: "NG", indonesia: "ID", brazil: "BR", china: "CN", ukraine: "UA", russia: "RU",
    poland: "PL", romania: "RO", egypt: "EG", kenya: "KE", ghana: "GH", "south africa": "ZA",
    argentina: "AR", mexico: "MX", colombia: "CO", chile: "CL", spain: "ES", italy: "IT",
    netherlands: "NL", portugal: "PT", turkey: "TR", israel: "IL", "saudi arabia": "SA",
    uae: "AE", singapore: "SG", malaysia: "MY", thailand: "TH", vietnam: "VN", japan: "JP",
    "south korea": "KR", "new zealand": "NZ", ireland: "IE", sweden: "SE", norway: "NO",
    denmark: "DK", finland: "FI", switzerland: "CH", austria: "AT", belgium: "BE", greece: "GR",
    "sri lanka": "LK", nepal: "NP", morocco: "MA", "hong kong": "HK", taiwan: "TW",
    myanmar: "MM", cambodia: "KH", ethiopia: "ET", tanzania: "TZ", uganda: "UG",
    zimbabwe: "ZW", peru: "PE", venezuela: "VE", ecuador: "EC", bolivia: "BO",
    "czech republic": "CZ", hungary: "HU", slovakia: "SK", croatia: "HR", serbia: "RS",
    bulgaria: "BG", lithuania: "LT", latvia: "LV", estonia: "EE", slovenia: "SI",
    iraq: "IQ", iran: "IR", jordan: "JO", lebanon: "LB", kuwait: "KW", qatar: "QA",
    bahrain: "BH", oman: "OM", yemen: "YE", afghanistan: "AF", guatemala: "GT",
    honduras: "HN", "el salvador": "SV", "costa rica": "CR", panama: "PA",
    "dominican republic": "DO", cuba: "CU", jamaica: "JM", uruguay: "UY", paraguay: "PY",
    algeria: "DZ", tunisia: "TN", libya: "LY", sudan: "SD", cameroon: "CM",
    "ivory coast": "CI", senegal: "SN", kazakhstan: "KZ", uzbekistan: "UZ",
    azerbaijan: "AZ", georgia: "GE", armenia: "AM", belarus: "BY", moldova: "MD",
    "north macedonia": "MK", albania: "AL", bosnia: "BA", montenegro: "ME", kosovo: "XK",
    cyprus: "CY", malta: "MT", luxembourg: "LU", iceland: "IS", liechtenstein: "LI",
    mongolia: "MN", "north korea": "KP", laos: "LA", brunei: "BN", "timor-leste": "TL",
    "papua new guinea": "PG", fiji: "FJ", samoa: "WS", tonga: "TO",
  };

  function countryNameToCode(name) {
    const key = String(name || "").trim().toLowerCase();
    if (!key) return "";
    if (COUNTRY_NAME_TO_CODE[key]) return COUNTRY_NAME_TO_CODE[key];
    if (/^[a-z]{2}$/i.test(key)) return key.toUpperCase();
    return "";
  }

  function parseClientCountry(raw) {
    const s = String(raw || "").trim();
    if (!s) return { code: "", name: "" };

    const globeCode = s.match(/^🌍\s*([A-Za-z]{2})$/);
    if (globeCode) {
      const code = globeCode[1].toUpperCase();
      return { code, name: code };
    }

    const withoutFlag = s.replace(/^[\u{1F1E6}-\u{1F1FF}]{2}\s*/u, "").trim();
    if (withoutFlag && withoutFlag !== s) {
      const code = countryNameToCode(withoutFlag);
      return { code, name: withoutFlag };
    }

    if (/^[A-Za-z]{2}$/.test(s)) {
      const code = s.toUpperCase();
      return { code, name: code };
    }

    const code = countryNameToCode(s);
    return { code, name: s };
  }

  function flagImgUrl(code) {
    if (!code || !/^[A-Za-z]{2}$/.test(code)) return "";
    return `https://flagcdn.com/w40/${code.toLowerCase()}.png`;
  }

  function renderCountryDisplay(raw) {
    const { code, name } = parseClientCountry(raw);
    if (!name) {
      return `<span class="listRowCountry">—</span>`;
    }
    const url = flagImgUrl(code);
    if (url) {
      return `<span class="listRowCountry listRowCountryFlag" title="${esc(name)}">
        <img class="countryFlagImg" src="${url}" width="20" height="15" alt="${esc(name)}" loading="lazy" decoding="async" />
        <span>${esc(name)}</span>
      </span>`;
    }
    return `<span class="listRowCountry">${esc(name)}</span>`;
  }

  function getReviewData(p) {
    let rating = p?.clientReviewRating;
    let count = p?.clientReviewCount;
    if ((rating == null && count == null) && p?.clientReviewText) {
      const t = String(p.clientReviewText);
      if (/no reviews/i.test(t)) return { rating: 0, count: 0 };
      const rm = t.match(/([\d.]+)/);
      const cm = t.match(/(\d+)\s+reviews?/i);
      rating = rm ? parseFloat(rm[1]) : 0;
      count = cm ? parseInt(cm[1], 10) : 0;
    }
    return {
      rating: Math.max(0, Math.min(5, Number(rating) || 0)),
      count: Math.max(0, Number(count) || 0),
    };
  }

  function starIconSvg(filled) {
    const cls = filled ? "clientStar clientStarOn" : "clientStar clientStarOff";
    return `<svg class="${cls}" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" fill="currentColor"/>
    </svg>`;
  }

  function renderStarRating(rating) {
    const r = Math.max(0, Math.min(5, Number(rating) || 0));
    let stars = "";
    for (let i = 1; i <= 5; i++) {
      stars += starIconSvg(r >= i - 0.25);
    }
    return `<span class="clientStars" aria-label="Rating ${r.toFixed(1)} out of 5">${stars}</span>`;
  }

  function reviewMsgIconSvg() {
    return `<svg class="clientReviewMsgIco" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>`;
  }

  function renderClientReview(p) {
    const { rating, count } = getReviewData(p);
    return `
      <div class="clientReviewRow">
        ${renderStarRating(rating)}
        <span class="clientRatingNum">${rating.toFixed(1)}</span>
        <span class="clientReviewMsg" title="${count} review${count === 1 ? "" : "s"}">
          ${reviewMsgIconSvg()}
          <span>${count}</span>
        </span>
      </div>
    `;
  }

  function getBudgetDisplay(p) {
    const code = (p.currencyCode || "").toUpperCase();
    let amount = String(p.budgetText || "—");
    if (code && amount.endsWith(code)) {
      amount = amount.slice(0, -code.length).trim();
    }
    return { amount: esc(amount), code: code ? esc(code) : "" };
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

  function parseCoolBar(scoreText) {
    const m = String(scoreText || "").match(/(\d+)\s*\/\s*70/);
    if (!m) return { label: "—", pct: 0 };
    const n = Number(m[1]);
    return { label: `${n}/70`, pct: Math.min(100, Math.round((n / 70) * 100)) };
  }

  function parseRateBar(completionRateText) {
    const s = String(completionRateText || "");
    const pctM = s.match(/\((\d+)%\)/);
    if (pctM) {
      const head = s.replace(/\s*\(\d+%\)\s*/, "").trim();
      return { label: head || s, pct: Number(pctM[1]) };
    }
    const frac = s.match(/(\d+)\s*\/\s*(\d+)/);
    if (frac) {
      const a = Number(frac[1]);
      const b = Number(frac[2]);
      const pct = b === 0 ? 0 : Math.min(100, Math.round((a / b) * 100));
      return { label: `${a}/${b}`, pct };
    }
    return { label: s || "—", pct: 0 };
  }

  function verifIcoSvg(kind) {
    const common = 'class="verifIco" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"';
    if (kind === "payment")
      return `<svg ${common}><rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M2 10h20" stroke="currentColor" stroke-width="1.8"/></svg>`;
    if (kind === "mail")
      return `<svg ${common}><path d="M4 6h16v12H4V6z" stroke="currentColor" stroke-width="1.8"/><path d="M4 8l8 6 8-6" stroke="currentColor" stroke-width="1.8"/></svg>`;
    if (kind === "id")
      return `<svg ${common}><rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="11" r="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 16c.6-1.5 1.8-2.5 3-2.5s2.4 1 3 2.5" stroke="currentColor" stroke-width="1.5"/></svg>`;
    if (kind === "phone")
      return `<svg ${common}><path d="M8 4h3l1.5 4-2 1.2a12 12 0 005.3 5.3L17 12l4 1.5V17a2 2 0 01-2 2A14 14 0 016 6a2 2 0 012-2z" stroke="currentColor" stroke-width="1.8"/></svg>`;
    if (kind === "deposit")
      return `<svg ${common}><path d="M3 7.5h14a2 2 0 012 2v7a2 2 0 01-2 2H3V7.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 7.5V6.5a2 2 0 012-2h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16.5" cy="13" r="1.25" fill="currentColor"/></svg>`;
    return `<svg ${common}><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M8 12l2.5 2.5L16 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }

  function renderVerifIcons(verifText) {
    const s = String(verifText || "").trim();
    if (!s || s.toLowerCase() === "none") return "";

    const flags = [];
    const push = (kind, title) => {
      if (!flags.some((f) => f.kind === kind)) flags.push({ kind, title });
    };

    if (/🪪|💰|💳|✉️|📞|👤/.test(s)) {
      if (/🟢🪪/.test(s)) push("id", "Identity verified");
      if (/🟢💰/.test(s)) push("payment", "Payment verified");
      if (/🟢💳/.test(s)) push("deposit", "Deposit made");
      if (/🟢✉️/.test(s)) push("mail", "Email verified");
      if (/🟢📞/.test(s)) push("phone", "Phone verified");
      if (/🟢👤/.test(s)) push("profile", "Profile complete");
    } else {
      for (const part of s.split(/,\s*/)) {
        const p = part.trim().toLowerCase();
        if (p === "payment") push("payment", "Payment verified");
        else if (p === "mail" || p === "email") push("mail", "Email verified");
        else if (p === "id") push("id", "Identity verified");
        else if (p === "phone") push("phone", "Phone verified");
        else if (p === "deposit") push("deposit", "Deposit made");
        else if (p === "fb") push("profile", "Facebook connected");
        else if (p === "profile") push("profile", "Profile complete");
      }
      if (!flags.length) {
        if (/payment/i.test(s)) push("payment", "Payment verified");
        if (/mail|email/i.test(s)) push("mail", "Email verified");
        if (/\bid\b/i.test(s)) push("id", "Identity verified");
        if (/phone/i.test(s)) push("phone", "Phone verified");
        if (/deposit/i.test(s)) push("deposit", "Deposit made");
      }
    }

    if (!flags.length) return "";
    return flags
      .map(
        (f) =>
          `<span class="verifBadge" title="${esc(f.title)}">${verifIcoSvg(f.kind === "profile" ? "check" : f.kind)}</span>`,
      )
      .join("");
  }

  function renderProgBar(label, data) {
    const fillClass = label === "Cool" ? "progFill progFillCool" : "progFill progFillRate";
    return `
      <div class="rowProg">
        <div class="rowProgHead"><span>${esc(label)}</span><span class="muted">${esc(data.label)}</span></div>
        <div class="progTrack"><div class="${fillClass}" style="width:${data.pct}%"></div></div>
      </div>
    `;
  }

  function renderListRow(item, isSelected) {
    const p = item.project || {};
    const title = esc(p.title || "(no title)");
    const budget = getBudgetDisplay(p);
    const desc = p.description ? String(p.description) : "";
    const snippet = desc ? esc(desc.slice(0, 220)) + (desc.length > 220 ? "… " : "") : "";
    const skills = Array.isArray(p.skills) ? p.skills.slice(0, 8) : [];
    const cool = parseCoolBar(p.scoreText);
    const rate = parseRateBar(p.completionRateText);
    const verifHtml = renderVerifIcons(p.clientVerificationText);
    const isNewHighlight = newProjectHighlights.has(item.id);
    return `
      <div class="listRow ${isSelected ? "listRowActive" : ""}" data-id="${esc(item.id)}" role="button" tabindex="0">
        <div class="listRowTop">
          <div class="listRowMain">
            <button type="button" class="listRowTitleLink" data-action="copy-url" data-id="${esc(item.id)}" title="Click to copy URL">${title}</button>
            <div class="listRowMeta">
              <span class="listRowBudget">${budget.amount}</span>
              ${budget.code ? `<span class="listRowCurrency">${budget.code}</span>` : ""}
              <span class="listRowMetaSep">·</span>
              ${renderCountryDisplay(p.clientCountry)}
            </div>
            ${snippet ? `<div class="listRowSnippet" data-action="copy-details" data-id="${esc(item.id)}" title="Click to copy details">${snippet}<span class="listRowMore">more</span></div>` : ""}
            ${skills.length ? `<div class="listRowSkills">${skills.map((s) => `<span>${esc(s)}</span>`).join('<span class="skillsDot">·</span>')}</div>` : ""}
            ${renderClientReview(p)}
          </div>
          <div class="listRowActions">
            <button class="btnPrimary${isNewHighlight ? " writeBidHighlight" : ""}" type="button" data-action="write-bid" data-id="${esc(item.id)}">Write bid</button>
            <div class="listRowStats">
              ${renderProgBar("Cool", cool)}
              ${renderProgBar("Rate", rate)}
              ${verifHtml ? `<div class="verifRow">${verifHtml}</div>` : ""}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderApp() {
    updateHeaderSession();
    const styles = settings?.styles || [];
    render(`
      <div class="layout">
        <div class="pane">
          <div class="listHeader">
            <h2>Projects</h2>
            <div class="sub">Freelancer-style list with actions.</div>
          </div>
          <div class="listFeed">
            <div id="list" class="list"></div>
          </div>
        </div>
        <aside class="panel panelScroll pane">
          <h2>Main</h2>
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
            <div class="bidLabelRow">
              <div class="label">Generated bid</div>
              <button id="copyBid" class="iconBtn" type="button" disabled title="Copy bid" aria-label="Copy bid">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/>
                  <path d="M6 15H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v1" stroke="currentColor" stroke-width="1.8"/>
                </svg>
              </button>
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
      const actionEl = e.target.closest && e.target.closest("[data-action][data-id]");
      if (actionEl) {
        const action = actionEl.getAttribute("data-action");
        const id = actionEl.getAttribute("data-id") || "";
        const item = state.get(id);
        if (!item) return;
        if (action === "copy-url") {
          e.preventDefault();
          e.stopPropagation();
          void copyText(item.project?.url || "");
          return;
        }
        if (action === "copy-details") {
          e.stopPropagation();
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

    rerenderList();

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
    if (!eventSource) await bootstrapFeed();
    if (r === "/admin") return renderAdmin();
    if (r === "/profile") return renderProfile();
    return renderApp();
  }

  window.addEventListener("hashchange", () => void router());
  void router();
})();

