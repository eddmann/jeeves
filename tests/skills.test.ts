import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadSkillsFromDirs, MAX_NAME_LENGTH } from "../src/skills/loader";
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

let tmpDir: string;

beforeEach(() => {
  tmpDir = createTempDir();
});

afterEach(() => {
  cleanupTempDir(tmpDir);
});

function writeSkill(baseDir: string, name: string, frontmatter: string, body = ""): void {
  const skillDir = join(baseDir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`);
}

describe("skill discovery", () => {
  test("loads valid skill from properly structured directory", () => {
    writeSkill(tmpDir, "deploy", 'name: deploy\ndescription: "Deploy the app"');

    const skills = loadSkillsFromDirs([tmpDir]);

    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe("deploy");
    expect(skills[0].description).toBe("Deploy the app");
  });

  test("returns empty list from empty directory", () => {
    const skills = loadSkillsFromDirs([tmpDir]);

    expect(skills).toEqual([]);
  });

  test("returns empty list from nonexistent directory", () => {
    const skills = loadSkillsFromDirs([join(tmpDir, "nope")]);

    expect(skills).toEqual([]);
  });

  test("discovers skills recursively in nested directories", () => {
    const nested = join(tmpDir, "category", "subcategory");
    writeSkill(nested, "deep-skill", 'name: deep-skill\ndescription: "Nested"');

    const skills = loadSkillsFromDirs([tmpDir]);

    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe("deep-skill");
  });

  test("workspace skills override bundled skills with the same name", () => {
    const bundledDir = join(tmpDir, "bundled");
    const workspaceDir = join(tmpDir, "workspace");
    writeSkill(bundledDir, "deploy", 'name: deploy\ndescription: "Bundled deploy"');
    writeSkill(workspaceDir, "deploy", 'name: deploy\ndescription: "Workspace deploy"');

    const skills = loadSkillsFromDirs([bundledDir, workspaceDir]);

    expect(skills.length).toBe(1);
    expect(skills[0].description).toBe("Workspace deploy");
  });
});

describe("skill validation", () => {
  test("rejects skill missing name field", () => {
    writeSkill(tmpDir, "no-name", 'description: "Has no name"');

    const skills = loadSkillsFromDirs([tmpDir]);

    expect(skills.length).toBe(0);
  });

  test("rejects skill missing description field", () => {
    writeSkill(tmpDir, "no-desc", "name: no-desc");

    const skills = loadSkillsFromDirs([tmpDir]);

    expect(skills.length).toBe(0);
  });

  test("rejects skill with invalid name characters", () => {
    writeSkill(tmpDir, "Bad_Name", 'name: Bad_Name\ndescription: "Invalid"');

    const skills = loadSkillsFromDirs([tmpDir]);

    expect(skills.length).toBe(0);
  });

  test("rejects skill name exceeding max length", () => {
    const longName = "a".repeat(MAX_NAME_LENGTH + 1);
    const skillDir = join(tmpDir, longName);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${longName}\ndescription: "Too long"\n---\n`,
    );

    const skills = loadSkillsFromDirs([tmpDir]);

    expect(skills.length).toBe(0);
  });

  test("rejects skill when name does not match parent directory", () => {
    writeSkill(tmpDir, "dir-name", 'name: different-name\ndescription: "Mismatch"');

    const skills = loadSkillsFromDirs([tmpDir]);

    expect(skills.length).toBe(0);
  });

  test("handles invalid YAML frontmatter gracefully", () => {
    const skillDir = join(tmpDir, "bad-yaml");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\n: : invalid: yaml: {{{\n---\n");

    const skills = loadSkillsFromDirs([tmpDir]);

    expect(skills.length).toBe(0);
  });

  test("handles missing frontmatter gracefully", () => {
    const skillDir = join(tmpDir, "no-frontmatter");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "Just plain text, no frontmatter\n");

    const skills = loadSkillsFromDirs([tmpDir]);

    expect(skills.length).toBe(0);
  });
});
