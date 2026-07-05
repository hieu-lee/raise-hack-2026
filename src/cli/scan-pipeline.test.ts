import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { suggestRepoFix } from "../ai/repo-fixes.js";
import type { ProjectSetup } from "../ai/project-setup.js";
import type { DriftIssue, DriftRadarConfig } from "../contracts/types.js";
import {
  assertCompatiblePackageManager,
  ensureBaseOriginFree,
  localPackageManagerVersion,
  parseProjectCommand,
  projectDependenciesInstalled,
  retainReachableRoutes,
  sandboxProjectCommand,
  sandboxProjectRunCommand,
  shouldUseStaticIndexFallback,
  dynamicLibraryReadRootsFromOtool,
  toolchainReadRoots,
  validateProjectTokens,
  validateProjectCommands
} from "./scan-pipeline.js";

describe("scan pipeline repo fixes", () => {
  it("attaches source files without AI", async () => {
    const issue: DriftIssue = {
      id: "issue_token",
      title: "Primary button uses a near-token blue literal",
      category: "token_misuse",
      severity: "high",
      confidence: 0.9,
      routeId: "buttons",
      viewport: "desktop",
      state: "default",
      elementId: "buttons-primary-action",
      selectorHint: ".primary-action",
      property: "color",
      observedValue: "#1f6fe5",
      expectedValue: "var(--color-primary-600)",
      nearestToken: "--color-primary-600",
      evidence: {
        screenshotPath: "screenshots/buttons/desktop/default.png",
        occurrenceCount: 2,
        relatedIssueIds: []
      },
      reasoning: "literal blue",
      suggestedFix: {
        type: "replace-css",
        cssBefore: "background: #1f6fe5;",
        cssAfter: "background: var(--color-primary-600);",
        humanInstruction: "Replace literal"
      },
      status: "open"
    };

    const fix = await suggestRepoFix(issue, ["sample-app"]);
    expect(fix?.sourceFile).toContain("sample-app/styles.css");
    expect(fix?.tsxAfter).toContain("patch styles");
  });

  it("does not execute project-controlled package manager shims for version checks", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    const previousPath = process.env.PATH;
    try {
      const binDir = join(projectRoot, "node_modules", ".bin");
      await mkdir(binDir, { recursive: true });
      const shim = join(binDir, "pnpm");
      await writeFile(shim, "#!/bin/sh\nprintf '999.0.0\\n'\n", "utf8");
      await chmod(shim, 0o755);
      process.env.PATH = `${binDir}${delimiter}${previousPath ?? ""}`;

      expect(localPackageManagerVersion(projectRoot, projectRoot, "pnpm")).not.toBe("999.0.0");
    } finally {
      process.env.PATH = previousPath;
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not execute ambient PATH package manager shims for version checks", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    const shimRoot = await mkdtemp(join(tmpdir(), "driftradar-path-test-"));
    const previousPath = process.env.PATH;
    try {
      const shim = join(shimRoot, "pnpm");
      await writeFile(shim, "#!/bin/sh\nprintf '999.0.0\\n'\n", "utf8");
      await chmod(shim, 0o755);
      process.env.PATH = `${shimRoot}${delimiter}${previousPath ?? ""}`;

      expect(localPackageManagerVersion(projectRoot, projectRoot, "pnpm")).not.toBe("999.0.0");
    } finally {
      process.env.PATH = previousPath;
      await rm(projectRoot, { recursive: true, force: true });
      await rm(shimRoot, { recursive: true, force: true });
    }
  });

  it("rejects package-manager selections that conflict with lockfiles", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      await writeFile(
        join(projectRoot, "package.json"),
        JSON.stringify({ scripts: { dev: "vite" } }),
        "utf8"
      );
      await writeFile(join(projectRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
      const setup: ProjectSetup = {
        canRun: true,
        reason: "Vite app",
        projectName: "Vite",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: "npm install",
        runCommand: "npm run dev -- --host 127.0.0.1 --port 4555",
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["tokens.css"],
        sourceRoots: ["src"],
        testCommands: [],
        notes: []
      };

      expect(() => assertCompatiblePackageManager(projectRoot, projectRoot, setup)).toThrow(
        /package lockfile requires pnpm/
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects conflicting lockfiles across runtime and ancestor roots", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      const runtimeRoot = join(projectRoot, "examples", "site");
      await mkdir(runtimeRoot, { recursive: true });
      await writeFile(
        join(runtimeRoot, "package.json"),
        JSON.stringify({ scripts: { dev: "vite" } }),
        "utf8"
      );
      await writeFile(join(runtimeRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      await writeFile(join(projectRoot, "package-lock.json"), "{}\n");
      const setup: ProjectSetup = {
        canRun: true,
        reason: "Nested Vite app",
        projectName: "Vite",
        packageManager: "pnpm",
        runtime: { type: "package-script", staticRoot: null, workingDirectory: "examples/site" },
        installCommand: "pnpm install",
        runCommand: "pnpm run dev --host 127.0.0.1 --port 4555",
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["tokens.css"],
        sourceRoots: ["src"],
        testCommands: [],
        notes: []
      };

      expect(() => assertCompatiblePackageManager(projectRoot, runtimeRoot, setup)).toThrow(
        /multiple package-manager lockfiles/
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("uses package-manager metadata from ancestors between runtime and project roots", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      const runtimeRoot = join(projectRoot, "examples", "site");
      await mkdir(runtimeRoot, { recursive: true });
      await writeFile(
        join(runtimeRoot, "package.json"),
        JSON.stringify({ scripts: { dev: "vite" } }),
        "utf8"
      );
      await writeFile(join(projectRoot, "examples", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      const setup: ProjectSetup = {
        canRun: true,
        reason: "Nested Vite app",
        projectName: "Vite",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null, workingDirectory: "examples/site" },
        installCommand: "npm install",
        runCommand: "npm run dev -- --host 127.0.0.1 --port 4555",
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["tokens.css"],
        sourceRoots: ["src"],
        testCommands: [],
        notes: []
      };

      expect(() => assertCompatiblePackageManager(projectRoot, runtimeRoot, setup)).toThrow(
        /package lockfile requires pnpm/
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects package-manager selections that conflict with packageManager tags", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      await writeFile(
        join(projectRoot, "package.json"),
        JSON.stringify({ packageManager: "pnpm@latest", scripts: { dev: "vite" } }),
        "utf8"
      );
      const setup: ProjectSetup = {
        canRun: true,
        reason: "Vite app",
        projectName: "Vite",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: "npm install",
        runCommand: "npm run dev -- --host 127.0.0.1 --port 4555",
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["tokens.css"],
        sourceRoots: ["src"],
        testCommands: [],
        notes: []
      };

      expect(() => assertCompatiblePackageManager(projectRoot, projectRoot, setup)).toThrow(
        /packageManager requires pnpm@latest/
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("enforces exact package-manager versions with Corepack hashes", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      const actualNpmVersion = localPackageManagerVersion(projectRoot, projectRoot, "npm");
      expect(actualNpmVersion).toBeDefined();
      const major = actualNpmVersion?.match(/^(\d+)/)?.[1] ?? "999";
      const [, minor = "0", patch = "0"] = actualNpmVersion?.split(".") ?? [];
      const pinnedPatch = patch === "0" ? "1" : "0";
      await writeFile(
        join(projectRoot, "package.json"),
        JSON.stringify({
          packageManager: `npm@${major}.${minor}.${pinnedPatch}+sha224.deadbeef`,
          scripts: { dev: "vite" }
        }),
        "utf8"
      );
      const setup: ProjectSetup = {
        canRun: true,
        reason: "Vite app",
        projectName: "Vite",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: "npm install",
        runCommand: "npm run dev -- --host 127.0.0.1 --port 4555",
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["tokens.css"],
        sourceRoots: ["src"],
        testCommands: [],
        notes: []
      };

      expect(() => assertCompatiblePackageManager(projectRoot, projectRoot, setup)).toThrow(
        /packageManager requires npm@/
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("treats ancestor node_modules as installed for nested runtime roots", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      const runtimeRoot = join(projectRoot, "docs");
      await writeFile(
        join(projectRoot, "package.json"),
        JSON.stringify({ workspaces: ["docs"] }),
        "utf8"
      );
      await mkdir(join(projectRoot, "node_modules"), { recursive: true });
      await mkdir(runtimeRoot, { recursive: true });

      expect(projectDependenciesInstalled(projectRoot, runtimeRoot, "npm")).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not treat pnpm ancestor node_modules as installed for nested runtime roots", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      const runtimeRoot = join(projectRoot, "apps", "web");
      await writeFile(join(projectRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
      await mkdir(join(projectRoot, "node_modules"), { recursive: true });
      await mkdir(runtimeRoot, { recursive: true });

      expect(projectDependenciesInstalled(projectRoot, runtimeRoot, "pnpm")).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("treats runtime node_modules as installed for pnpm nested runtime roots", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      const runtimeRoot = join(projectRoot, "apps", "web");
      await mkdir(join(runtimeRoot, "node_modules"), { recursive: true });

      expect(projectDependenciesInstalled(projectRoot, runtimeRoot, "pnpm")).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("honors negated workspace patterns before treating ancestor node_modules as installed", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      const runtimeRoot = join(projectRoot, "apps", "excluded");
      await writeFile(
        join(projectRoot, "package.json"),
        JSON.stringify({ workspaces: ["apps/*", "!apps/excluded"] }),
        "utf8"
      );
      await mkdir(join(projectRoot, "node_modules"), { recursive: true });
      await mkdir(runtimeRoot, { recursive: true });

      expect(projectDependenciesInstalled(projectRoot, runtimeRoot, "npm")).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not treat unrelated ancestor node_modules as installed for nested runtime roots", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      const runtimeRoot = join(projectRoot, "docs");
      await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "root" }), "utf8");
      await mkdir(join(projectRoot, "node_modules"), { recursive: true });
      await mkdir(runtimeRoot, { recursive: true });

      expect(projectDependenciesInstalled(projectRoot, runtimeRoot, "pnpm")).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("project command parsing", () => {
  it("allows simple package-manager commands without a shell", () => {
    expect(
      parseProjectCommand("pnpm run dev --host 127.0.0.1 --port 4555", {
        scripts: new Set(["dev"])
      })
    ).toEqual({
      command: "pnpm",
      args: ["run", "dev", "--host", "127.0.0.1", "--port", "4555"]
    });
    expect(
      parseProjectCommand("npm run dev -- --host=127.0.0.1 --port=4555 --strictPort", {
        scripts: new Set(["dev"])
      })
    ).toEqual({
      command: "npm",
      args: ["run", "dev", "--", "--host=127.0.0.1", "--port=4555", "--strictPort"]
    });
    expect(
      parseProjectCommand("npm run dev -- --hostname localhost --port 4555", {
        scripts: new Set(["dev"])
      })
    ).toEqual({
      command: "npm",
      args: ["run", "dev", "--", "--hostname", "localhost", "--port", "4555"]
    });
    expect(
      parseProjectCommand("pnpm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: new Set(["dev"])
      })
    ).toEqual({
      command: "pnpm",
      args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", "4555"]
    });
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: new Map([["dev", "parcel src/index.html"]])
      })
    ).toEqual({
      command: "npm",
      args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", "4555"]
    });
  });

  it("allows known install commands", () => {
    expect(parseProjectCommand("npm ci", { kind: "install" })).toEqual({
      command: "npm",
      args: ["ci", "--ignore-scripts"]
    });
    expect(parseProjectCommand("npm install --no-scripts", { kind: "install" })).toEqual({
      command: "npm",
      args: ["install", "--no-scripts", "--ignore-scripts"]
    });
    expect(parseProjectCommand("pnpm install --frozen-lockfile", { kind: "install" })).toEqual({
      command: "pnpm",
      args: ["install", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile"]
    });
    expect(parseProjectCommand("pnpm install --ignore-pnpmfile", { kind: "install" })).toEqual({
      command: "pnpm",
      args: ["install", "--ignore-pnpmfile", "--ignore-scripts"]
    });
  });

  it("rejects shell syntax and unsupported executables", () => {
    expect(parseProjectCommand("pnpm dev; rm -rf .")).toBeUndefined();
    expect(parseProjectCommand("bash -lc 'npm run dev'")).toBeUndefined();
  });

  it("rejects package-manager commands outside package scripts", () => {
    const scripts = new Set(["dev"]);
    expect(parseProjectCommand("npm exec -- sh -c echo", { scripts })).toBeUndefined();
    expect(parseProjectCommand("pnpm dlx vite", { scripts })).toBeUndefined();
    expect(parseProjectCommand("npm install left-pad", { kind: "install" })).toBeUndefined();
    expect(parseProjectCommand("npm install --", { kind: "install" })).toBeUndefined();
    expect(
      parseProjectCommand("npm install --userconfig=/tmp/npmrc", { kind: "install" })
    ).toBeUndefined();
    expect(
      parseProjectCommand("pnpm install --registry=https://registry.example", { kind: "install" })
    ).toBeUndefined();
    expect(parseProjectCommand("pnpm dev", { scripts })).toBeUndefined();
    expect(parseProjectCommand("npm run dev", { scripts })).toBeUndefined();
    expect(parseProjectCommand("npm run dev --host 127.0.0.1", { scripts })).toBeUndefined();
    expect(parseProjectCommand("pnpm run dev", { scripts })).toBeUndefined();
    expect(parseProjectCommand("pnpm run dev -- --workspace other", { scripts })).toBeUndefined();
    expect(parseProjectCommand("npm start", { scripts: new Set(["start"]) })).toBeUndefined();
    expect(parseProjectCommand("pnpm --dir ../other dev", { scripts })).toBeUndefined();
    expect(parseProjectCommand("pnpm run dev --dir=../other", { scripts })).toBeUndefined();
    expect(parseProjectCommand("npm run dev --workspace other", { scripts })).toBeUndefined();
    expect(parseProjectCommand("npm run dev -w other", { scripts })).toBeUndefined();
    expect(parseProjectCommand("npm run dev -wother", { scripts })).toBeUndefined();
    expect(parseProjectCommand("npm run dev --ws", { scripts })).toBeUndefined();
    expect(parseProjectCommand("npm install -g", { kind: "install" })).toBeUndefined();
    expect(parseProjectCommand("pnpm install -g", { kind: "install" })).toBeUndefined();
    expect(parseProjectCommand("pnpm run dev -F other", { scripts })).toBeUndefined();
    expect(parseProjectCommand("pnpm run dev -Fother", { scripts })).toBeUndefined();
    expect(
      parseProjectCommand("pnpm run dev --filter-prod=./apps/admin", { scripts })
    ).toBeUndefined();
    expect(parseProjectCommand("pnpm run dev -r", { scripts })).toBeUndefined();
    expect(parseProjectCommand("pnpm run dev -C/tmp/other", { scripts })).toBeUndefined();
    expect(parseProjectCommand("npm run dev -- /tmp/other", { scripts })).toBeUndefined();
    expect(
      parseProjectCommand("npm run start -- --host 127.0.0.1 --port 4555", {
        scripts: new Map([["start", "react-scripts start"]])
      })
    ).toBeUndefined();
    expect(parseProjectCommand("npm run dev", { scripts })).toBeUndefined();
    expect(parseProjectCommand("npm run dev -- --host 127.0.0.1", { scripts })).toBeUndefined();
    expect(parseProjectCommand("npm run dev -- --port 4555", { scripts })).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555 --port 5173", {
        scripts
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --hostname localhost --port 4555", {
        scripts
      })
    ).toBeUndefined();
    expect(parseProjectCommand("npm run dev -- --host 0.0.0.0", { scripts })).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host=localhost=evil", { scripts })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --hostname=192.168.1.20", { scripts })
    ).toBeUndefined();
    expect(parseProjectCommand("npm run dev -- --port abc", { scripts })).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --config /tmp/vite.config.ts", { scripts })
    ).toBeUndefined();
    expect(parseProjectCommand("npm run dev -- --root=../other", { scripts })).toBeUndefined();
    expect(
      parseProjectCommand("pnpm --dir /tmp/other dev", { scripts: new Set(["--dir"]) })
    ).toBeUndefined();
  });

  it("rejects unsafe host settings inside package scripts", () => {
    const unsafeHost = new Map([["dev", "vite --host 0.0.0.0"]]);
    const unsafeHostEnv = new Map([["dev", "HOST=0.0.0.0 vite"]]);
    const unsafeIpLiteral = new Map([["dev", "vite --listen 192.168.1.20"]]);
    const unsafeInlineBind = new Map([["dev", "vite --listen=0.0.0.0"]]);
    const unsafeShortHost = new Map([["dev", "next dev -H devbox.local"]]);
    const unsafeAttachedShortHost = new Map([["dev", "next dev -H127.0.0.2"]]);
    const unsafeAttachedShortPort = new Map([["dev", "next dev -p3000 -H127.0.0.1"]]);
    const unsafeNewline = new Map([["dev", "echo setup\nvite"]]);
    const unsafeHostPort = new Map([["dev", "serve -l 0.0.0.0:3000"]]);
    const unsafeHostUrl = new Map([["dev", "serve -l tcp://0.0.0.0:3000"]]);
    const unsafeConfig = new Map([["dev", "vite --config /tmp/evil.config.ts --host 127.0.0.1"]]);
    const unsafeShortConfig = new Map([["dev", "vite -c /tmp/evil.config.ts --host 127.0.0.1"]]);
    const unsafeAttachedShortConfig = new Map([
      ["dev", "storybook dev -cother --host 127.0.0.1 --port 6006"]
    ]);
    const unsafeRoot = new Map([["dev", "vite --root ../other --host 127.0.0.1"]]);
    const unsafePositionalRoot = new Map([["dev", "vite --host 127.0.0.1 /tmp/other"]]);
    const unsafePlainPositionalRoot = new Map([["dev", "next dev other --hostname localhost"]]);
    const unsafeExecutablePath = new Map([["dev", "/tmp/vite --host 127.0.0.1"]]);
    const unsafeWebpackConfig = new Map([
      ["dev", "webpack serve --config /tmp/webpack.config.js --host 127.0.0.1"]
    ]);
    const unsafeOpenBrowser = new Map([["dev", "vite --open --host 127.0.0.1"]]);
    const unsafeShellWrapper = new Map([["dev", "bash -lc 'vite --host 0.0.0.0'"]]);
    const unsafeShellPath = new Map([["dev", "/bin/sh -c 'vite --host 0.0.0.0'"]]);
    const unsafeNestedScript = new Map([
      ["dev", "npm run expose"],
      ["expose", "vite --host 0.0.0.0"]
    ]);
    const unsafeNestedPnpm = new Map([
      ["dev", "pnpm run expose"],
      ["expose", "vite --host 0.0.0.0"]
    ]);
    const unsafeNodeRuntime = new Map([["dev", "node server.js"]]);
    const unsafeTsxRuntime = new Map([["dev", "tsx server.ts"]]);
    const unsafeUnknownRuntime = new Map([["dev", "custom-dev-server"]]);
    const unsafeLifecycle = new Map([
      ["predev", "vite --host 0.0.0.0"],
      ["dev", "vite"]
    ]);
    const safeHost = new Map([["dev", "vite --host localhost"]]);

    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeHost
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeHostEnv
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeIpLiteral
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeInlineBind
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeShortHost
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeAttachedShortHost
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeAttachedShortPort
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeNewline
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeHostPort
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeHostUrl
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeConfig
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeShortConfig
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeAttachedShortConfig
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeRoot
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafePositionalRoot
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafePlainPositionalRoot
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeExecutablePath
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeWebpackConfig
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeOpenBrowser
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeShellWrapper
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeShellPath
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeNestedScript
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("pnpm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeNestedPnpm
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeNodeRuntime
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeTsxRuntime
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeUnknownRuntime
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: unsafeLifecycle
      })
    ).toBeUndefined();
    expect(
      parseProjectCommand("npm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: safeHost
      })
    ).toEqual({
      command: "npm",
      args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", "4555"]
    });
  });
});

describe("project command validation", () => {
  it("requires package-script run command ports to match baseUrl", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      await writeFile(
        join(projectRoot, "package.json"),
        JSON.stringify({ scripts: { dev: "vite" } }),
        "utf8"
      );
      const setup: ProjectSetup = {
        canRun: true,
        reason: "Vite app",
        projectName: "Vite",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: null,
        runCommand: "npm run dev -- --host 127.0.0.1 --port 4555",
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["tokens.css"],
        sourceRoots: ["src"],
        testCommands: [],
        notes: []
      };

      expect(() =>
        validateProjectCommands(projectRoot, setup, "http://127.0.0.1:4555")
      ).not.toThrow();
      expect(() =>
        validateProjectCommands(
          projectRoot,
          { ...setup, runCommand: "npm run dev -- --host 127.0.0.1" },
          "http://127.0.0.1:4555"
        )
      ).toThrow(/unsupported run command/);
      expect(() =>
        validateProjectCommands(
          projectRoot,
          { ...setup, runCommand: "npm run dev -- --host 127.0.0.1 --port 5173" },
          "http://127.0.0.1:4555"
        )
      ).toThrow(/unsupported run command/);
      expect(() => validateProjectCommands(projectRoot, setup, "http://127.0.0.2:4555")).toThrow(
        /unsupported run command/
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("allows Parcel scripts with project-local entrypoints", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      await mkdir(join(projectRoot, "src"), { recursive: true });
      await writeFile(
        join(projectRoot, "package.json"),
        JSON.stringify({ scripts: { dev: "parcel src/index.html" } }),
        "utf8"
      );
      await writeFile(join(projectRoot, "src", "index.html"), "<main></main>", "utf8");
      const setup: ProjectSetup = {
        canRun: true,
        reason: "Parcel app",
        projectName: "Parcel",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: null,
        runCommand: "npm run dev -- --host 127.0.0.1 --port 4555",
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["tokens.css"],
        sourceRoots: ["src"],
        testCommands: [],
        notes: []
      };

      expect(() =>
        validateProjectCommands(projectRoot, setup, "http://127.0.0.1:4555")
      ).not.toThrow();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("normalizes package-manager --dir commands that match runtime workingDirectory", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      const runtimeRoot = join(projectRoot, "docs");
      await mkdir(runtimeRoot, { recursive: true });
      await writeFile(
        join(runtimeRoot, "package.json"),
        JSON.stringify({ scripts: { dev: "vite" } }),
        "utf8"
      );
      const setup: ProjectSetup = {
        canRun: true,
        reason: "Nested Vite app",
        projectName: "Nested",
        packageManager: "pnpm",
        runtime: { type: "package-script", staticRoot: null, workingDirectory: "docs" },
        installCommand: "pnpm --dir docs install",
        runCommand: "pnpm --dir docs run dev --host 127.0.0.1 --port 4555",
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["tokens.css"],
        sourceRoots: ["docs"],
        testCommands: [],
        notes: []
      };

      for (const installCommand of [
        "pnpm --dir docs install",
        "pnpm --dir=docs install",
        "pnpm -Cdocs install"
      ]) {
        expect(() =>
          validateProjectCommands(
            runtimeRoot,
            { ...setup, installCommand },
            "http://127.0.0.1:4555"
          )
        ).not.toThrow();
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("requires setup commands to use the detected package manager", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      await writeFile(
        join(projectRoot, "package.json"),
        JSON.stringify({ scripts: { dev: "vite" } }),
        "utf8"
      );
      const setup: ProjectSetup = {
        canRun: true,
        reason: "Vite app",
        projectName: "Vite",
        packageManager: "pnpm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: "pnpm install",
        runCommand: "pnpm run dev -- --host 127.0.0.1 --port 4555",
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["tokens.css"],
        sourceRoots: ["src"],
        testCommands: [],
        notes: []
      };

      expect(() =>
        validateProjectCommands(
          projectRoot,
          { ...setup, installCommand: "npm install" },
          "http://127.0.0.1:4555"
        )
      ).toThrow(/install command must use pnpm/);
      expect(() =>
        validateProjectCommands(
          projectRoot,
          { ...setup, runCommand: "npm run dev -- --host 127.0.0.1 --port 4555" },
          "http://127.0.0.1:4555"
        )
      ).toThrow(/run command must use pnpm/);
      expect(() =>
        validateProjectCommands(
          projectRoot,
          {
            ...setup,
            packageManager: "unknown",
            installCommand: "pnpm install",
            runCommand: "npm run dev -- --host 127.0.0.1 --port 4555"
          },
          "http://127.0.0.1:4555"
        )
      ).toThrow(/requires a concrete package manager/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects Parcel scripts with outside entrypoints", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "driftradar-outside-"));
    try {
      await writeFile(
        join(projectRoot, "package.json"),
        JSON.stringify({ scripts: { dev: "parcel ../outside/index.html" } }),
        "utf8"
      );
      await writeFile(join(outsideRoot, "index.html"), "<main></main>", "utf8");
      const setup: ProjectSetup = {
        canRun: true,
        reason: "Parcel app",
        projectName: "Parcel",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: null,
        runCommand: "npm run dev -- --host 127.0.0.1 --port 4555",
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["tokens.css"],
        sourceRoots: ["src"],
        testCommands: [],
        notes: []
      };

      expect(() => validateProjectCommands(projectRoot, setup, "http://127.0.0.1:4555")).toThrow(
        /unsupported run command/
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("rejects package scripts with hard-coded ports that disagree with baseUrl", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-command-test-"));
    try {
      await writeFile(
        join(projectRoot, "package.json"),
        JSON.stringify({ scripts: { dev: "vite --host 127.0.0.1 --port 3000" } }),
        "utf8"
      );
      const setup: ProjectSetup = {
        canRun: true,
        reason: "Vite app",
        projectName: "Vite",
        packageManager: "npm",
        runtime: { type: "package-script", staticRoot: null },
        installCommand: null,
        runCommand: "npm run dev -- --host 127.0.0.1 --port 4555",
        baseUrl: "http://127.0.0.1:4555",
        routes: [{ id: "home", url: "/", label: "Home" }],
        tokenFiles: ["tokens.css"],
        sourceRoots: ["src"],
        testCommands: [],
        notes: []
      };

      expect(() => validateProjectCommands(projectRoot, setup, "http://127.0.0.1:4555")).toThrow(
        /unsupported run command/
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("project command sandboxing", () => {
  it("extracts narrow dynamic library roots from macOS toolchain binaries", () => {
    expect(
      dynamicLibraryReadRootsFromOtool(`/opt/homebrew/Cellar/node/25.8.0/bin/node:
\t/opt/homebrew/opt/llhttp/lib/libllhttp.9.3.dylib (compatibility version 10.0.0, current version 10.0.0)
\t/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib (compatibility version 3.0.0, current version 3.0.0)
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)
`)
    ).toEqual(["/opt/homebrew/opt/llhttp/lib", "/opt/homebrew/opt/openssl@3/lib"]);
  });

  it("allows binary install roots when runtimes load sibling libraries", async () => {
    const installRoot = await mkdtemp(join(tmpdir(), "driftradar-toolchain-"));
    try {
      await mkdir(join(installRoot, "bin"), { recursive: true });
      await mkdir(join(installRoot, "lib"), { recursive: true });

      expect(toolchainReadRoots([join(installRoot, "bin", "node")])).toContain(installRoot);
    } finally {
      await rm(installRoot, { recursive: true, force: true });
    }
  });

  it("does not widen top-level Homebrew or local toolchain prefixes", () => {
    const roots = toolchainReadRoots(["/opt/homebrew/bin/pnpm", "/usr/local/bin/node"]);

    expect(roots).not.toContain("/opt/homebrew");
    expect(roots).not.toContain("/usr/local");
    expect(roots).toContain("/opt/homebrew/bin");
    expect(roots).toContain("/usr/local/bin");
  });

  it("wraps package-script commands in a host sandbox with scratch process state", async () => {
    const hasPnpm = process.env.PATH?.split(delimiter).some((dir) => existsSync(join(dir, "pnpm")));
    if (process.platform !== "darwin" || !hasPnpm) {
      return;
    }
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-sandbox-test-"));
    try {
      const command = parseProjectCommand("pnpm run dev -- --host 127.0.0.1 --port 4555", {
        scripts: new Set(["dev"])
      });
      expect(command).toBeDefined();

      const sandboxed = await sandboxProjectCommand(
        projectRoot,
        command!,
        "run",
        "http://127.0.0.1:4555"
      );

      expect(sandboxed.command).toBe("/usr/bin/sandbox-exec");
      expect(sandboxed.args).toContain("-p");
      const profile = sandboxed.args[sandboxed.args.indexOf("-p") + 1];
      expect(profile).toContain("(deny default)");
      expect(profile).not.toContain("(deny process-fork)");
      expect(profile).toContain(".ssh");
      expect(profile).not.toContain('(subpath (param "USER_HOME"))');
      expect(profile).toContain('(allow network-inbound\n  (local tcp "localhost:4555"))');
      expect(profile).not.toContain("network-outbound");
      expect(profile).not.toContain('(subpath (param "PROJECT_ROOT"))');
      expect(profile).toContain('(deny process-exec (literal "/bin/sh"))');
      expect(profile).toContain('(deny process-exec (literal "/usr/bin/open"))');
      expect(profile).toContain('(deny process-exec (literal "/usr/bin/osascript"))');
      expect(profile).toContain('(subpath (param "PROJECT_WRITE_VITE_CACHE"))');
      expect(profile).toContain('(subpath (param "PROJECT_WRITE_NEXT"))');
      expect(profile).toContain('(subpath (param "PROJECT_WRITE_NEXT_ENV"))');
      expect(profile).not.toContain("(remote tcp))");
      expect(
        sandboxed.args.some(
          (arg) => arg.startsWith("PROJECT_WRITE_VITE_CACHE=") && arg.endsWith("node_modules/.vite")
        )
      ).toBe(true);
      expect(
        sandboxed.args.some((arg) => arg.startsWith("PROJECT_WRITE_NEXT=") && arg.endsWith(".next"))
      ).toBe(true);
      expect(
        sandboxed.args.some(
          (arg) => arg.startsWith("PROJECT_WRITE_NEXT_ENV=") && arg.endsWith("next-env.d.ts")
        )
      ).toBe(true);
      expect(sandboxed.env.HOME).toContain(".driftradar/sandbox/home");
      expect(sandboxed.env.TMPDIR).toContain(".driftradar/sandbox/tmp");
      expect(sandboxed.env.PATH?.split(delimiter)[0]).toBe(dirname(process.execPath));
      expect(sandboxed.env.OPENAI_API_KEY).toBeUndefined();
      expect(sandboxed.env.OPENSSL_CONF).toBe("/dev/null");
      expect(sandboxed.env.NODE_OPTIONS).toContain("--require=");
      expect(sandboxed.env.DRIFTRADAR_ALLOWED_HOST).toBe("127.0.0.1");
      expect(sandboxed.env.DRIFTRADAR_ALLOWED_PORT).toBe("4555");
      expect(sandboxed.env.HOST).toBe("127.0.0.1");
      expect(sandboxed.env.PORT).toBe("4555");
      expect(sandboxed.env.BROWSER).toBe("none");
      expect(sandboxed.env.NEXT_TELEMETRY_DISABLED).toBe("1");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not execute project-controlled package manager shims for install commands", async () => {
    const previousPath = process.env.PATH;
    const hasTrustedPnpm = previousPath
      ?.split(delimiter)
      .some((dir) => existsSync(join(dir, "pnpm")));
    if (process.platform !== "darwin" || !hasTrustedPnpm) {
      return;
    }
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-sandbox-test-"));
    try {
      const binDir = join(projectRoot, "node_modules", ".bin");
      await mkdir(binDir, { recursive: true });
      const shim = join(binDir, "pnpm");
      await writeFile(shim, "#!/bin/sh\nprintf 'project shim\\n'\n", "utf8");
      await chmod(shim, 0o755);
      process.env.PATH = `${binDir}${delimiter}${previousPath ?? ""}`;

      const sandboxed = await sandboxProjectCommand(
        projectRoot,
        { command: "pnpm", args: ["install", "--ignore-scripts", "--ignore-pnpmfile"] },
        "install"
      );

      expect(sandboxed.args).not.toContain(shim);
      expect(sandboxed.env.PATH?.split(delimiter)).not.toContain(binDir);
    } finally {
      process.env.PATH = previousPath;
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("allows trusted package-manager shebang shims in install sandboxes", async () => {
    const hasTrustedPnpm = process.env.PATH?.split(delimiter).some((dir) =>
      existsSync(join(dir, "pnpm"))
    );
    if (process.platform !== "darwin" || !hasTrustedPnpm) {
      return;
    }
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-sandbox-test-"));
    try {
      const sandboxed = await sandboxProjectCommand(
        projectRoot,
        { command: "pnpm", args: ["--version"] },
        "install"
      );

      const stdout = await execFileWithEnv(
        sandboxed.command,
        sandboxed.args,
        sandboxed.env,
        projectRoot
      );

      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("launches the validated dev-server package bin directly for run commands", async () => {
    const hasPnpm = process.env.PATH?.split(delimiter).some((dir) => existsSync(join(dir, "pnpm")));
    if (process.platform !== "darwin" || !hasPnpm) {
      return;
    }
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-sandbox-test-"));
    try {
      await writeFile(
        join(projectRoot, "package.json"),
        JSON.stringify({ scripts: { dev: "vite" } }),
        "utf8"
      );
      await mkdir(join(projectRoot, "node_modules", "vite", "bin"), { recursive: true });
      await writeFile(
        join(projectRoot, "node_modules", "vite", "package.json"),
        JSON.stringify({ bin: { vite: "bin/vite.js" } }),
        "utf8"
      );
      await writeFile(join(projectRoot, "node_modules", "vite", "bin", "vite.js"), "", "utf8");
      const scripts = new Map([["dev", "vite"]]);
      const command = parseProjectCommand("pnpm run dev -- --host 127.0.0.1 --port 4555", {
        scripts
      });
      expect(command).toBeDefined();

      const sandboxed = await sandboxProjectRunCommand(
        projectRoot,
        projectRoot,
        command!,
        { scripts, expectedHost: "127.0.0.1", expectedPort: "4555" },
        "http://127.0.0.1:4555"
      );

      expect(sandboxed.args).toContain(process.execPath);
      expect(sandboxed.args.some((arg) => arg.endsWith("node_modules/vite/bin/vite.js"))).toBe(
        true
      );
      expect(sandboxed.args).not.toContain("pnpm");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("uses nested runtime write paths and safe ancestor dev-server bins", async () => {
    if (process.platform !== "darwin") {
      return;
    }
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-sandbox-test-"));
    const runtimeRoot = join(projectRoot, "docs");
    try {
      await mkdir(join(projectRoot, "node_modules", "vite", "bin"), { recursive: true });
      await mkdir(runtimeRoot, { recursive: true });
      await writeFile(
        join(projectRoot, "node_modules", "vite", "package.json"),
        JSON.stringify({ bin: { vite: "bin/vite.js" } }),
        "utf8"
      );
      await writeFile(join(projectRoot, "node_modules", "vite", "bin", "vite.js"), "", "utf8");
      const scripts = new Map([["dev", "vite"]]);
      const command = parseProjectCommand("pnpm run dev -- --host 127.0.0.1 --port 4555", {
        scripts
      });
      expect(command).toBeDefined();

      const sandboxed = await sandboxProjectRunCommand(
        projectRoot,
        runtimeRoot,
        command!,
        { scripts, expectedHost: "127.0.0.1", expectedPort: "4555" },
        "http://127.0.0.1:4555"
      );

      expect(sandboxed.args.some((arg) => arg.endsWith("node_modules/vite/bin/vite.js"))).toBe(
        true
      );
      const viteWritePath = sandboxed.args.find((arg) =>
        arg.startsWith("PROJECT_WRITE_VITE_CACHE=")
      );
      expect(viteWritePath).toBeDefined();
      expect(viteWritePath).toMatch(/\/docs\/node_modules\/\.vite$/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("allows sandboxed run commands to read projects under the user home", async () => {
    const hasPnpm = process.env.PATH?.split(delimiter).some((dir) => existsSync(join(dir, "pnpm")));
    if (process.platform !== "darwin" || !hasPnpm || !process.env.HOME) {
      return;
    }
    const projectRoot = await mkdtemp(join(process.env.HOME, ".driftradar-sandbox-test-"));
    try {
      await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "inside-home" }));
      const sandboxed = await sandboxProjectCommand(
        projectRoot,
        {
          command: "node",
          args: [
            "-e",
            `console.log(require("node:fs").readFileSync("package.json", "utf8").includes("inside-home"))`
          ]
        },
        "run",
        "http://127.0.0.1:4555"
      );
      const stdout = await execFileWithEnv(
        sandboxed.command,
        sandboxed.args,
        sandboxed.env,
        projectRoot
      );

      expect(stdout.trim()).toBe("true");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("preloads a guard that rejects non-loopback server listens", async () => {
    const hasPnpm = process.env.PATH?.split(delimiter).some((dir) => existsSync(join(dir, "pnpm")));
    if (process.platform !== "darwin" || !hasPnpm) {
      return;
    }
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-sandbox-test-"));
    const port = await freeLoopbackPort();
    try {
      const command = parseProjectCommand(`pnpm run dev -- --host 127.0.0.1 --port ${port}`, {
        scripts: new Set(["dev"])
      });
      expect(command).toBeDefined();

      const sandboxed = await sandboxProjectCommand(
        projectRoot,
        command!,
        "run",
        `http://127.0.0.1:${port}`
      );
      const stdout = await execNodeWithEnv(
        [
          "-e",
          `const net = require("node:net");
for (const check of [
  () => net.createServer().listen(${port}, "0.0.0.0"),
  () => net.createServer().listen("/tmp/driftradar.sock")
]) {
  try {
    check();
    console.log("allowed");
  } catch (error) {
    console.log(String(error.message).includes("DriftRadar blocked project server listen"));
  }
}`
        ],
        sandboxed.env
      );

      expect(stdout.trim().split("\n")).toEqual(["true", "true"]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("preloads a guard that rejects outbound TCP and shell-style child processes", async () => {
    const hasPnpm = process.env.PATH?.split(delimiter).some((dir) => existsSync(join(dir, "pnpm")));
    if (process.platform !== "darwin" || !hasPnpm) {
      return;
    }
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-sandbox-test-"));
    const port = await freeLoopbackPort();
    try {
      const projectBin = join(projectRoot, "node_modules", ".bin");
      await mkdir(projectBin, { recursive: true });
      const shellShim = join(projectBin, "evil");
      await writeFile(shellShim, "#!/bin/sh\ntrue\n", "utf8");
      await chmod(shellShim, 0o755);
      const command = parseProjectCommand(`pnpm run dev -- --host 127.0.0.1 --port ${port}`, {
        scripts: new Set(["dev"])
      });
      expect(command).toBeDefined();

      const sandboxed = await sandboxProjectCommand(
        projectRoot,
        command!,
        "run",
        `http://127.0.0.1:${port}`
      );
      const stdout = await execNodeWithEnv(
        [
          "-e",
          `const net = require("node:net");
const childProcess = require("node:child_process");
const dgram = require("node:dgram");
const allowed = childProcess.spawnSync(process.execPath, [
  "-e",
  "console.log(process.env.NODE_OPTIONS.includes('network-guard.cjs'))"
], { env: {} });
console.log(allowed.status === 0 && allowed.stdout.toString().trim() === "true");
for (const check of [
  () => net.connect(${port}, "127.0.0.1"),
  () => childProcess.exec("true"),
  () => childProcess.spawnSync("sh", ["-c", "true"]),
  () => childProcess.spawnSync("env", ["sh", "-c", "true"]),
  () => childProcess.spawnSync("open", ["https://example.test"]),
  () => childProcess.spawnSync("osascript", ["-e", "return 1"]),
  () => childProcess.spawnSync("./node_modules/.bin/evil", []),
  () => {
    const raw = new childProcess.ChildProcess();
    raw.spawn({ file: "sh", args: ["sh", "-c", "true"], stdio: ["ignore", "ignore", "ignore"] });
  },
  () => dgram.createSocket("udp4").bind("/tmp/driftradar.sock")
]) {
  try {
    check();
    console.log("allowed");
  } catch (error) {
    console.log(String(error.message).startsWith("DriftRadar blocked project"));
  }
}
const previousNodeOptions = process.env.NODE_OPTIONS;
process.env.NODE_OPTIONS = "";
const child = childProcess.spawnSync(process.execPath, [
  "-e",
  "const cp=require('node:child_process'); try { cp.spawnSync('sh', ['-c', 'true']); console.log('allowed'); } catch (error) { console.log(String(error.message).startsWith('DriftRadar blocked project')); }"
], { encoding: "utf8" });
process.env.NODE_OPTIONS = previousNodeOptions;
console.log(child.status === 0 && child.stdout.trim() === "true");
new Promise((resolve) => {
  const raw = new childProcess.ChildProcess();
  raw.spawn({
    file: process.execPath,
    args: [process.execPath, "-e", "console.log(process.env.NODE_OPTIONS.includes('network-guard.cjs'))"],
    envPairs: ["PATH=" + process.env.PATH],
    stdio: ["ignore", "pipe", "ignore"]
  });
  let out = "";
  raw.stdout.on("data", (chunk) => { out += chunk; });
  raw.on("exit", () => {
    console.log(out.trim() === "true");
    resolve();
  });
});`
        ],
        sandboxed.env,
        projectRoot
      );

      expect(stdout.trim().split("\n")).toEqual([
        "true",
        "true",
        "true",
        "true",
        "true",
        "true",
        "true",
        "true",
        "true",
        "true",
        "true",
        "true"
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("project token validation", () => {
  it("drops invalid extra token files when Codex selected at least one usable token file", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-token-test-"));
    try {
      const validTokenFile = join(projectRoot, "tokens.css");
      const invalidTokenFile = join(projectRoot, "syntax-theme.json");
      await writeFile(validTokenFile, ":root { --color-primary: #000; }", "utf8");
      await writeFile(
        invalidTokenFile,
        JSON.stringify({ name: "syntax-theme", semanticHighlighting: true }),
        "utf8"
      );
      const config = {
        tokenFiles: [validTokenFile, invalidTokenFile]
      } as DriftRadarConfig;

      await expect(validateProjectTokens(config)).resolves.toBeUndefined();

      expect(config.tokenFiles).toEqual([validTokenFile]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed extra token files instead of silently pruning them", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-token-test-"));
    try {
      const validTokenFile = join(projectRoot, "tokens.css");
      const invalidTokenFile = join(projectRoot, "bad.json");
      await writeFile(validTokenFile, ":root { --color-primary: #000; }", "utf8");
      await writeFile(
        invalidTokenFile,
        JSON.stringify({ bad: { $type: "color", $value: "not-a-color" } }),
        "utf8"
      );
      const config = {
        tokenFiles: [validTokenFile, invalidTokenFile]
      } as DriftRadarConfig;

      await expect(validateProjectTokens(config)).rejects.toThrow(/selected token files/);

      expect(config.tokenFiles).toEqual([validTokenFile, invalidTokenFile]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects partially valid token files instead of silently pruning them", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-token-test-"));
    try {
      const validTokenFile = join(projectRoot, "tokens.css");
      const mixedTokenFile = join(projectRoot, "mixed.css");
      await writeFile(validTokenFile, ":root { --color-primary: #000; }", "utf8");
      await writeFile(
        mixedTokenFile,
        ":root { --color-secondary: #111; --space-bad: nope; }",
        "utf8"
      );
      const config = {
        tokenFiles: [validTokenFile, mixedTokenFile]
      } as DriftRadarConfig;

      await expect(validateProjectTokens(config)).rejects.toThrow(/selected token files/);

      expect(config.tokenFiles).toEqual([validTokenFile, mixedTokenFile]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("keeps cross-file token aliases when dropping invalid extra token files", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-token-test-"));
    try {
      const baseTokenFile = join(projectRoot, "base.css");
      const semanticTokenFile = join(projectRoot, "semantic.css");
      const invalidTokenFile = join(projectRoot, "syntax-theme.json");
      await writeFile(baseTokenFile, ":root { --blue-500: #0000ff; }", "utf8");
      await writeFile(semanticTokenFile, ":root { --color-primary: var(--blue-500); }", "utf8");
      await writeFile(
        invalidTokenFile,
        JSON.stringify({ name: "syntax-theme", semanticHighlighting: true }),
        "utf8"
      );
      const config = {
        tokenFiles: [baseTokenFile, semanticTokenFile, invalidTokenFile]
      } as DriftRadarConfig;

      await expect(validateProjectTokens(config)).resolves.toBeUndefined();

      expect(config.tokenFiles).toEqual([baseTokenFile, semanticTokenFile]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("project origin preflight", () => {
  it("drops unreachable Codex-selected routes when at least one route is reachable", () => {
    const config = {
      routes: [
        { id: "home", url: "/" },
        { id: "missing", url: "/missing" },
        { id: "settings", url: "/settings" }
      ]
    } as DriftRadarConfig;

    expect(retainReachableRoutes(config, [true, false, true])).toBe(2);

    expect(config.routes.map((route) => route.id)).toEqual(["home", "settings"]);
  });

  it("rejects occupied loopback ports before startup", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200).end("already here");
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = (server.address() as AddressInfo).port;

    try {
      await expect(ensureBaseOriginFree(`http://127.0.0.1:${port}`)).rejects.toThrow(
        /already serving/
      );
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("rejects localhost when the port is occupied on IPv4 loopback", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200).end("already here");
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = (server.address() as AddressInfo).port;

    try {
      await expect(ensureBaseOriginFree(`http://localhost:${port}`)).rejects.toThrow(
        /already serving/
      );
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });
});

describe("static project fallback", () => {
  it("only falls back to index.html for HTML-like routes", () => {
    expect(shouldUseStaticIndexFallback("/")).toBe(true);
    expect(shouldUseStaticIndexFallback("/settings")).toBe(true);
    expect(shouldUseStaticIndexFallback("/settings/")).toBe(true);
    expect(shouldUseStaticIndexFallback("/styles.css")).toBe(false);
    expect(shouldUseStaticIndexFallback("/assets/app.js")).toBe(false);
  });
});

async function freeLoopbackPort(): Promise<number> {
  const server = createServer((_request, response) => {
    response.writeHead(204).end();
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

async function execNodeWithEnv(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string
): Promise<string> {
  return execFileWithEnv(process.execPath, args, env, cwd);
}

async function execFileWithEnv(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string
): Promise<string> {
  return new Promise((resolveExec, rejectExec) => {
    execFile(command, args, { cwd, env }, (error, stdout, stderr) => {
      if (error) {
        rejectExec(new Error(`${error.message}\n${stderr}`));
        return;
      }
      resolveExec(stdout);
    });
  });
}
