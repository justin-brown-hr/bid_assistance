import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import type { ClientProfile, ClientProfileFilters } from "./types.js";

export type UserRow = {
  username: string; // lowercased
  pass_hash: string;
  created_at: number;
};

export type StyleRow = {
  username: string;
  style_id: string;
  name: string;
  text: string;
  created_at: number;
  updated_at: number;
};

export type SecretRow = {
  username: string;
  openai_key_enc: string;
  updated_at: number;
};

function b64u(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64u(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export class DashboardDbSqlite {
  private db: Database.Database | null = null;

  constructor(
    private readonly opts: {
      sqlitePath: string;
      authSecret: string;
    },
  ) {}

  connect(): void {
    if (this.db) return;
    const dbPath = this.opts.sqlitePath;
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        pass_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS secrets (
        username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
        openai_key_enc TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS styles (
        username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        style_id TEXT NOT NULL,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (username, style_id)
      );

      CREATE INDEX IF NOT EXISTS idx_styles_user_updated ON styles(username, updated_at DESC);

      CREATE TABLE IF NOT EXISTS client_profiles (
        username TEXT PRIMARY KEY,
        name TEXT,
        avatar TEXT,
        profile_title TEXT,
        review_count INTEGER,
        review_rate REAL,
        earning TEXT,
        last_review_date TEXT,
        country TEXT,
        last_posted_project TEXT,
        last_posted_time INTEGER NOT NULL,
        scraped_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_client_profiles_last_posted
        ON client_profiles(last_posted_time DESC);
    `);

    try {
      this.db.exec(`ALTER TABLE client_profiles ADD COLUMN verification_text TEXT`);
    } catch {
      // column already exists
    }
    for (const col of [
      "open_projects INTEGER",
      "active_projects INTEGER",
      "past_projects INTEGER",
      "total_projects INTEGER",
      "join_date TEXT",
    ]) {
      try {
        this.db.exec(`ALTER TABLE client_profiles ADD COLUMN ${col}`);
      } catch {
        // column already exists
      }
    }
    try {
      this.db.exec(`ALTER TABLE users ADD COLUMN slack_username TEXT`);
    } catch {
      // column already exists
    }
    try {
      this.db.exec(`ALTER TABLE users ADD COLUMN slack_user_id TEXT`);
    } catch {
      // column already exists
    }
    try {
      this.db.exec(`ALTER TABLE users ADD COLUMN slack_user_token_enc TEXT`);
    } catch {
      // column already exists
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private normUsername(u: string): string {
    return u.trim().toLowerCase();
  }

  private pbkdf2(pass: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(pass, salt, 180_000, 32, "sha256");
  }

  private hashPassword(pass: string): string {
    const salt = crypto.randomBytes(16);
    const key = this.pbkdf2(pass, salt);
    return `pbkdf2$sha256$180000$${b64u(salt)}$${b64u(key)}`;
  }

  private verifyPassword(pass: string, stored: string): boolean {
    try {
      const parts = stored.split("$");
      // Current format produced by hashPassword():
      // pbkdf2$sha256$180000$<salt_b64u>$<key_b64u>
      // Older/buggy formats may include extra "$" segments; support both.
      let saltB64u = parts[3];
      let keyB64u = parts[4];
      if ((!saltB64u || !keyB64u) && parts.length >= 8) {
        saltB64u = parts[5];
        keyB64u = parts[7];
      }
      const salt = fromB64u(saltB64u ?? "");
      const key = fromB64u(keyB64u ?? "");
      const actual = this.pbkdf2(pass, salt);
      return crypto.timingSafeEqual(key, actual);
    } catch {
      return false;
    }
  }

  private deriveEncKey(username: string): Buffer {
    return crypto
      .createHmac("sha256", this.opts.authSecret)
      .update(`enc:${username}`)
      .digest();
  }

  private encrypt(username: string, plaintext: string): string {
    const key = this.deriveEncKey(username);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${b64u(iv)}.${b64u(tag)}.${b64u(ct)}`;
  }

  private decrypt(username: string, blob: string): string {
    const [v, ivB, tagB, ctB] = blob.split(".");
    if (v !== "v1") throw new Error("Unsupported secret version");
    const key = this.deriveEncKey(username);
    const iv = fromB64u(ivB);
    const tag = fromB64u(tagB);
    const ct = fromB64u(ctB);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  }

  ensureUser(usernameRaw: string, passcode: string): { username: string; created: boolean } {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    if (!username) throw new Error("Username required");
    if (!passcode || passcode.trim().length < 4) throw new Error("Passcode must be at least 4 chars");

    const row = this.db.prepare("SELECT username, pass_hash FROM users WHERE username = ?").get(username) as
      | { username: string; pass_hash: string }
      | undefined;

    if (row) {
      if (!this.verifyPassword(passcode, row.pass_hash)) throw new Error("Invalid passcode");
      return { username, created: false };
    }

    const now = Date.now();
    this.db.prepare("INSERT INTO users(username, pass_hash, created_at) VALUES(?,?,?)")
      .run(username, this.hashPassword(passcode), now);
    return { username, created: true };
  }

  createUser(usernameRaw: string, passcode: string): { username: string } {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    if (!username) throw new Error("Username required");
    if (!passcode || passcode.trim().length < 4) throw new Error("Passcode must be at least 4 chars");

    const exists = this.db.prepare("SELECT 1 FROM users WHERE username = ?").get(username) as
      | { 1: number }
      | undefined;
    if (exists) throw new Error("User already exists");

    const now = Date.now();
    this.db.prepare("INSERT INTO users(username, pass_hash, created_at) VALUES(?,?,?)")
      .run(username, this.hashPassword(passcode), now);
    return { username };
  }

  verifyUser(usernameRaw: string, passcode: string): { username: string } {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    if (!username) throw new Error("Username required");
    if (!passcode || passcode.trim().length < 4) throw new Error("Passcode must be at least 4 chars");

    const row = this.db.prepare("SELECT pass_hash FROM users WHERE username = ?").get(username) as
      | { pass_hash: string }
      | undefined;
    if (!row) throw new Error("User not found");
    if (!this.verifyPassword(passcode, row.pass_hash)) throw new Error("Invalid passcode");
    return { username };
  }

  hasUser(usernameRaw: string): boolean {
    if (!this.db) return false;
    const username = this.normUsername(usernameRaw);
    const row = this.db.prepare("SELECT 1 FROM users WHERE username = ?").get(username) as
      | { 1: number }
      | undefined;
    return Boolean(row);
  }

  resetPassword(usernameRaw: string, newPasscode: string): void {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    if (!username) throw new Error("Username required");
    if (!newPasscode || newPasscode.trim().length < 4) throw new Error("Passcode must be at least 4 chars");

    const exists = this.db.prepare("SELECT 1 FROM users WHERE username = ?").get(username) as
      | { 1: number }
      | undefined;
    if (!exists) throw new Error("User not found");

    this.db.prepare("UPDATE users SET pass_hash = ? WHERE username = ?").run(this.hashPassword(newPasscode), username);
  }

  changePassword(usernameRaw: string, currentPasscode: string, newPasscode: string): void {
    this.verifyUser(usernameRaw, currentPasscode);
    if (currentPasscode === newPasscode) throw new Error("New passcode must differ from current passcode");
    this.resetPassword(usernameRaw, newPasscode);
  }

  getUserSettings(usernameRaw: string): {
    username: string;
    hasOpenaiKey: boolean;
    hasSlackConnected: boolean;
    slackUsername: string;
    slackUserId: string;
    styles: Array<{ styleId: string; name: string; updatedAt: number }>;
  } {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);

    const userRow = this.db
      .prepare("SELECT slack_username, slack_user_id, slack_user_token_enc FROM users WHERE username = ?")
      .get(username) as
      | { slack_username: string | null; slack_user_id: string | null; slack_user_token_enc: string | null }
      | undefined;

    const secret = this.db.prepare("SELECT 1 FROM secrets WHERE username = ?").get(username) as
      | { 1: number }
      | undefined;
    const hasOpenaiKey = Boolean(secret);

    const styles = this.db.prepare(
      "SELECT style_id, name, updated_at FROM styles WHERE username = ? ORDER BY updated_at DESC LIMIT 50",
    ).all(username) as Array<{ style_id: string; name: string; updated_at: number }>;

    return {
      username,
      hasOpenaiKey,
      hasSlackConnected: Boolean(userRow?.slack_user_token_enc),
      slackUsername: userRow?.slack_username?.trim() ?? "",
      slackUserId: userRow?.slack_user_id?.trim() ?? "",
      styles: styles.map((s) => ({ styleId: s.style_id, name: s.name, updatedAt: s.updated_at })),
    };
  }

  getOpenAiKey(usernameRaw: string): string | undefined {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    const secret = this.db.prepare("SELECT openai_key_enc FROM secrets WHERE username = ?").get(username) as
      | { openai_key_enc: string }
      | undefined;
    return secret?.openai_key_enc ? this.decrypt(username, secret.openai_key_enc) : undefined;
  }

  getStyle(usernameRaw: string, styleIdRaw: string): { styleId: string; name: string; text: string } | undefined {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    const styleId = styleIdRaw.trim();
    const row = this.db.prepare(
      "SELECT style_id, name, text FROM styles WHERE username = ? AND style_id = ?",
    ).get(username, styleId) as { style_id: string; name: string; text: string } | undefined;
    if (!row) return undefined;
    return { styleId: row.style_id, name: row.name, text: row.text };
  }

  upsertOpenAiKey(usernameRaw: string, openaiKey: string): void {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    const enc = this.encrypt(username, openaiKey.trim());
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO secrets(username, openai_key_enc, updated_at)
      VALUES(?,?,?)
      ON CONFLICT(username) DO UPDATE SET openai_key_enc=excluded.openai_key_enc, updated_at=excluded.updated_at
    `).run(username, enc, now);
  }

  upsertSlackConnection(
    usernameRaw: string,
    connection: { userToken: string; userId: string; displayName: string },
  ): void {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    const userId = connection.userId.trim().toUpperCase();
    const displayName = connection.displayName.trim().replace(/^@+/, "");
    if (!userId || !/^U[A-Z0-9]+$/.test(userId)) {
      throw new Error("Invalid Slack user id from OAuth");
    }
    const enc = this.encrypt(username, connection.userToken.trim());
    const r = this.db
      .prepare(
        "UPDATE users SET slack_user_token_enc = ?, slack_user_id = ?, slack_username = ? WHERE username = ?",
      )
      .run(enc, userId, displayName || null, username);
    if (r.changes === 0) {
      throw new Error("User account not found — sign out, sign in again, then connect Slack");
    }
  }

  clearSlackConnection(usernameRaw: string): void {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    this.db
      .prepare(
        "UPDATE users SET slack_user_token_enc = NULL, slack_user_id = NULL, slack_username = NULL WHERE username = ?",
      )
      .run(username);
  }

  getSlackUserToken(usernameRaw: string): string | undefined {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    const row = this.db.prepare("SELECT slack_user_token_enc FROM users WHERE username = ?").get(username) as
      | { slack_user_token_enc: string | null }
      | undefined;
    if (!row?.slack_user_token_enc) return undefined;
    return this.decrypt(username, row.slack_user_token_enc);
  }

  getSlackProfile(usernameRaw: string): {
    slackUsername: string;
    slackUserId: string;
    hasSlackConnected: boolean;
  } {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    const row = this.db
      .prepare("SELECT slack_username, slack_user_id, slack_user_token_enc FROM users WHERE username = ?")
      .get(username) as
      | { slack_username: string | null; slack_user_id: string | null; slack_user_token_enc: string | null }
      | undefined;
    return {
      slackUsername: row?.slack_username?.trim() ?? "",
      slackUserId: row?.slack_user_id?.trim() ?? "",
      hasSlackConnected: Boolean(row?.slack_user_token_enc),
    };
  }

  getSlackUsername(usernameRaw: string): string {
    return this.getSlackProfile(usernameRaw).slackUsername;
  }

  upsertStyle(usernameRaw: string, style: { styleId?: string; name: string; text: string }): { styleId: string } {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    const name = style.name.trim();
    const text = style.text ?? "";
    if (!name) throw new Error("Style name required");
    if (!text.trim()) throw new Error("Style text required");
    const styleId = (style.styleId?.trim() || crypto.randomBytes(6).toString("hex"));

    const dup = this.db.prepare(
      "SELECT 1 FROM styles WHERE username = ? AND lower(trim(name)) = lower(trim(?)) AND style_id != ?",
    ).get(username, name, styleId) as { 1: number } | undefined;
    if (dup) throw new Error("A bid style with this name already exists");

    const now = Date.now();

    this.db.prepare(`
      INSERT INTO styles(username, style_id, name, text, created_at, updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(username, style_id) DO UPDATE SET name=excluded.name, text=excluded.text, updated_at=excluded.updated_at
    `).run(username, styleId, name, text, now, now);

    return { styleId };
  }

  deleteStyle(usernameRaw: string, styleIdRaw: string): void {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    const styleId = styleIdRaw.trim();
    this.db.prepare("DELETE FROM styles WHERE username = ? AND style_id = ?").run(username, styleId);
  }

  listUsers(): Array<{
    username: string;
    createdAt: number;
    hasOpenaiKey: boolean;
    styleCount: number;
  }> {
    if (!this.db) throw new Error("DB not connected");
    const rows = this.db.prepare(`
      SELECT
        u.username,
        u.created_at AS created_at,
        EXISTS(SELECT 1 FROM secrets s WHERE s.username = u.username) AS has_openai_key,
        (SELECT COUNT(*) FROM styles st WHERE st.username = u.username) AS style_count
      FROM users u
      ORDER BY u.created_at ASC
    `).all() as Array<{
      username: string;
      created_at: number;
      has_openai_key: number;
      style_count: number;
    }>;

    return rows.map((r) => ({
      username: r.username,
      createdAt: r.created_at,
      hasOpenaiKey: Boolean(r.has_openai_key),
      styleCount: Number(r.style_count) || 0,
    }));
  }

  deleteUser(usernameRaw: string): void {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    if (!username) throw new Error("Username required");
    if (username === "riora") throw new Error("Cannot delete admin account");

    const r = this.db.prepare("DELETE FROM users WHERE username = ?").run(username);
    if (r.changes === 0) throw new Error("User not found");
  }

  private normClientUsername(u: string): string {
    return u.trim().toLowerCase();
  }

  upsertClientProfile(data: {
    username: string;
    name?: string | null;
    avatar?: string | null;
    profileTitle?: string | null;
    reviewCount?: number | null;
    reviewRate?: number | null;
    earning?: string | null;
    lastReviewDate?: string | null;
    country?: string | null;
    joinDate?: string | null;
    verificationText?: string | null;
    openProjects?: number | null;
    activeProjects?: number | null;
    pastProjects?: number | null;
    totalProjects?: number | null;
    lastPostedProject: string;
    lastPostedTime: number;
    scrapedAt: number;
  }): void {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normClientUsername(data.username);
    if (!username) throw new Error("Client username required");

    const now = Date.now();
    const existing = this.db.prepare(
      "SELECT created_at FROM client_profiles WHERE username = ?",
    ).get(username) as { created_at: number } | undefined;

    this.db.prepare(`
      INSERT INTO client_profiles(
        username, name, avatar, profile_title, review_count, review_rate,
        earning, last_review_date, country, join_date, last_posted_project,
        last_posted_time, verification_text, open_projects, active_projects,
        past_projects, total_projects, scraped_at, created_at, updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(username) DO UPDATE SET
        name=excluded.name,
        avatar=excluded.avatar,
        profile_title=excluded.profile_title,
        review_count=excluded.review_count,
        review_rate=excluded.review_rate,
        earning=excluded.earning,
        last_review_date=excluded.last_review_date,
        country=excluded.country,
        join_date=COALESCE(excluded.join_date, client_profiles.join_date),
        last_posted_project=excluded.last_posted_project,
        last_posted_time=excluded.last_posted_time,
        verification_text=COALESCE(excluded.verification_text, client_profiles.verification_text),
        open_projects=excluded.open_projects,
        active_projects=excluded.active_projects,
        past_projects=excluded.past_projects,
        total_projects=excluded.total_projects,
        scraped_at=excluded.scraped_at,
        updated_at=excluded.updated_at
    `).run(
      username,
      data.name ?? null,
      data.avatar ?? null,
      data.profileTitle ?? null,
      data.reviewCount ?? null,
      data.reviewRate ?? null,
      data.earning ?? null,
      data.lastReviewDate ?? null,
      data.country ?? null,
      data.joinDate ?? null,
      data.lastPostedProject,
      data.lastPostedTime,
      data.verificationText ?? null,
      data.openProjects ?? null,
      data.activeProjects ?? null,
      data.pastProjects ?? null,
      data.totalProjects ?? null,
      data.scrapedAt,
      existing?.created_at ?? now,
      now,
    );
  }

  listClientProfiles(
    page: number,
    limit: number,
    filters: ClientProfileFilters = {},
  ): {
    profiles: ClientProfile[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } {
    if (!this.db) throw new Error("DB not connected");
    const safeLimit = Math.max(1, Math.min(50, limit));
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * safeLimit;

    const where: string[] = [];
    const params: unknown[] = [];

    const like = (col: string, val?: string) => {
      const v = val?.trim();
      if (!v) return;
      where.push(`${col} LIKE ? COLLATE NOCASE`);
      params.push(`%${v}%`);
    };

    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      where.push(`(
        username LIKE ? COLLATE NOCASE OR
        IFNULL(name, '') LIKE ? COLLATE NOCASE OR
        IFNULL(avatar, '') LIKE ? COLLATE NOCASE OR
        IFNULL(profile_title, '') LIKE ? COLLATE NOCASE OR
        IFNULL(earning, '') LIKE ? COLLATE NOCASE OR
        IFNULL(last_review_date, '') LIKE ? COLLATE NOCASE OR
        IFNULL(country, '') LIKE ? COLLATE NOCASE OR
        IFNULL(join_date, '') LIKE ? COLLATE NOCASE OR
        IFNULL(last_posted_project, '') LIKE ? COLLATE NOCASE OR
        CAST(IFNULL(review_count, '') AS TEXT) LIKE ? OR
        CAST(IFNULL(review_rate, '') AS TEXT) LIKE ?
      )`);
      params.push(q, q, q, q, q, q, q, q, q, q, q);
    }

    like("username", filters.username);
    like("name", filters.name);
    like("avatar", filters.avatar);
    like("profile_title", filters.profileTitle);
    like("earning", filters.earning);
    like("last_review_date", filters.lastReviewDate);
    like("country", filters.country);
    like("join_date", filters.joinDate);
    like("last_posted_project", filters.lastPostedProject);

    const numMin = (col: string, val?: number) => {
      if (val == null || !Number.isFinite(val)) return;
      where.push(`${col} >= ?`);
      params.push(val);
    };
    const numMax = (col: string, val?: number) => {
      if (val == null || !Number.isFinite(val)) return;
      where.push(`${col} <= ?`);
      params.push(val);
    };

    numMin("review_count", filters.reviewCountMin);
    numMax("review_count", filters.reviewCountMax);
    numMin("review_rate", filters.reviewRateMin);
    numMax("review_rate", filters.reviewRateMax);
    numMin("last_posted_time", filters.lastPostedFrom);
    numMax("last_posted_time", filters.lastPostedTo);
    numMin("scraped_at", filters.scrapedFrom);
    numMax("scraped_at", filters.scrapedTo);
    numMin("created_at", filters.createdFrom);
    numMax("created_at", filters.createdTo);
    numMin("updated_at", filters.updatedFrom);
    numMax("updated_at", filters.updatedTo);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRow = this.db.prepare(
      `SELECT COUNT(*) AS c FROM client_profiles ${whereSql}`,
    ).get(...params) as { c: number };
    const total = Number(totalRow.c) || 0;

    const rows = this.db.prepare(`
      SELECT * FROM client_profiles
      ${whereSql}
      ORDER BY last_posted_time DESC
      LIMIT ? OFFSET ?
    `).all(...params, safeLimit, offset) as Array<{
      username: string;
      name: string | null;
      avatar: string | null;
      profile_title: string | null;
      review_count: number | null;
      review_rate: number | null;
      earning: string | null;
      last_review_date: string | null;
      country: string | null;
      join_date: string | null;
      last_posted_project: string | null;
      last_posted_time: number;
      scraped_at: number;
      created_at: number;
      updated_at: number;
      verification_text: string | null;
      open_projects: number | null;
      active_projects: number | null;
      past_projects: number | null;
      total_projects: number | null;
    }>;

    return {
      profiles: rows.map((r) => ({
        username: r.username,
        name: r.name,
        avatar: r.avatar,
        profileTitle: r.profile_title,
        reviewCount: r.review_count,
        reviewRate: r.review_rate,
        earning: r.earning,
        lastReviewDate: r.last_review_date,
        country: r.country,
        joinDate: r.join_date,
        lastPostedProject: r.last_posted_project,
        lastPostedTime: r.last_posted_time,
        verificationText: r.verification_text,
        openProjects: r.open_projects,
        activeProjects: r.active_projects,
        pastProjects: r.past_projects,
        totalProjects: r.total_projects,
        scrapedAt: r.scraped_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  }

  getClientProfile(usernameRaw: string): ClientProfile | undefined {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normClientUsername(usernameRaw);
    const r = this.db.prepare(
      "SELECT * FROM client_profiles WHERE username = ?",
    ).get(username) as {
      username: string;
      name: string | null;
      avatar: string | null;
      profile_title: string | null;
      review_count: number | null;
      review_rate: number | null;
      earning: string | null;
      last_review_date: string | null;
      country: string | null;
      join_date: string | null;
      last_posted_project: string | null;
      last_posted_time: number;
      scraped_at: number;
      created_at: number;
      updated_at: number;
      verification_text: string | null;
      open_projects: number | null;
      active_projects: number | null;
      past_projects: number | null;
      total_projects: number | null;
    } | undefined;
    if (!r) return undefined;
    return {
      username: r.username,
      name: r.name,
      avatar: r.avatar,
      profileTitle: r.profile_title,
      reviewCount: r.review_count,
      reviewRate: r.review_rate,
      earning: r.earning,
      lastReviewDate: r.last_review_date,
      country: r.country,
      joinDate: r.join_date,
      lastPostedProject: r.last_posted_project,
      lastPostedTime: r.last_posted_time,
      verificationText: r.verification_text,
      openProjects: r.open_projects,
      activeProjects: r.active_projects,
      pastProjects: r.past_projects,
      totalProjects: r.total_projects,
      scrapedAt: r.scraped_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  deleteClientProfile(usernameRaw: string): void {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normClientUsername(usernameRaw);
    if (!username) throw new Error("Client username required");

    const r = this.db.prepare("DELETE FROM client_profiles WHERE username = ?").run(username);
    if (r.changes === 0) throw new Error("Client profile not found");
  }
}

