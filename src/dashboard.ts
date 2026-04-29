import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Enrichment } from "./ai/enrich.js";
import type { Project } from "./types.js";

export type DashboardItem = {
  project: Project;
  notifiedAt: number;
  ai?: Enrichment;
};

export class DashboardStore {
  private readonly filePath: string;
  private items: DashboardItem[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  recordFast(project: Project) {
    this.items.unshift({ project, notifiedAt: Date.now() });
    this.items = this.items.slice(0, 200);
  }

  recordAI(projectId: string, ai: Enrichment) {
    const item = this.items.find((x) => x.project.id === projectId);
    if (item) item.ai = ai;
  }

  async flush() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify({ updatedAt: Date.now(), items: this.items }, null, 2),
      "utf8",
    );
  }
}

