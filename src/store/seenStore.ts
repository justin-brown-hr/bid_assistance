import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type SeenState = {
  // projectId -> timestamp ms
  seen: Record<string, number>;
};

const DEFAULT_STATE: SeenState = { seen: {} };

export class SeenStore {
  private readonly filePath: string;
  private state: SeenState = DEFAULT_STATE;
  private dirty = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as SeenState;
      if (parsed && typeof parsed === "object" && parsed.seen) {
        this.state = parsed;
        return;
      }
    } catch {
      // ignore; create fresh
    }
    this.state = { ...DEFAULT_STATE, seen: {} };
    await this.flush();
  }

  has(id: string): boolean {
    return Boolean(this.state.seen[id]);
  }

  isEmpty(): boolean {
    return Object.keys(this.state.seen).length === 0;
  }

  mark(id: string, now = Date.now()) {
    this.state.seen[id] = now;
    this.dirty = true;
  }

  pruneOlderThan(msAgo: number, now = Date.now()) {
    const cutoff = now - msAgo;
    for (const [id, ts] of Object.entries(this.state.seen)) {
      if (ts < cutoff) delete this.state.seen[id];
    }
    this.dirty = true;
  }

  async flush() {
    if (!this.dirty) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
    this.dirty = false;
  }
}

