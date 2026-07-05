import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  analyzeProjectSetup,
  configFromSetup,
  createProjectRuntimePlan,
  projectRuntimeRoot
} from "./project-setup.js";

describe("project setup", () => {
  it("returns unsupported when Codex output does not match the setup contract", async () => {
    const setup = await analyzeProjectSetup("/tmp/project", {
      async runJson() {
        return { nope: true };
      }
    });

    expect(setup.canRun).toBe(false);
    expect(setup.reason).toContain("valid DriftRadar project setup");
  });

  it("rejects sensitive files before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await writeFile(join(projectRoot, ".env"), "SECRET=value\n", "utf8");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /sensitive file present/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not ignore sensitive files in build output folders", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, "dist"), { recursive: true });
      await writeFile(join(projectRoot, "dist", ".env"), "SECRET=value\n", "utf8");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /sensitive file present/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not ignore sensitive files in dependency folders", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, "node_modules", "package"), { recursive: true });
      await writeFile(
        join(projectRoot, "node_modules", "package", ".npmrc"),
        "_authToken=secret\n"
      );

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /credential-bearing package manager config/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("allows non-credential package manager config before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn().mockResolvedValue({
      canRun: true,
      reason: "Static UI",
      projectName: "Static UI",
      packageManager: "static",
      runtime: { type: "static-site", staticRoot: "." },
      installCommand: null,
      runCommand: null,
      baseUrl: "http://127.0.0.1:4555",
      routes: [{ id: "home", url: "/", label: "Home" }],
      tokenFiles: ["tokens.css"],
      sourceRoots: ["."],
      testCommands: [],
      notes: []
    });
    try {
      await writeFile(
        join(projectRoot, ".npmrc"),
        'package-lock=false\nPUPPETEER_DOWNLOAD_BASE_URL="https://example.test/chrome"\n',
        "utf8"
      );
      await writeFile(join(projectRoot, "tokens.css"), ":root { --color-primary: #000; }");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).resolves.toMatchObject({
        setup: { projectName: "Static UI" }
      });
      expect(runJson).toHaveBeenCalledOnce();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects registry-prefixed credentialed package manager config", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await writeFile(join(projectRoot, ".npmrc"), "//registry.npmjs.org/:_password=secret\n");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /credential-bearing package manager config/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects uppercase credentialed package manager config", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await writeFile(join(projectRoot, ".NPMRC"), "_authToken=secret\n");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /credential-bearing package manager config/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects credentialed URLs in package manager config", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await writeFile(
        join(projectRoot, ".npmrc"),
        "registry=https://user:pass@registry.example/\n"
      );

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /credential-bearing package manager config/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects credentialed package manager config through inside-project symlinks", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await writeFile(join(projectRoot, "npmrc-copy"), "_authToken=secret\n", "utf8");
      await symlink("npmrc-copy", join(projectRoot, ".npmrc"));

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /credential-bearing package manager config/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects package manager config symlinks outside the project before reading them", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "driftradar-outside-"));
    const runJson = vi.fn();
    try {
      const outsideConfig = join(outsideRoot, ".npmrc");
      await writeFile(outsideConfig, "package-lock=false\n", "utf8");
      await symlink(outsideConfig, join(projectRoot, ".npmrc"));

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /symlink points outside/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("allows benign dependency files whose names contain secret", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn().mockResolvedValue({
      canRun: true,
      reason: "Static UI",
      projectName: "Static UI",
      packageManager: "static",
      runtime: { type: "static-site", staticRoot: "." },
      installCommand: null,
      runCommand: null,
      baseUrl: "http://127.0.0.1:4555",
      routes: [{ id: "home", url: "/", label: "Home" }],
      tokenFiles: ["tokens.css"],
      sourceRoots: ["."],
      testCommands: [],
      notes: []
    });
    try {
      await mkdir(join(projectRoot, "node_modules", "prop-types", "lib"), { recursive: true });
      await writeFile(
        join(projectRoot, "node_modules", "prop-types", "lib", "ReactPropTypesSecret.js"),
        "export default 'SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED';\n",
        "utf8"
      );
      await writeFile(join(projectRoot, "tokens.css"), ":root { --color-primary: #000; }");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).resolves.toMatchObject({
        setup: { projectName: "Static UI" }
      });
      expect(runJson).toHaveBeenCalledOnce();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects secret data files before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await writeFile(join(projectRoot, "secrets.json"), "{}", "utf8");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /sensitive file present/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects secret directories before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, "secrets"), { recursive: true });
      await writeFile(join(projectRoot, "secrets", "prod.json"), "{}", "utf8");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /sensitive file present/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects extensionless credential files before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await writeFile(join(projectRoot, "credentials"), "token=secret\n", "utf8");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /sensitive file present/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects hidden credential files before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await writeFile(join(projectRoot, ".credentials"), "token=secret\n", "utf8");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /sensitive file present/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects Git credential store files before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await writeFile(join(projectRoot, ".git-credentials"), "https://user:pass@example.test\n");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /sensitive file present/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects hidden credential directories before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, ".credential"), { recursive: true });
      await writeFile(join(projectRoot, ".credential", "prod.json"), "{}", "utf8");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /sensitive file present/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects case variants of credential file names", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await writeFile(join(projectRoot, "serviceAccountKey.JSON"), "{}", "utf8");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /sensitive file present/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects package-manager and shell rc files before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await writeFile(join(projectRoot, ".yarnrc.yml"), "npmAuthToken: secret\n", "utf8");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /sensitive file present/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not ignore sensitive files in previous DriftRadar output", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, ".driftradar", "runs", "old"), { recursive: true });
      await writeFile(join(projectRoot, ".driftradar", "runs", "old", ".env"), "SECRET=value\n");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /sensitive file present/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("allows existing DriftRadar output before invoking Codex setup", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn().mockResolvedValue({
      canRun: true,
      reason: "Static UI",
      projectName: "Static UI",
      packageManager: "static",
      runtime: { type: "static-site", staticRoot: "." },
      installCommand: null,
      runCommand: null,
      baseUrl: "http://127.0.0.1:4555",
      routes: [{ id: "home", url: "/", label: "Home" }],
      tokenFiles: ["tokens.css"],
      sourceRoots: ["."],
      testCommands: [],
      notes: []
    });
    try {
      await mkdir(join(projectRoot, ".driftradar", "runs", "old"), { recursive: true });
      await mkdir(join(projectRoot, ".driftradar", "sandbox", "home"), { recursive: true });
      await writeFile(join(projectRoot, ".driftradar", "runs", "old", "report.json"), "{}");
      await writeFile(join(projectRoot, "tokens.css"), ":root { --color-primary: #000; }");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).resolves.toMatchObject({
        setup: { projectName: "Static UI" }
      });
      expect(runJson).toHaveBeenCalledOnce();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("ignores legacy DriftRadar Codex home output before invoking Codex setup", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn().mockResolvedValue({
      canRun: true,
      reason: "Static UI",
      projectName: "Static UI",
      packageManager: "static",
      runtime: { type: "static-site", staticRoot: "." },
      installCommand: null,
      runCommand: null,
      baseUrl: "http://127.0.0.1:4555",
      routes: [{ id: "home", url: "/", label: "Home" }],
      tokenFiles: ["tokens.css"],
      sourceRoots: ["."],
      testCommands: [],
      notes: []
    });
    try {
      await mkdir(join(projectRoot, ".driftradar", "codex-home", "examples"), {
        recursive: true
      });
      await writeFile(
        join(projectRoot, ".driftradar", "codex-home", "examples", ".env.example"),
        "TOKEN=example\n"
      );
      await writeFile(join(projectRoot, "tokens.css"), ":root { --color-primary: #000; }");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).resolves.toMatchObject({
        setup: { projectName: "Static UI" }
      });
      expect(runJson).toHaveBeenCalledOnce();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not ignore credentialed package config in legacy Codex home output", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, ".driftradar", "codex-home"), { recursive: true });
      await writeFile(
        join(projectRoot, ".driftradar", "codex-home", ".npmrc"),
        "_authToken=secret\n",
        "utf8"
      );

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /credential-bearing package manager config/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not ignore outside symlinks in legacy Codex home output", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "driftradar-outside-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, ".driftradar", "codex-home"), { recursive: true });
      const outsideSecret = join(outsideRoot, "secret.txt");
      await writeFile(outsideSecret, "secret\n", "utf8");
      await symlink(outsideSecret, join(projectRoot, ".driftradar", "codex-home", "secret-link"));

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /symlink points outside the project/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("rejects credentialed Git config URLs before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, ".git"), { recursive: true });
      await writeFile(
        join(projectRoot, ".git", "config"),
        '[remote "origin"]\n\turl = https://user:token@example.com/acme/ui.git\n',
        "utf8"
      );

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /credential-bearing Git config/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects sensitive files inside Git metadata before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, ".git"), { recursive: true });
      await writeFile(join(projectRoot, ".git", "id_rsa"), "PRIVATE KEY\n", "utf8");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /sensitive file present/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects symlinks inside Git metadata before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "driftradar-outside-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, ".git"), { recursive: true });
      const outsideSecret = join(outsideRoot, "config");
      await writeFile(outsideSecret, "[credential]\n\thelper = store\n", "utf8");
      await symlink(outsideSecret, join(projectRoot, ".git", "config"));

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /symlink points outside/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("rejects Git config authorization headers before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, ".git"), { recursive: true });
      await writeFile(
        join(projectRoot, ".git", "config"),
        '[http "https://example.com"]\n\textraHeader = AUTHORIZATION: bearer secret\n',
        "utf8"
      );

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /credential-bearing Git config/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects Git config token headers before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, ".git"), { recursive: true });
      await writeFile(
        join(projectRoot, ".git", "config"),
        '[http "https://example.com"]\n\textraHeader = PRIVATE-TOKEN: secret\n',
        "utf8"
      );

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /credential-bearing Git config/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects Git config cookie headers before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, ".git"), { recursive: true });
      await writeFile(
        join(projectRoot, ".git", "config"),
        '[http "https://example.com"]\n\textraHeader = Cookie: session=secret\n',
        "utf8"
      );

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /credential-bearing Git config/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects quoted Git config credential headers before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, ".git"), { recursive: true });
      await writeFile(
        join(projectRoot, ".git", "config"),
        '[http "https://example.com"]\n\textraHeader = "PRIVATE-TOKEN: secret"\n',
        "utf8"
      );

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /credential-bearing Git config/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects credentialed Git config symlinks that stay inside the project", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, ".git"), { recursive: true });
      await writeFile(join(projectRoot, "git-config-copy"), "[credential]\n\thelper = store\n");
      await symlink(join("..", "git-config-copy"), join(projectRoot, ".git", "config"));

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /credential-bearing Git config/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects sectioned Git credential helpers before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const runJson = vi.fn();
    try {
      await mkdir(join(projectRoot, ".git"), { recursive: true });
      await writeFile(
        join(projectRoot, ".git", "config"),
        "[credential]\n\thelper = store\n",
        "utf8"
      );

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /credential-bearing Git config/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects credentialed Git config referenced by worktree gitdir files", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const gitRoot = await mkdtemp(join(tmpdir(), "driftradar-gitdir-"));
    const runJson = vi.fn();
    try {
      const gitDir = join(gitRoot, "worktrees", "ui");
      await mkdir(gitDir, { recursive: true });
      await writeFile(join(projectRoot, ".git"), `gitdir: ${gitDir}\n`, "utf8");
      await writeFile(join(gitDir, "config"), "[credential]\n\thelper = store\n", "utf8");

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /credential-bearing Git config/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(gitRoot, { recursive: true, force: true });
    }
  });

  it("rejects symlinks to sensitive files outside the project before invoking Codex", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "driftradar-outside-"));
    const runJson = vi.fn();
    try {
      const outsideSecret = join(outsideRoot, ".env");
      await writeFile(outsideSecret, "SECRET=value\n", "utf8");
      await symlink(outsideSecret, join(projectRoot, "config.json"));

      await expect(createProjectRuntimePlan(projectRoot, { runJson })).rejects.toThrow(
        /symlink points outside/
      );
      expect(runJson).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("builds a real scan config from Codex project setup", () => {
    const config = configFromSetup(process.cwd(), {
      canRun: true,
      reason: "Vite app",
      projectName: "Example UI",
      packageManager: "pnpm",
      runtime: { type: "package-script", staticRoot: null },
      installCommand: "pnpm install",
      runCommand: "pnpm run dev --host 127.0.0.1 --port 4555",
      baseUrl: "http://127.0.0.1:4555",
      routes: [{ id: "Home Page", url: "/", label: "Home" }],
      tokenFiles: ["fixtures/config/tokens.css"],
      sourceRoots: ["sample-app"],
      testCommands: ["pnpm test"],
      notes: []
    });

    expect(config.captureMode).toBe("real");
    expect(config.ai.model).toBe("gpt-5.4-mini");
    expect(config.ai.reasoningEffort).toBe("medium");
    expect(config.routes[0]?.id).toBe("home-page");
    expect(config.tokenFiles[0]).toContain("fixtures/config/tokens.css");
    expect(config.ai.sourceRoots[0]).toContain("sample-app");
  });

  it("rejects source roots that are not directories", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    try {
      await writeFile(join(projectRoot, "tokens.css"), ":root { --color-primary: #000; }");
      await writeFile(join(projectRoot, "App.tsx"), "export function App() { return null; }");

      expect(() =>
        configFromSetup(projectRoot, {
          canRun: true,
          reason: "Vite app",
          projectName: "Example UI",
          packageManager: "pnpm",
          runtime: { type: "package-script", staticRoot: null },
          installCommand: "pnpm install",
          runCommand: "pnpm run dev --host 127.0.0.1 --port 4555",
          baseUrl: "http://127.0.0.1:4555",
          routes: [{ id: "home", url: "/", label: "Home" }],
          tokenFiles: ["tokens.css"],
          sourceRoots: ["App.tsx"],
          testCommands: [],
          notes: []
        })
      ).toThrow(/source root must be a directory/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("accepts package-script runtimes from nested project folders", () => {
    const setup = {
      canRun: true,
      reason: "Nested docs app",
      projectName: "Docs",
      packageManager: "pnpm" as const,
      runtime: {
        type: "package-script" as const,
        staticRoot: null,
        workingDirectory: "sample-app"
      },
      installCommand: "pnpm install",
      runCommand: "pnpm run dev --host 127.0.0.1 --port 4555",
      baseUrl: "http://127.0.0.1:4555",
      routes: [{ id: "home", url: "/", label: "Home" }],
      tokenFiles: ["fixtures/config/tokens.css"],
      sourceRoots: ["sample-app"],
      testCommands: ["pnpm test"],
      notes: []
    };

    const config = configFromSetup(process.cwd(), setup);

    expect(projectRuntimeRoot(process.cwd(), setup)).toContain("sample-app");
    expect(config.projectName).toBe("Docs");
  });

  it("builds a real scan config for static HTML folders", () => {
    const config = configFromSetup(process.cwd(), {
      canRun: true,
      reason: "Static HTML app",
      projectName: "Static UI",
      packageManager: "static",
      runtime: { type: "static-site", staticRoot: "sample-app" },
      installCommand: null,
      runCommand: null,
      baseUrl: "http://127.0.0.1:4555",
      routes: [{ id: "Home Page", url: "/", label: "Home" }],
      tokenFiles: ["fixtures/config/tokens.css"],
      sourceRoots: ["sample-app"],
      testCommands: [],
      notes: []
    });

    expect(config.captureMode).toBe("real");
    expect(config.baseUrl).toBe("http://127.0.0.1:4555");
    expect(config.routes[0]?.id).toBe("home-page");
  });

  it("rejects static-site runtimes with package workingDirectory", () => {
    expect(() =>
      configFromSetup(process.cwd(), {
        canRun: true,
        reason: "Static HTML app",
        projectName: "Static UI",
        packageManager: "static",
        runtime: { type: "static-site", staticRoot: "sample-app", workingDirectory: "sample-app" },
        installCommand: null,
        runCommand: null,
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "Home Page", url: "/", label: "Home" }],
        tokenFiles: ["fixtures/config/tokens.css"],
        sourceRoots: ["sample-app"],
        testCommands: [],
        notes: []
      })
    ).toThrow(/static-site runtime must not set workingDirectory/);
  });

  it("rejects https base URLs for internally served static folders", () => {
    expect(() =>
      configFromSetup(process.cwd(), {
        canRun: true,
        reason: "Static HTTPS app",
        projectName: "Static HTTPS",
        packageManager: "static",
        runtime: { type: "static-site", staticRoot: "sample-app" },
        installCommand: null,
        runCommand: null,
        baseUrl: "https://127.0.0.1:4555",
        routes: [{ id: "Home Page", url: "/", label: "Home" }],
        tokenFiles: ["fixtures/config/tokens.css"],
        sourceRoots: ["sample-app"],
        testCommands: [],
        notes: []
      })
    ).toThrow(/static-site baseUrl must use http/);
  });

  it("rejects base URLs without explicit local ports", () => {
    expect(() =>
      configFromSetup(process.cwd(), {
        canRun: true,
        reason: "Portless app",
        projectName: "Portless",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: null,
        runCommand: "npm run dev -- --host 127.0.0.1",
        baseUrl: "http://127.0.0.1",
        routes: [{ id: "Home Page", url: "/", label: "Home" }],
        tokenFiles: ["fixtures/config/tokens.css"],
        sourceRoots: ["sample-app"],
        testCommands: [],
        notes: []
      })
    ).toThrow(/baseUrl must include an explicit local port/);
  });

  it("rejects non-local base URLs", () => {
    expect(() =>
      configFromSetup(process.cwd(), {
        canRun: true,
        reason: "remote app",
        projectName: "Remote",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: null,
        runCommand: "npm run dev",
        baseUrl: "https://example.com",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["fixtures/config/tokens.css"],
        sourceRoots: ["sample-app"],
        testCommands: [],
        notes: []
      })
    ).toThrow(/non-local URL/);
  });

  it("rejects hostnames that only look like loopback IPs", () => {
    expect(() =>
      configFromSetup(process.cwd(), {
        canRun: true,
        reason: "spoofed app",
        projectName: "Spoofed",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: null,
        runCommand: "npm run dev",
        baseUrl: "http://127.evil.com:4555",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["fixtures/config/tokens.css"],
        sourceRoots: ["sample-app"],
        testCommands: [],
        notes: []
      })
    ).toThrow(/non-local URL/);
  });

  it("rejects local URLs with embedded credentials", () => {
    expect(() =>
      configFromSetup(process.cwd(), {
        canRun: true,
        reason: "credential URL",
        projectName: "Credential URL",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: null,
        runCommand: "npm run dev -- --host 127.0.0.1",
        baseUrl: "http://user:pass@127.0.0.1:4555",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["fixtures/config/tokens.css"],
        sourceRoots: ["sample-app"],
        testCommands: [],
        notes: []
      })
    ).toThrow(/must not include credentials/);
  });

  it("rejects route URLs with embedded credentials", () => {
    expect(() =>
      configFromSetup(process.cwd(), {
        canRun: true,
        reason: "credential route URL",
        projectName: "Credential Route URL",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: null,
        runCommand: "npm run dev -- --host 127.0.0.1",
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "home", url: "http://user:pass@127.0.0.1:4555/", label: "Home" }],
        tokenFiles: ["fixtures/config/tokens.css"],
        sourceRoots: ["sample-app"],
        testCommands: [],
        notes: []
      })
    ).toThrow(/must not include credentials/);
  });

  it("rejects malformed local URLs with the unsupported-project message", () => {
    expect(() =>
      configFromSetup(process.cwd(), {
        canRun: true,
        reason: "bad URL",
        projectName: "Bad URL",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: null,
        runCommand: "npm run dev",
        baseUrl: "localhost",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["fixtures/config/tokens.css"],
        sourceRoots: ["sample-app"],
        testCommands: [],
        notes: []
      })
    ).toThrow(/DriftRadar cannot work with this project: invalid local URL/);
  });

  it("rejects absolute route URLs on a different local origin", () => {
    expect(() =>
      configFromSetup(process.cwd(), {
        canRun: true,
        reason: "wrong origin",
        projectName: "Wrong Origin",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: null,
        runCommand: "npm run dev",
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "admin", url: "http://127.0.0.1:4556/admin", label: "Admin" }],
        tokenFiles: ["fixtures/config/tokens.css"],
        sourceRoots: ["sample-app"],
        testCommands: [],
        notes: []
      })
    ).toThrow(/base origin/);
  });

  it("rejects Codex-returned paths outside the project", () => {
    expect(() =>
      configFromSetup(process.cwd(), {
        canRun: true,
        reason: "bad path",
        projectName: "Bad Path",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: null,
        runCommand: "npm run dev",
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["/tmp/outside.css"],
        sourceRoots: ["sample-app"],
        testCommands: [],
        notes: []
      })
    ).toThrow(/path not found|outside the project/);
  });

  it("rejects symlinked token files that resolve outside the project", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "driftradar-outside-"));
    try {
      const outsideToken = join(outsideRoot, "tokens.css");
      await writeFile(outsideToken, ":root { --color-primary: #000; }", "utf8");
      await symlink(outsideToken, join(projectRoot, "tokens.css"));

      expect(() =>
        configFromSetup(projectRoot, {
          canRun: true,
          reason: "symlink token",
          projectName: "Symlink Token",
          packageManager: "npm",
          runtime: { type: "package-script", staticRoot: null },
          installCommand: null,
          runCommand: "npm run dev",
          baseUrl: "http://127.0.0.1:4555",
          routes: [{ id: "home", url: "/", label: "Home" }],
          tokenFiles: ["tokens.css"],
          sourceRoots: ["."],
          testCommands: [],
          notes: []
        })
      ).toThrow(/outside the project/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});
