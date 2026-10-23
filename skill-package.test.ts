import { test, expect } from "bun:test";
import { join, resolve, relative, dirname } from "node:path";

const root = import.meta.dir;
const skillRoot = join(root, ".rulesync/skills/deltadb");
test("deltadb skill has portable metadata, references and explicit operational boundaries", async () => {
  const text = await Bun.file(join(skillRoot, "SKILL.md")).text();
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text);
  expect(frontmatter).not.toBeNull();
  expect(frontmatter![1]).toContain("name: deltadb");
  expect(frontmatter![1]).toContain("description:");
  expect(text.split("\n").length).toBeLessThan(500);
  expect(text).not.toContain("/home/tom");
  for (const file of ["SKILL.md", "references/operations.md", "references/evidence-and-evals.md"]) {
    const path = join(skillRoot, file);
    const body = await Bun.file(path).text();
    for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split("#")[0];
      if (!target || /^https?:/.test(target)) continue;
      const absolute = resolve(dirname(path), target);
      expect(relative(skillRoot, absolute).startsWith("..")).toBe(false);
      expect(await Bun.file(absolute).exists()).toBe(true);
    }
  }
  for (const invariant of ["--database-dir", "--db", "producer.next_sequence", "not model prompts",
    "end-to-end", "init", "previews through Delta", "unverified", "recorded"]) {
    // Packaging guard only: this does not prove model adherence to the instructions.
    expect(text.toLowerCase()).toContain(invariant.toLowerCase());
  }
});

test("human guide is linked and generation is source-scoped, global, nondeleting and skill-only", async () => {
  const readme = await Bun.file(join(root, "README.md")).text();
  expect(readme).toContain("docs/outside-desktop.md");
  expect(await Bun.file(join(root, "docs/outside-desktop.md")).exists()).toBe(true);
  const config = JSON.parse(await Bun.file(join(root, "rulesync.jsonc")).text());
  expect(config.global).toBe(true);
  expect(config.delete).toBe(false);
  expect(config.targets).toEqual({ opencode: ["skills"], agentsskills: ["skills"] });
  expect(config.baseDirs).toEqual(["."]);
});
