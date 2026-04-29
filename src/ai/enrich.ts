import OpenAI from "openai";
import type { Project } from "../types.js";

export type Enrichment = {
  summary: string;
  matchScore: number; // 0-100
  scamRisk: "Low" | "Medium" | "High";
  bidAngle: string;
  suggestedPrice: string;
};

export async function enrichProject(opts: {
  apiKey: string;
  model: string;
  requiredSkills: string[];
  project: Project;
}): Promise<Enrichment> {
  const client = new OpenAI({ apiKey: opts.apiKey });
  const p = opts.project;

  const prompt = [
    "You are helping a freelancer respond quickly to a new job post.",
    "Return STRICT JSON only with keys: summary, matchScore, scamRisk, bidAngle, suggestedPrice.",
    "matchScore is 0-100 integer. scamRisk is one of Low/Medium/High.",
    "",
    `Required skills: ${opts.requiredSkills.join(", ") || "(none)"}`,
    `Title: ${p.title}`,
    `Skills: ${p.skills.join(", ") || "(unknown)"}`,
    `Budget: ${p.budgetText ?? "(unknown)"}`,
    `Client: ${p.clientName ?? "(unknown)"}`,
    `Verification: ${p.clientVerificationText ?? "(unknown)"}`,
    `Description: ${p.description ?? "(none)"}`,
  ].join("\n");

  const resp = await client.chat.completions.create({
    model: opts.model,
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  });

  const text = resp.choices[0]?.message?.content ?? "";
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error("AI enrichment did not return JSON");
  }
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Enrichment;
  return parsed;
}

