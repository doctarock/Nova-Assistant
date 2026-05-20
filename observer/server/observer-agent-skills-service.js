import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "..", "agent-skills");

export function createAgentSkillsService({ brainsConfig = {} } = {}) {
  let cache = null;

  async function loadSkills(force = false) {
    if (cache && !force) return cache;
    try {
      const files = (await readdir(SKILLS_DIR)).filter((f) => f.endsWith(".json"));
      const loaded = await Promise.all(
        files.map(async (f) => {
          try {
            return JSON.parse(await readFile(join(SKILLS_DIR, f), "utf8"));
          } catch {
            return null;
          }
        })
      );
      cache = loaded.filter(Boolean).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    } catch {
      cache = [];
    }
    return cache;
  }

  async function listSkills() {
    return loadSkills();
  }

  async function searchSkills(query = "") {
    const skills = await loadSkills();
    const q = String(query).trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) => {
      const name = String(s.name || "").toLowerCase();
      const desc = String(s.description || "").toLowerCase();
      const tags = Array.isArray(s.tags) ? s.tags.map((t) => String(t).toLowerCase()) : [];
      return name.includes(q) || desc.includes(q) || tags.some((t) => t.includes(q));
    });
  }

  async function getSkill(id) {
    const skills = await loadSkills();
    return skills.find((s) => s.id === id) || null;
  }

  function resolveBrain(brainId) {
    const { builtIn = [], custom = [], endpoints = {}, assignments = {} } = brainsConfig;
    const allBrains = [...builtIn, ...custom];
    const brain = allBrains.find((b) => b.id === brainId);
    if (!brain) throw new Error(`Brain not found: ${brainId}`);
    const endpointId = assignments[brainId] || brain.endpointId;
    const endpoint = endpoints[endpointId];
    if (!endpoint?.baseUrl) throw new Error(`Endpoint not configured for brain: ${brainId}`);
    return { brain, endpoint };
  }

  async function runSkill(skillId, input, brainId) {
    const { createOpenAICompatibleProvider, Dogpile } = await import("@dogpile/sdk");

    const skill = await getSkill(skillId);
    if (!skill) throw new Error(`Agent skill not found: ${skillId}`);

    const targetBrainId = brainId || skill.preferredBrainId || "worker";
    const { brain, endpoint } = resolveBrain(targetBrainId);

    const base = createOpenAICompatibleProvider({
      id: `${targetBrainId}:${brain.model}`,
      model: brain.model,
      baseURL: `${endpoint.baseUrl}/v1`
    });

    const provider = skill.systemPrompt
      ? {
          id: base.id,
          async generate(request) {
            const msgs = Array.isArray(request.messages) ? request.messages : [];
            const hasSystem = msgs.some((m) => m.role === "system");
            return base.generate({
              ...request,
              messages: hasSystem
                ? msgs
                : [{ role: "system", content: skill.systemPrompt }, ...msgs]
            });
          }
        }
      : base;

    const result = await Dogpile.pile({
      intent: input,
      model: provider,
      protocol: "sequential"
    });

    return {
      skillId,
      skillName: skill.name,
      brainId: targetBrainId,
      brainModel: brain.model,
      output: result.text,
      usage: result.usage || null,
      costUsd: result.costUsd || 0
    };
  }

  async function buildAgentSkillsGuidanceNote() {
    const skills = await loadSkills();
    if (!skills.length) return "";
    const lines = ["Agent skills — call via run_agent_skill tool:"];
    for (const skill of skills) {
      lines.push(`- ${skill.id}: ${skill.description}`);
    }
    lines.push("Use search_agent_skills to find skills by keyword or tag.");
    return lines.join("\n");
  }

  return { listSkills, searchSkills, getSkill, runSkill, buildAgentSkillsGuidanceNote };
}
