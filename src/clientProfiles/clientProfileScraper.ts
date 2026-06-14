import { FL_BASE_URL } from "../collect/flSession.js";
import { sharedBrowser } from "../collect/sharedBrowser.js";

export type ScrapedClientProfile = {
  username: string;
  name: string | null;
  avatar: string | null;
  profileTitle: string | null;
  reviewCount: number | null;
  reviewRate: number | null;
  earning: string | null;
  lastReviewDate: string | null;
  openProjects: number | null;
  activeProjects: number | null;
  pastProjects: number | null;
  totalProjects: number | null;
};

const SCRAPE_PROFILE_FN = `
(async function scrapeClientProfile() {
  function parseStat(text, label) {
    var inline = new RegExp(label.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&") + "\\\\s*(\\\\d+)", "i");
    var m = text.match(inline);
    if (m) return parseInt(m[1], 10);
    var lines = text.split("\\n");
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim().toLowerCase() === label.toLowerCase()) {
        for (var j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          var n = lines[j].trim().match(/^(\\d+)$/);
          if (n) return parseInt(n[1], 10);
        }
      }
    }
    return null;
  }

  function scrapeProjectStats() {
    var idx = document.body.innerText.indexOf("Open projects");
    var area = idx >= 0
      ? document.body.innerText.slice(idx, idx + 400)
      : document.body.innerText;
    return {
      openProjects: parseStat(area, "Open projects"),
      activeProjects: parseStat(area, "Active projects"),
      pastProjects: parseStat(area, "Past projects"),
      totalProjects: parseStat(area, "Total projects"),
    };
  }

  function isFreelancerAvatarUrl(url) {
    return new RegExp("profile[_-]logo|/ppic/|f-cdn\\\\.com/img/|freelancer\\\\.com/img/", "i").test(url);
  }

  function normalizeAvatarUrl(raw) {
    if (!raw) return null;
    var url = String(raw).replace(/&amp;/g, "&").trim();
    if (!url || /unknown\\.png/i.test(url)) return null;
    if (!isFreelancerAvatarUrl(url)) return null;
    if (url.indexOf("//") === 0) url = "https:" + url;
    else if (url.charAt(0) === "/") url = location.origin + url;
    return url;
  }

  function isInsideReviewSection(el) {
    if (!el) return false;
    var node = el;
    while (node && node !== document.body) {
      var name = String(node.localName || node.tagName || "").toLowerCase();
      var cls = String(node.className || "");
      if (name.indexOf("review") >= 0) return true;
      if (new RegExp("review", "i").test(cls)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function avatarMatchesUser(url, userId) {
    if (!url || !userId) return false;
    var id = String(userId);
    return url.indexOf("/ppic/" + id + "/") >= 0 || url.indexOf("/logo/" + id + "/") >= 0;
  }

  function imgAvatarUrl(el) {
    if (!el) return null;
    return normalizeAvatarUrl(
      el.getAttribute("src") || el.getAttribute("data-src") || el.currentSrc || el.src
    );
  }

  function scrapeAvatarFromDom(userId) {
    var scopes = [
      "app-user-profile-summary-redesign",
      "app-user-profile-header-redesign",
      "app-user-profile-avatar",
      "app-employer-profile-header",
      '[class*="ProfileSummary"]',
      '[class*="profile-summary"]',
      '[class*="EmployerProfile"]',
      '[class*="ClientProfileHeader"]'
    ];
    for (var si = 0; si < scopes.length; si++) {
      var root = document.querySelector(scopes[si]);
      if (!root || isInsideReviewSection(root)) continue;
      var imgs = root.querySelectorAll("img");
      for (var ii = 0; ii < imgs.length; ii++) {
        if (isInsideReviewSection(imgs[ii])) continue;
        var url = imgAvatarUrl(imgs[ii]);
        if (url) return url;
      }
    }

    if (userId) {
      var id = String(userId);
      var avatarImgs = document.querySelectorAll(
        'img[src*="/ppic/' + id + '/"], img[data-src*="/ppic/' + id + '/"],'
        + 'img[src*="/logo/' + id + '/"], img[data-src*="/logo/' + id + '/"]'
      );
      for (var ai = 0; ai < avatarImgs.length; ai++) {
        if (isInsideReviewSection(avatarImgs[ai])) continue;
        var candidate = imgAvatarUrl(avatarImgs[ai]);
        if (candidate) return candidate;
      }
    }

    return null;
  }

  async function fetchUserProfile(slug) {
    try {
      var res = await fetch(
        "/api/users/0.1/users/?usernames[]=" + encodeURIComponent(slug)
        + "&avatar=true&avatar_large=true&user_details=true&compact=true"
      );
      var json = await res.json();
      if (json.status !== "success") return null;
      return Object.values(json.result && json.result.users ? json.result.users : {})[0] || null;
    } catch (e) {
      return null;
    }
  }

  function avatarFromUser(user) {
    if (!user) return null;
    var picks = [
      user.avatar_large_cdn,
      user.avatar_cdn,
      user.avatar_large,
      user.avatar,
      user.logoUrl,
      user.profileLogoUrl,
      user.logo_url,
      user.profile_logo_url
    ];
    if (user.profileDetails) {
      picks.push(
        user.profileDetails.logo_url,
        user.profileDetails.profile_logo_url,
        user.profileDetails.logoUrl,
        user.profileDetails.profileLogoUrl
      );
    }
    for (var i = 0; i < picks.length; i++) {
      var url = normalizeAvatarUrl(picks[i]);
      if (url) return url;
    }
    return null;
  }

  var username = null;
  var pathMatch = location.pathname.match(/\\/u\\/([^/?#]+)/);
  if (pathMatch) username = pathMatch[1];

  var userProfile = username ? await fetchUserProfile(username) : null;

  var nameEl = document.querySelector(".Username-displayName")
    || document.querySelector("h1.UserDetail-name")
    || document.querySelector("h3")
    || document.querySelector('[class*="displayName"]');
  var name = (userProfile && (userProfile.display_name || userProfile.public_name))
    || (nameEl ? nameEl.textContent.trim() : null);

  var avatar = avatarFromUser(userProfile) || scrapeAvatarFromDom(userProfile && userProfile.id);

  var taglineEl = document.querySelector("h2.Tagline");
  var profileTitle = taglineEl ? taglineEl.textContent.trim() : null;

  var reviewCount = null;
  var rcEl = document.querySelector(".ReviewCount");
  if (rcEl) {
    var rcMatch = rcEl.textContent.match(/(\\d+)/);
    if (rcMatch) reviewCount = parseInt(rcMatch[1], 10);
  }
  if (reviewCount == null) {
    var bodyMatch = document.body.innerText.match(/\\((\\d+)\\s+reviews?\\)/i);
    if (bodyMatch) reviewCount = parseInt(bodyMatch[1], 10);
  }

  var reviewRate = null;
  var ratingEl = document.querySelector('[aria-label*="out of 5"]');
  if (ratingEl) {
    var label = ratingEl.getAttribute("aria-label") || "";
    var rateMatch = label.match(/([\\d.]+)\\s+out of 5/i);
    if (rateMatch) reviewRate = parseFloat(rateMatch[1]);
  }
  if (reviewRate == null) {
    var floatMatch = document.body.innerText.match(/\\b([0-5]\\.\\d)\\b/);
    if (floatMatch) reviewRate = parseFloat(floatMatch[1]);
  }

  var earningEl = document.querySelector(".EarningsText");
  var earning = earningEl ? earningEl.textContent.trim() : null;

  var lastReviewDate = null;
  var timeEls = document.querySelectorAll('time[datetime], fl-review time, [class*="Review"] time');
  for (var i = 0; i < timeEls.length; i++) {
    var dt = timeEls[i].getAttribute("datetime");
    if (dt) { lastReviewDate = dt; break; }
  }
  if (!lastReviewDate) {
    var agoMatch = document.body.innerText.match(
      /(\\d+\\s+(?:second|minute|hour|day|week|month|year)s?\\s+ago)/i
    );
    if (agoMatch) lastReviewDate = agoMatch[1];
  }

  var projectStats = scrapeProjectStats();

  return {
    username: username,
    name: name,
    avatar: avatar,
    profileTitle: profileTitle,
    reviewCount: reviewCount,
    reviewRate: reviewRate,
    earning: earning,
    lastReviewDate: lastReviewDate,
    openProjects: projectStats.openProjects,
    activeProjects: projectStats.activeProjects,
    pastProjects: projectStats.pastProjects,
    totalProjects: projectStats.totalProjects,
  };
})()
`;

function normalizeAvatarUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url = raw.trim().replace(/&amp;/g, "&");
  if (!url || /unknown\.png/i.test(url)) return null;
  if (!/profile[_-]logo|\/ppic\/|f-cdn\.com\/img\/|freelancer\.com\/img\//i.test(url)) return null;
  if (url.startsWith("//")) url = `https:${url}`;
  else if (url.startsWith("/")) url = `${FL_BASE_URL}${url}`;
  return url;
}

export function parseRelativeReviewDate(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed;

  const m = trimmed.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return trimmed;

  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const d = new Date();
  switch (unit) {
    case "second": d.setSeconds(d.getSeconds() - n); break;
    case "minute": d.setMinutes(d.getMinutes() - n); break;
    case "hour": d.setHours(d.getHours() - n); break;
    case "day": d.setDate(d.getDate() - n); break;
    case "week": d.setDate(d.getDate() - n * 7); break;
    case "month": d.setMonth(d.getMonth() - n); break;
    case "year": d.setFullYear(d.getFullYear() - n); break;
  }
  return d.toISOString();
}

export class ClientProfileScraper {
  private ready = false;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly opts: {
      email: string;
      password: string;
    },
  ) {}

  async init(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    console.log("[client-profile] Waiting for shared Chrome session...");
    await sharedBrowser.ensureSession(this.opts.email, this.opts.password, "client-profile");
    this.ready = true;
    console.log("[client-profile] Ready — will open a new tab per profile scrape.");
  }

  async scrape(username: string): Promise<ScrapedClientProfile> {
    await this.init();
    const slug = username.trim();
    const url = `${FL_BASE_URL}/u/${encodeURIComponent(slug)}?client-profile=true`;

    const page = await sharedBrowser.newTab();
    try {
      console.log(`[client-profile] New tab → @${slug}`);
      await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
      await page.waitForSelector("body", { timeout: 10000 }).catch(() => {});
      await page.waitForSelector(
        'app-user-profile-summary-redesign img, app-user-profile-header-redesign img, img[src*="/ppic/"]',
        { timeout: 8000 },
      ).catch(() => {});

      const data = await page.evaluate(SCRAPE_PROFILE_FN) as {
        name: string | null;
        avatar: string | null;
        profileTitle: string | null;
        reviewCount: number | null;
        reviewRate: number | null;
        earning: string | null;
        lastReviewDate: string | null;
        openProjects: number | null;
        activeProjects: number | null;
        pastProjects: number | null;
        totalProjects: number | null;
      };

      return {
        username: slug.toLowerCase(),
        name: data.name,
        avatar: normalizeAvatarUrl(data.avatar),
        profileTitle: data.profileTitle,
        reviewCount: data.reviewCount,
        reviewRate: data.reviewRate,
        earning: data.earning,
        lastReviewDate: parseRelativeReviewDate(data.lastReviewDate),
        openProjects: data.openProjects,
        activeProjects: data.activeProjects,
        pastProjects: data.pastProjects,
        totalProjects: data.totalProjects,
      };
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    this.ready = false;
    this.initPromise = null;
  }
}
