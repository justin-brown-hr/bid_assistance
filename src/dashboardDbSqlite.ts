import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

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
    `);
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

  getUserSettings(usernameRaw: string): {
    username: string;
    hasOpenaiKey: boolean;
    styles: Array<{ styleId: string; name: string; updatedAt: number }>;
  } {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);

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

  upsertStyle(usernameRaw: string, style: { styleId?: string; name: string; text: string }): { styleId: string } {
    if (!this.db) throw new Error("DB not connected");
    const username = this.normUsername(usernameRaw);
    const name = style.name.trim();
    const text = style.text ?? "";
    if (!name) throw new Error("Style name required");
    if (!text.trim()) throw new Error("Style text required");
    const styleId = (style.styleId?.trim() || crypto.randomBytes(6).toString("hex"));
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
}

