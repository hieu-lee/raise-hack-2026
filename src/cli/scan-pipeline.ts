import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type Server, type ServerResponse } from "node:http";
import { createServer as createTcpServer, isIP } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { captureDesignSurface } from "../capture/browser-capture.js";
import { analyzeObservations } from "../analyze/observations.js";
import { classifyDrift } from "../classify/drift-classifier.js";
import { validateConfigFile } from "../config/load-config.js";
import { attachRepoFixes, enrichScanWithAi, isAiEnabled } from "../ai/enrich-scan.js";
import {
  createProjectRuntimePlan,
  projectRuntimeRoot,
  resolveProjectPathInside,
  type ProjectSetup
} from "../ai/project-setup.js";
import type { DriftIssue, DriftRadarConfig, DriftReport } from "../contracts/types.js";
import { renderPrComments } from "../export/pr-comments.js";
import { buildReport } from "../report/report-builder.js";
import { configSummaryFromConfig, writeRunArtifacts } from "../storage/run-storage.js";
import { ingestTokenFiles } from "../tokens/ingest-tokens.js";
import { TokenIngestionError } from "../tokens/ingest-tokens.js";
import { scanConfig as runDemoScan } from "./demo-runtime.js";

const projectServerErrors = new WeakMap<ChildProcess, Error>();
type ProjectServerHandle =
  { kind: "process"; child: ChildProcess } | { kind: "static"; server: Server };
type ProjectCommand = { command: string; args: string[] };
type ProjectCommandNetworkMode = "install" | "run";

const forbiddenPackageSubcommands = new Set([
  "add",
  "config",
  "create",
  "dlx",
  "exec",
  "init",
  "link",
  "login",
  "publish",
  "remove",
  "rm",
  "unlink",
  "x"
]);
const packageManagerCommands = new Set(["npm", "pnpm", "yarn", "bun"]);
const knownDevServerSubcommands = new Map<string, Set<string | undefined>>([
  ["astro", new Set(["dev", "preview", undefined])],
  ["ng", new Set(["serve"])],
  ["next", new Set(["dev", "start"])],
  ["nuxt", new Set(["dev", "preview", undefined])],
  ["parcel", new Set([undefined])],
  ["storybook", new Set(["dev", undefined])],
  ["vite", new Set(["dev", "preview", "serve", undefined])],
  ["webpack", new Set(["serve"])]
]);
const flagFirstDevServers = new Set(["astro", "ng", "nuxt", "parcel", "storybook", "vite"]);
const devServerPackages = new Map<string, string[]>([
  ["astro", ["astro"]],
  ["ng", ["@angular/cli"]],
  ["next", ["next"]],
  ["nuxt", ["nuxt"]],
  ["parcel", ["parcel"]],
  ["storybook", ["storybook"]],
  ["vite", ["vite"]],
  ["webpack", ["webpack", "webpack-cli"]]
]);
const projectRunWritePaths = [
  { key: "ANGULAR_CACHE", path: ".angular/cache" },
  { key: "ASTRO", path: ".astro" },
  { key: "NEXT", path: ".next" },
  { key: "NEXT_ENV", path: "next-env.d.ts" },
  { key: "NUXT", path: ".nuxt" },
  { key: "PARCEL_CACHE", path: ".parcel-cache" },
  { key: "NODE_CACHE", path: "node_modules/.cache" },
  { key: "VITE_CACHE", path: "node_modules/.vite" },
  { key: "VITE_TEMP", path: "node_modules/.vite-temp" }
] as const;
const blockedHostProcessExecutables = [
  "/bin/bash",
  "/bin/csh",
  "/bin/dash",
  "/bin/ksh",
  "/bin/sh",
  "/bin/tcsh",
  "/bin/zsh",
  "/usr/bin/env",
  "/usr/bin/open",
  "/usr/bin/osascript"
];
const scriptValueFlags = new Set([
  "-H",
  "--address",
  "--bind",
  "--host",
  "--hostname",
  "--listen",
  "--port"
]);

export async function scanConfig(configPath: string): Promise<string> {
  const config = await validateConfigFile(configPath);

  return config.captureMode === "real"
    ? runRealScan(configPath, config)
    : runDemoScanWithEnrichment(configPath, config);
}

export async function scanProject(projectPath: string): Promise<string> {
  const projectRoot = resolve(projectPath);
  let server: ProjectServerHandle | undefined;
  try {
    const { setup, config } = await createProjectRuntimePlan(projectRoot);
    const runtimeRoot =
      setup.runtime.type === "package-script"
        ? projectRuntimeRoot(projectRoot, setup)
        : projectRoot;
    validateProjectCommands(runtimeRoot, setup, config.baseUrl);
    await validateProjectTokens(config);
    assertCompatiblePackageManager(projectRoot, runtimeRoot, setup);

    console.log(`Codex setup: ${setup.projectName || projectRoot}`);
    if (setup.runtime.type === "static-site") {
      console.log(`Static root: ${setup.runtime.staticRoot ?? "."}`);
    } else {
      console.log(`Run command: ${setup.runCommand}`);
    }
    if (setup.testCommands.length > 0) {
      console.log(`Suggested tests: ${setup.testCommands.join(" && ")}`);
    }

    await ensureBaseOriginFree(config.baseUrl);
    await runInstallIfNeeded(projectRoot, runtimeRoot, setup);
    server = await startProjectServer(projectRoot, runtimeRoot, setup, config.baseUrl);
    await waitForRoutes(config, server);
    return await runRealScan(`codex:${projectRoot}`, config, {
      commandArgs: ["scan", "--project", projectRoot],
      projectRoot,
      requireCapturedPages: true
    });
  } catch (error) {
    throw unsupportedProjectError(error);
  } finally {
    if (server) {
      stopProjectServer(server);
    }
  }
}

export function assertCompatiblePackageManager(
  projectRoot: string,
  runtimeRoot: string,
  setup: ProjectSetup
): void {
  if (setup.runtime.type !== "package-script") {
    return;
  }
  if (!packageManagerCommands.has(setup.packageManager)) {
    throw new Error(
      "DriftRadar cannot work with this project: package-script runtime requires a concrete package manager."
    );
  }
  const packageRoots = packageManagerSearchRoots(projectRoot, runtimeRoot);
  const packageManagerSpec = packageRoots
    .map((root) => packageManagerSpecFromPackage(root))
    .find((spec): spec is string => Boolean(spec));
  const expectedSpec = parsePackageManagerSpec(packageManagerSpec);
  if (packageManagerSpec && !expectedSpec) {
    throw new Error(
      `DriftRadar cannot work with this project: unsupported packageManager spec ${packageManagerSpec}.`
    );
  }
  if (expectedSpec?.manager && expectedSpec.manager !== setup.packageManager) {
    throw new Error(
      `DriftRadar cannot work with this project: packageManager requires ${packageManagerSpec}, but Codex selected ${setup.packageManager}.`
    );
  }
  const lockfileManagers = packageRoots
    .map((root) => packageManagerFromLockfiles(root))
    .filter((manager): manager is string | "ambiguous" => Boolean(manager));
  if (lockfileManagers.includes("ambiguous")) {
    throw new Error(
      "DriftRadar cannot work with this project: multiple package-manager lockfiles are present."
    );
  }
  const lockfileManagerMatches = new Set(lockfileManagers);
  if (lockfileManagerMatches.size > 1) {
    throw new Error(
      "DriftRadar cannot work with this project: multiple package-manager lockfiles are present."
    );
  }
  const lockfileManager = [...lockfileManagerMatches][0];
  if (lockfileManager && lockfileManager !== setup.packageManager) {
    throw new Error(
      `DriftRadar cannot work with this project: package lockfile requires ${lockfileManager}, but Codex selected ${setup.packageManager}.`
    );
  }
  const manager = setup.packageManager;
  const actualVersion = localPackageManagerVersion(projectRoot, runtimeRoot, manager);
  if (!actualVersion) {
    throw new Error(
      `DriftRadar cannot work with this project: required package manager is not available (${manager}).`
    );
  }
  const expectedVersion = expectedSpec?.exactVersion;
  const expectedMajor = expectedSpec?.major;
  const actualMajor = actualVersion.match(/^(\d+)(?:\.\d+)?(?:\.\d+)?/)?.[1];
  if (expectedVersion && isExactVersion(expectedVersion) && actualVersion !== expectedVersion) {
    throw new Error(
      `DriftRadar cannot work with this project: packageManager requires ${packageManagerSpec}, but DriftRadar found ${manager}@${actualVersion}.`
    );
  }
  if (actualMajor && expectedMajor && actualMajor !== expectedMajor) {
    throw new Error(
      `DriftRadar cannot work with this project: packageManager requires ${packageManagerSpec}, but DriftRadar found ${manager}@${actualVersion}.`
    );
  }
  const engineVersion =
    packageManagerEngineFromPackage(runtimeRoot, manager) ??
    packageManagerEngineFromPackage(projectRoot, manager);
  if (engineVersion && isExactVersion(engineVersion) && actualVersion !== engineVersion) {
    throw new Error(
      `DriftRadar cannot work with this project: package engines require ${manager}@${engineVersion}, but DriftRadar found ${manager}@${actualVersion}.`
    );
  }
}

function packageManagerSearchRoots(projectRoot: string, runtimeRoot: string): string[] {
  const realProjectRoot = realpathSync(projectRoot);
  const roots: string[] = [];
  let current = realpathSync(runtimeRoot);
  while (true) {
    roots.push(current);
    if (current === realProjectRoot) {
      return roots;
    }
    const relativeCurrent = relative(realProjectRoot, current);
    if (relativeCurrent.startsWith("..") || isAbsolute(relativeCurrent)) {
      return roots;
    }
    const parent = dirname(current);
    if (parent === current) {
      return roots;
    }
    current = parent;
  }
}

function packageManagerFromLockfiles(projectRoot: string): string | "ambiguous" | undefined {
  const matches = new Set<string>();
  const lockfiles = [
    { manager: "npm", files: ["package-lock.json", "npm-shrinkwrap.json"] },
    { manager: "pnpm", files: ["pnpm-lock.yaml"] },
    { manager: "yarn", files: ["yarn.lock"] },
    { manager: "bun", files: ["bun.lock", "bun.lockb"] }
  ];
  for (const entry of lockfiles) {
    if (entry.files.some((file) => existsSync(join(projectRoot, file)))) {
      matches.add(entry.manager);
    }
  }
  if (matches.size > 1) {
    return "ambiguous";
  }
  return [...matches][0];
}

function packageManagerSpecFromPackage(projectRoot: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      packageManager?: unknown;
    };
    return typeof raw.packageManager === "string" ? raw.packageManager : undefined;
  } catch {
    return undefined;
  }
}

function parsePackageManagerSpec(
  spec: string | undefined
): { manager: string; exactVersion?: string; major?: string } | undefined {
  if (!spec) {
    return undefined;
  }
  const match = spec.match(/^(npm|pnpm|yarn|bun)@(.+)$/);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const version = match[2].split("+")[0] ?? match[2];
  const exactVersion = isExactVersion(version) ? version : undefined;
  const major = version.match(/^(\d+)(?:\.|$)/)?.[1];
  return { manager: match[1], exactVersion, major };
}

function packageManagerEngineFromPackage(projectRoot: string, manager: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      engines?: Record<string, unknown>;
    };
    const engine = raw.engines?.[manager];
    return typeof engine === "string" ? engine : undefined;
  } catch {
    return undefined;
  }
}

function isExactVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

export function localPackageManagerVersion(
  projectRoot: string,
  runtimeRoot: string,
  manager: string
): string | undefined {
  const executable = trustedPackageManagerExecutable(projectRoot, runtimeRoot, manager);
  if (!executable) {
    return undefined;
  }
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    env: packageManagerVersionEnv()
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function trustedPackageManagerExecutable(
  projectRoot: string,
  runtimeRoot: string,
  manager: string
): string | undefined {
  const roots = [projectRoot, runtimeRoot].map((root) => realpathSync(root));
  const searchPaths = trustedCommandPath().split(delimiter).filter(Boolean);
  const seen = new Set<string>();
  for (const searchPath of searchPaths) {
    const absoluteSearchPath = resolve(searchPath);
    if (seen.has(absoluteSearchPath) || pathInsideAny(absoluteSearchPath, roots)) {
      continue;
    }
    seen.add(absoluteSearchPath);
    const realSearchPath = safeRealpathSync(absoluteSearchPath);
    if (realSearchPath && pathInsideAny(realSearchPath, roots)) {
      continue;
    }
    const candidate = resolve(absoluteSearchPath, manager);
    if (!existsSync(candidate)) {
      continue;
    }
    const realCandidate = safeRealpathSync(candidate);
    if (!realCandidate || pathInsideAny(realCandidate, roots)) {
      continue;
    }
    return realCandidate;
  }
  return undefined;
}

function packageManagerVersionEnv(): NodeJS.ProcessEnv {
  return {
    COREPACK_ENABLE_PROJECT_SPEC: "0",
    HOME: tmpdir(),
    NPM_CONFIG_USERCONFIG: "/dev/null",
    NO_COLOR: "1",
    PATH: [dirname(process.execPath), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
      .filter(Boolean)
      .join(delimiter),
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    npm_config_userconfig: "/dev/null"
  };
}

function safeRealpathSync(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function pathInsideAny(path: string, roots: string[]): boolean {
  return roots.some((root) => {
    const relativePath = relative(root, path);
    return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
  });
}

async function runDemoScanWithEnrichment(
  configPath: string,
  config: DriftRadarConfig
): Promise<string> {
  const reportPath = await runDemoScan(configPath);
  const runDir = dirname(reportPath);
  const raw = JSON.parse(await readFile(reportPath, "utf8")) as DriftReport;

  const issues = await enrichIssues(config, raw.issues, runDir, raw.pages ?? []);
  if (JSON.stringify(issues) === JSON.stringify(raw.issues)) {
    return reportPath;
  }

  const report = buildReport({
    runId: raw.runId,
    projectName: raw.projectName,
    createdAt: raw.createdAt,
    configSummary: raw.configSummary,
    tokens: await readTokens(runDir),
    pages: raw.pages ?? [],
    issues
  });

  await writeReportArtifacts(reportPath, runDir, report);
  logAiSummary(config, report);
  return reportPath;
}

async function runRealScan(
  configPath: string,
  config: DriftRadarConfig,
  options: {
    commandArgs?: string[];
    projectRoot?: string;
    requireCapturedPages?: boolean;
  } = {}
): Promise<string> {
  const tokens = await ingestTokenFiles(config.tokenFiles);
  const runId = `real-${new Date().toISOString().replace(/\D/g, "").slice(0, 17)}-${randomUUID().slice(0, 8)}`;
  const runDir = resolve(config.outputDir, "runs", runId);
  const allowedOrigin = options.requireCapturedPages ? new URL(config.baseUrl).origin : undefined;

  const capture = await captureDesignSurface(config, { runId, runDir, allowedOrigin });
  for (const warning of capture.warnings) {
    console.warn(`Scan warning [${warning.routeId}]: ${warning.message}`);
  }
  if (options.requireCapturedPages && capture.pages.length === 0) {
    throw new Error(
      "DriftRadar cannot work with this project: no configured UI routes could be captured."
    );
  }
  if (options.requireCapturedPages && capture.pages.length < expectedPageCount(config)) {
    throw new Error(
      "DriftRadar cannot work with this project: not all configured UI routes could be captured."
    );
  }

  const analysis = analyzeObservations(capture.observations, tokens, config.thresholds);
  let issues = classifyDrift(analysis, {
    screenshotPath: (observation) =>
      `screenshots/${observation.record.routeId}/${observation.record.viewport}/${observation.record.state}.png`
  });

  issues = await enrichIssues(config, issues, runDir, capture.pages, {
    projectRoot: options.projectRoot
  });

  const report = await writeRunArtifacts({
    outputDir: config.outputDir,
    runId,
    projectName: config.projectName,
    configSummary: configSummaryFromConfig(config),
    tokens,
    pages: capture.pages,
    observations: capture.observations,
    issues,
    commandArgs: options.commandArgs ?? ["scan", "--config", configPath],
    status: "complete"
  });

  await writeFile(join(runDir, "pr-comments.md"), renderPrComments(report));
  logAiSummary(config, report);
  return join(runDir, "report.json");
}

async function enrichIssues(
  config: DriftRadarConfig,
  issues: DriftIssue[],
  runDir: string,
  pages: Array<{ routeId: string; viewport: string; state: string; screenshotPath: string }>,
  options: { projectRoot?: string } = {}
): Promise<DriftIssue[]> {
  const withRepoFixes = await attachRepoFixes(config, issues, {
    projectRoot: options.projectRoot
  });
  if (!isAiEnabled(config)) {
    return withRepoFixes;
  }

  return enrichScanWithAi(config, withRepoFixes, {
    runDir,
    pages: pages.map((page) => ({
      routeId: page.routeId,
      viewport: page.viewport,
      state: page.state,
      screenshotPath: page.screenshotPath
    }))
  });
}

async function writeReportArtifacts(
  reportPath: string,
  runDir: string,
  report: DriftReport
): Promise<void> {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(runDir, "issues.json"), `${JSON.stringify(report.issues, null, 2)}\n`);
  await writeFile(join(runDir, "pr-comments.md"), renderPrComments(report));
}

function logAiSummary(config: DriftRadarConfig, report: DriftReport): void {
  if (isAiEnabled(config)) {
    const enrichedCount = report.issues.filter((issue) => issue.aiEnriched).length;
    console.log(
      `AI enrichment applied: ${report.issues.length} issues (${enrichedCount} AI-enriched)`
    );
  }
}

async function readTokens(runDir: string) {
  const { tokensSchema } = await import("../contracts/schemas.js");
  return tokensSchema.parse(JSON.parse(await readFile(join(runDir, "tokens.json"), "utf8")));
}

async function runInstallIfNeeded(
  projectRoot: string,
  runtimeRoot: string,
  setup: ProjectSetup
): Promise<void> {
  if (setup.runtime.type === "static-site") {
    return;
  }
  if (!setup.installCommand) {
    return;
  }
  if (projectDependenciesInstalled(projectRoot, runtimeRoot, setup.packageManager)) {
    return;
  }

  const installCommand = runtimeScopedCommand(setup.installCommand, setup);
  console.log(`Install command: ${installCommand}`);
  await runProjectCommand(projectRoot, runtimeRoot, installCommand, "install");
}

export function projectDependenciesInstalled(
  projectRoot: string,
  runtimeRoot: string,
  packageManager: string
): boolean {
  if (!packageManagerCommands.has(packageManager)) {
    return false;
  }
  const [runtimePackageRoot, ...ancestorPackageRoots] = packageManagerSearchRoots(
    projectRoot,
    runtimeRoot
  );
  if (runtimePackageRoot && existsSync(join(runtimePackageRoot, "node_modules"))) {
    return true;
  }
  if (packageManager === "pnpm") {
    return false;
  }
  const realRuntimeRoot = realpathSync(runtimeRoot);
  return ancestorPackageRoots.some(
    (root) =>
      existsSync(join(root, "node_modules")) && packageWorkspaceIncludes(root, realRuntimeRoot)
  );
}

function packageWorkspaceIncludes(packageRoot: string, runtimeRoot: string): boolean {
  let raw: { workspaces?: unknown } = {};
  try {
    raw = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      workspaces?: unknown;
    };
  } catch {
    // pnpm workspaces may be declared only in pnpm-workspace.yaml.
  }
  const workspaces = [
    ...(Array.isArray(raw.workspaces)
      ? raw.workspaces
      : isRecord(raw.workspaces) && Array.isArray(raw.workspaces.packages)
        ? raw.workspaces.packages
        : []),
    ...pnpmWorkspacePackages(packageRoot)
  ];
  const relativeRuntime = relative(packageRoot, runtimeRoot);
  const patterns = workspaces.filter(
    (workspace): workspace is string => typeof workspace === "string"
  );
  return (
    patterns.some(
      (pattern) => !pattern.startsWith("!") && workspacePatternMatches(pattern, relativeRuntime)
    ) &&
    !patterns.some(
      (pattern) =>
        pattern.startsWith("!") && workspacePatternMatches(pattern.slice(1), relativeRuntime)
    )
  );
}

function pnpmWorkspacePackages(packageRoot: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(join(packageRoot, "pnpm-workspace.yaml"), "utf8");
  } catch {
    return [];
  }
  const packages: string[] = [];
  let inPackages = false;
  for (const line of raw.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inPackages = line.trim() === "packages:";
      continue;
    }
    if (!inPackages) {
      continue;
    }
    const match = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
    if (match?.[1]) {
      packages.push(match[1]);
    }
  }
  return packages;
}

function workspacePatternMatches(pattern: string, relativeRuntime: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedRuntime = relativeRuntime.replace(/\\/g, "/");
  if (normalizedPattern === normalizedRuntime) {
    return true;
  }
  if (normalizedPattern.endsWith("/*")) {
    const prefix = normalizedPattern.slice(0, -2);
    const rest = normalizedRuntime.slice(prefix.length + 1);
    return normalizedRuntime.startsWith(`${prefix}/`) && rest.length > 0 && !rest.includes("/");
  }
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedRuntime === prefix || normalizedRuntime.startsWith(`${prefix}/`);
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateProjectCommands(
  projectRoot: string,
  setup: ProjectSetup,
  baseUrl: string
): void {
  if (setup.runtime.type === "static-site") {
    if (setup.runCommand || setup.installCommand) {
      throw new Error("DriftRadar cannot work with this project: unsupported static setup.");
    }
    resolveProjectPathInside(projectRoot, setup.runtime.staticRoot ?? ".");
    return;
  }

  if (setup.runtime.type !== "package-script") {
    throw new Error("DriftRadar cannot work with this project: unsupported project runtime.");
  }
  if (!packageManagerCommands.has(setup.packageManager)) {
    throw new Error(
      "DriftRadar cannot work with this project: package-script runtime requires a concrete package manager."
    );
  }

  const installCommand = setup.installCommand
    ? runtimeScopedCommand(setup.installCommand, setup)
    : undefined;
  const parsedInstallCommand = installCommand
    ? parseProjectCommand(installCommand, { kind: "install" })
    : undefined;
  if (installCommand && !parsedInstallCommand) {
    throw new Error("DriftRadar cannot work with this project: unsupported install command.");
  }
  const expectedPackageManager = setup.packageManager;
  if (parsedInstallCommand && parsedInstallCommand.command !== expectedPackageManager) {
    throw new Error(
      `DriftRadar cannot work with this project: install command must use ${expectedPackageManager}.`
    );
  }
  const normalizedRunCommand = setup.runCommand
    ? runtimeScopedCommand(setup.runCommand, setup)
    : undefined;
  const runCommand =
    normalizedRunCommand &&
    parseProjectCommand(normalizedRunCommand, {
      kind: "run",
      scripts: packageScripts(projectRoot, baseUrl)
    });
  const parsedBaseUrl = new URL(baseUrl);
  if (!runCommand) {
    throw new Error("DriftRadar cannot work with this project: unsupported run command.");
  }
  if (expectedPackageManager && runCommand.command !== expectedPackageManager) {
    throw new Error(
      `DriftRadar cannot work with this project: run command must use ${expectedPackageManager}.`
    );
  }
  if (
    commandPort(runCommand.args) !== parsedBaseUrl.port ||
    normalizeHost(commandHost(runCommand.args) ?? "") !== normalizeHost(parsedBaseUrl.hostname)
  ) {
    throw new Error("DriftRadar cannot work with this project: unsupported run command.");
  }
}

function runtimeScopedCommand(command: string, setup: ProjectSetup): string {
  const workingDirectory = setup.runtime.workingDirectory;
  if (!workingDirectory || workingDirectory === ".") {
    return command;
  }

  const parts = splitCommand(command);
  const [executable, maybeDirFlag, maybeDirValue, ...rest] = parts;
  if (!executable || !maybeDirFlag) {
    return command;
  }

  const inlineDir = maybeDirFlag.match(/^(--dir=|-C)(.+)$/);
  if (
    inlineDir?.[2] &&
    normalizeRuntimeDirectory(inlineDir[2]) === normalizeRuntimeDirectory(workingDirectory)
  ) {
    return [executable, maybeDirValue, ...rest].filter(Boolean).join(" ");
  }

  if (!maybeDirValue || rest.length === 0) {
    return command;
  }

  if (
    (maybeDirFlag === "--dir" || maybeDirFlag === "-C") &&
    normalizeRuntimeDirectory(maybeDirValue) === normalizeRuntimeDirectory(workingDirectory)
  ) {
    return [executable, ...rest].join(" ");
  }

  return command;
}

function normalizeRuntimeDirectory(path: string | undefined): string | undefined {
  return path?.replace(/^\.\//, "").replace(/\/$/, "");
}

async function startProjectServer(
  projectRoot: string,
  runtimeRoot: string,
  setup: ProjectSetup,
  baseUrl: string
): Promise<ProjectServerHandle> {
  if (setup.runtime.type === "static-site") {
    return startStaticProjectServer(projectRoot, setup, baseUrl);
  }

  if (!setup.runCommand) {
    throw new Error(
      "DriftRadar cannot work with this project: Codex did not provide a run command."
    );
  }

  const scripts = packageScripts(runtimeRoot, baseUrl);
  const command = parseProjectCommand(runtimeScopedCommand(setup.runCommand, setup), {
    kind: "run",
    scripts
  });
  if (!command) {
    throw new Error("DriftRadar cannot work with this project: unsupported run command.");
  }

  const sandboxedCommand = await sandboxProjectRunCommand(
    projectRoot,
    runtimeRoot,
    command,
    scripts,
    baseUrl
  );
  const child = spawn(sandboxedCommand.command, sandboxedCommand.args, {
    cwd: runtimeRoot,
    env: sandboxedCommand.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout?.on("data", (data) => process.stdout.write(data));
  child.stderr?.on("data", (data) => process.stderr.write(data));
  child.once("error", (error) => projectServerErrors.set(child, error));
  return { kind: "process", child };
}

async function startStaticProjectServer(
  projectRoot: string,
  setup: ProjectSetup,
  baseUrl: string
): Promise<ProjectServerHandle> {
  const staticRoot = resolveProjectPathInside(projectRoot, setup.runtime.staticRoot ?? ".");
  const realStaticRoot = await realpath(staticRoot);
  const url = new URL(baseUrl);
  const port = Number(url.port);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      "DriftRadar cannot work with this project: static baseUrl must include a port."
    );
  }

  const host = loopbackHostname(url.hostname);
  const server = createServer((request, response) => {
    void serveStaticRequest(request.url ?? "/", realStaticRoot, response).catch(() => {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Internal static server error");
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  return { kind: "static", server };
}

async function serveStaticRequest(
  requestUrl: string,
  realStaticRoot: string,
  response: ServerResponse
): Promise<void> {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  const target = resolve(realStaticRoot, `.${pathname}`);
  const file = await staticFileForRequest(realStaticRoot, target, pathname);
  if (!file) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const body = await readFile(file);
  response.writeHead(200, { "content-type": contentType(file) });
  response.end(body);
}

async function staticFileForRequest(
  realStaticRoot: string,
  target: string,
  pathname: string
): Promise<string | undefined> {
  const file = await existingStaticFile(realStaticRoot, target);
  if (file) {
    return file;
  }
  if (!shouldUseStaticIndexFallback(pathname)) {
    return undefined;
  }
  return existingStaticFile(realStaticRoot, join(realStaticRoot, "index.html"));
}

export function shouldUseStaticIndexFallback(pathname: string): boolean {
  return pathname.endsWith("/") || extname(pathname) === "";
}

async function existingStaticFile(
  realStaticRoot: string,
  target: string
): Promise<string | undefined> {
  try {
    const stats = await stat(target);
    const file = stats.isDirectory() ? join(target, "index.html") : target;
    const realFile = await realpath(file);
    const relativePath = relative(realStaticRoot, realFile);
    if (relativePath.startsWith("..") || isAbsolute(relativePath) || !(await stat(file)).isFile()) {
      return undefined;
    }
    return file;
  } catch {
    return undefined;
  }
}

function contentType(file: string): string {
  const types: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8"
  };
  return types[extname(file).toLowerCase()] ?? "application/octet-stream";
}

function stopProjectServer(handle: ProjectServerHandle): void {
  if (handle.kind === "static") {
    handle.server.close();
    return;
  }

  const { child } = handle;
  if (child.exitCode === null && child.signalCode === null) {
    killProjectServer(child, "SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        killProjectServer(child, "SIGKILL");
      }
    }, 2000).unref();
  }
}

function killProjectServer(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to killing the direct child below.
    }
  }
  child.kill(signal);
}

function unsupportedProjectError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("DriftRadar cannot work with this project:")) {
    return error instanceof Error ? error : new Error(message);
  }
  return new Error(`DriftRadar cannot work with this project: ${message}`, {
    cause: error
  });
}

async function waitForRoutes(
  config: DriftRadarConfig,
  handle: ProjectServerHandle,
  timeoutMs = 180_000
): Promise<void> {
  const urls = config.routes.map((route) => new URL(route.url, config.baseUrl).toString());
  const allowedOrigin = new URL(config.baseUrl).origin;
  const started = Date.now();
  let bestResults: boolean[] = [];
  while (Date.now() - started < timeoutMs) {
    if (handle.kind === "process") {
      const { child } = handle;
      if (child.exitCode !== null) {
        throw new Error("Project UI command exited before routes were ready.");
      }
      if (child.signalCode !== null) {
        throw new Error(
          `Project UI command exited by ${child.signalCode} before routes were ready.`
        );
      }
      const spawnError = projectServerErrors.get(child);
      if (spawnError) {
        throw new Error(`DriftRadar cannot work with this project: ${spawnError.message}`);
      }
    }
    const results = await Promise.all(urls.map((url) => routeReady(url, allowedOrigin)));
    if (results.every(Boolean)) {
      return;
    }
    if (results.filter(Boolean).length > bestResults.filter(Boolean).length) {
      bestResults = results;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }

  const reachableRoutes = retainReachableRoutes(config, bestResults);
  if (reachableRoutes > 0) {
    console.warn(
      `Scan warning: ignored ${urls.length - reachableRoutes} Codex-selected route(s) that were not reachable.`
    );
    return;
  }

  throw new Error(
    "DriftRadar cannot work with this project: configured UI routes were not reachable."
  );
}

export function retainReachableRoutes(config: DriftRadarConfig, reachable: boolean[]): number {
  const routes = config.routes.filter((_, index) => reachable[index]);
  if (routes.length === 0 || routes.length === config.routes.length) {
    return routes.length;
  }
  config.routes.splice(0, config.routes.length, ...routes);
  return routes.length;
}

async function routeReady(url: string, allowedOrigin: string): Promise<boolean> {
  try {
    return await routeReadyWithRedirects(url, allowedOrigin);
  } catch {
    return false;
  }
}

async function routeReadyWithRedirects(
  url: string,
  allowedOrigin: string,
  remainingRedirects = 5
): Promise<boolean> {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000)
  });
  const responseUrl = new URL(response.url);
  if (responseUrl.origin !== allowedOrigin) {
    return false;
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location || remainingRedirects <= 0) {
      return false;
    }
    const nextUrl = new URL(location, responseUrl).toString();
    if (new URL(nextUrl).origin !== allowedOrigin) {
      return false;
    }
    return routeReadyWithRedirects(nextUrl, allowedOrigin, remainingRedirects - 1);
  }
  return response.ok;
}

async function runProjectCommand(
  projectRoot: string,
  cwd: string,
  rawCommand: string,
  kind: "install" | "run",
  timeoutMs = 120_000
): Promise<void> {
  const command = parseProjectCommand(rawCommand, {
    kind,
    scripts: packageScripts(cwd)
  });
  if (!command) {
    throw new Error("DriftRadar cannot work with this project: unsupported install command.");
  }

  const sandboxedCommand = await sandboxProjectCommand(projectRoot, command, "install");
  await new Promise<void>((resolveCommand, rejectCommand) => {
    const child = spawn(sandboxedCommand.command, sandboxedCommand.args, {
      cwd,
      env: sandboxedCommand.env,
      stdio: "inherit"
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 2000).unref();
      rejectCommand(new Error(`Command timed out: ${rawCommand}`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectCommand(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolveCommand();
      } else {
        rejectCommand(new Error(`Command failed (${code ?? 1}): ${rawCommand}`));
      }
    });
  });
}

export async function ensureBaseOriginFree(baseUrl: string): Promise<void> {
  const url = new URL(baseUrl);
  const port = Number(url.port);
  if (!Number.isInteger(port) || port <= 0) {
    throw unsupportedProjectError(
      new Error(`base URL must include an explicit local port (${baseUrl})`)
    );
  }
  const hosts = loopbackProbeHosts(url.hostname);
  for (const host of hosts) {
    await probeTcpPortFree(port, host, baseUrl);
  }
}

function loopbackProbeHosts(hostname: string): string[] {
  const host = loopbackHostname(hostname);
  return host === "localhost" ? ["127.0.0.1", "::1"] : [host];
}

async function probeTcpPortFree(port: number, host: string, baseUrl: string): Promise<void> {
  await new Promise<void>((resolveProbe, rejectProbe) => {
    const probe = createTcpServer();
    const cleanup = () => {
      probe.removeAllListeners();
    };
    probe.once("error", (error: NodeJS.ErrnoException) => {
      cleanup();
      if (error.code === "EADDRINUSE") {
        rejectProbe(
          unsupportedProjectError(
            new Error(`base URL is already serving before project startup (${baseUrl})`)
          )
        );
        return;
      }
      if (host === "::1" && error.code === "EADDRNOTAVAIL") {
        resolveProbe();
        return;
      }
      rejectProbe(unsupportedProjectError(error));
    });
    probe.once("listening", () => {
      probe.close((error) => {
        cleanup();
        if (error) {
          rejectProbe(unsupportedProjectError(error));
          return;
        }
        resolveProbe();
      });
    });
    probe.listen(port, host);
  });
}

export function parseProjectCommand(
  command: string,
  options: { kind?: "install" | "run"; scripts?: ProjectScripts } = {}
): ProjectCommand | undefined {
  if (/[;&|`$<>]/.test(command)) {
    return undefined;
  }

  const parts = splitCommand(command);
  const executable = parts[0];
  if (!executable || !packageManagerCommands.has(executable)) {
    return undefined;
  }

  if (options.kind === "install") {
    return parseInstallCommand(parts);
  }

  if (!parseRunCommand(parts, options.scripts ?? new Set())) {
    return undefined;
  }

  return { command: executable, args: parts.slice(1) };
}

function parseInstallCommand(parts: string[]): { command: string; args: string[] } | undefined {
  const [executable, subcommand, ...rest] = parts;
  const valid =
    (executable === "npm" && (subcommand === "install" || subcommand === "ci")) ||
    (packageManagerCommands.has(executable ?? "") && subcommand === "install");
  return valid && safeInstallArgs(rest)
    ? { command: executable, args: withSafeInstallFlags(executable, parts.slice(1)) }
    : undefined;
}

type ProjectScriptMap = Map<string, string>;
type ProjectScripts =
  | ProjectScriptMap
  | Set<string>
  | {
      expectedHost?: string;
      expectedPort?: string;
      projectRoot?: string;
      scripts: ProjectScriptMap;
    };

function parseRunCommand(parts: string[], scripts: ProjectScripts): boolean {
  const [executable, subcommand, maybeScript, ...rest] = parts;
  if (!executable || parts.length < 2) {
    return false;
  }
  if (subcommand && forbiddenPackageSubcommands.has(subcommand)) {
    return false;
  }

  if (executable === "npm") {
    if (subcommand === "start") {
      return safePackageScript(scripts, "start") && safeNpmRunArgs(parts.slice(2));
    }
    return (
      subcommand === "run" &&
      safeScriptName(maybeScript) &&
      safePackageScript(scripts, maybeScript) &&
      safeNpmRunArgs(rest)
    );
  }

  if (subcommand === "run") {
    return (
      safeScriptName(maybeScript) &&
      safePackageScript(scripts, maybeScript) &&
      safePackageRunArgs(rest)
    );
  }

  return false;
}

function safePackageScript(scripts: ProjectScripts, scriptName: string): boolean {
  const scriptMap =
    scripts instanceof Map ? scripts : scripts instanceof Set ? undefined : scripts.scripts;
  const expectedHost =
    scripts instanceof Map || scripts instanceof Set ? undefined : scripts.expectedHost;
  const expectedPort =
    scripts instanceof Map || scripts instanceof Set ? undefined : scripts.expectedPort;
  const projectRoot =
    scripts instanceof Map || scripts instanceof Set ? undefined : scripts.projectRoot;
  if (scriptMap) {
    const body = scriptMap.get(scriptName);
    const preBody = scriptMap.get(`pre${scriptName}`);
    const postBody = scriptMap.get(`post${scriptName}`);
    return (
      typeof body === "string" &&
      safePackageScriptBody(body, expectedHost, expectedPort, projectRoot) &&
      (preBody === undefined ||
        safePackageScriptBody(preBody, expectedHost, expectedPort, projectRoot)) &&
      (postBody === undefined ||
        safePackageScriptBody(postBody, expectedHost, expectedPort, projectRoot))
    );
  }
  return scripts instanceof Set && scripts.has(scriptName);
}

function safeScriptName(script: string | undefined): script is string {
  if (!script) {
    return false;
  }
  return !script.startsWith("-") && safeCommandRest([script]);
}

function safeCommandRest(args: string[]): boolean {
  const forbidden = new Set([
    "--cwd",
    "--dir",
    "--filter",
    "--filter-prod",
    "--global",
    "--prefix",
    "--recursive",
    "--workspace",
    "--workspace-root",
    "--workspaces",
    "--ws",
    "-C",
    "-F",
    "-g",
    "-r",
    "-w"
  ]);
  return args.every(
    (arg) =>
      !arg.includes("..") &&
      ![...forbidden].some(
        (flag) =>
          arg === flag ||
          arg.startsWith(`${flag}=`) ||
          (flag.startsWith("-") && !flag.startsWith("--") && arg.startsWith(flag))
      )
  );
}

function safeInstallArgs(args: string[]): boolean {
  const allowedFlags = new Set([
    "--check-cache",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--ignore-pnpmfile",
    "--immutable",
    "--immutable-cache",
    "--legacy-peer-deps",
    "--no-audit",
    "--no-fund",
    "--no-scripts",
    "--offline"
  ]);
  return args.every((arg) => allowedFlags.has(arg) && safeCommandRest([arg]));
}

function safeNpmRunArgs(args: string[]): boolean {
  return args[0] === "--" && safeRunArgs(args.slice(1));
}

function safePackageRunArgs(args: string[]): boolean {
  return safeRunArgs(args[0] === "--" ? args.slice(1) : args);
}

function commandPort(args: string[]): string | undefined {
  const passthroughIndex = args.indexOf("--");
  const candidates = passthroughIndex >= 0 ? args.slice(passthroughIndex + 1) : args;
  for (let index = 0; index < candidates.length; index += 1) {
    const arg = candidates[index] ?? "";
    const { flag, inlineValue } = splitInlineFlag(arg);
    if (flag === "--port" && inlineValue !== undefined) {
      return inlineValue;
    }
    if (arg === "--port") {
      return candidates[index + 1];
    }
  }
  return undefined;
}

function commandHost(args: string[]): string | undefined {
  const passthroughIndex = args.indexOf("--");
  const candidates = passthroughIndex >= 0 ? args.slice(passthroughIndex + 1) : args;
  for (let index = 0; index < candidates.length; index += 1) {
    const arg = candidates[index] ?? "";
    const { flag, inlineValue } = splitInlineFlag(arg);
    if ((flag === "--host" || flag === "--hostname") && inlineValue !== undefined) {
      return inlineValue;
    }
    if (arg === "--host" || arg === "--hostname") {
      return candidates[index + 1];
    }
  }
  return undefined;
}

function safeRunArgs(passthrough: string[]): boolean {
  const valueFlags = new Set(["--host", "--hostname", "--port"]);
  const booleanFlags = new Set(["--strictPort"]);
  let hasLoopbackHost = false;
  let hasPort = false;
  for (let index = 0; index < passthrough.length; index += 1) {
    const arg = passthrough[index] ?? "";
    if (!safeCommandRest([arg])) {
      return false;
    }
    const { flag, inlineValue } = splitInlineFlag(arg);
    if (booleanFlags.has(arg)) {
      continue;
    }
    if (valueFlags.has(flag) && inlineValue !== undefined) {
      if (!safeRunFlagValue(flag, inlineValue)) {
        return false;
      }
      if (flag === "--host" || flag === "--hostname") {
        if (hasLoopbackHost) {
          return false;
        }
        hasLoopbackHost = true;
      }
      if (flag === "--port") {
        if (hasPort) {
          return false;
        }
        hasPort = true;
      }
      continue;
    }
    if (valueFlags.has(arg)) {
      const value = passthrough[index + 1];
      if (!safeRunFlagValue(arg, value)) {
        return false;
      }
      if (arg === "--host" || arg === "--hostname") {
        if (hasLoopbackHost) {
          return false;
        }
        hasLoopbackHost = true;
      }
      if (arg === "--port") {
        if (hasPort) {
          return false;
        }
        hasPort = true;
      }
      index += 1;
      continue;
    }
    return false;
  }
  return hasLoopbackHost && hasPort;
}

function safePackageScriptBody(
  body: string,
  expectedHost?: string,
  expectedPort?: string,
  projectRoot?: string
): boolean {
  if (/[;&|`$<>\r\n]/.test(body)) {
    return false;
  }

  const parts = splitCommand(body);
  if (parts.some((part) => /\s/.test(part))) {
    return false;
  }
  if (parts.some((part) => forbiddenScriptExecutable(part))) {
    return false;
  }
  if (!safeKnownDevServer(parts, projectRoot)) {
    return false;
  }
  for (let index = 0; index < parts.length; index += 1) {
    const arg = parts[index] ?? "";
    const safeParcelEntryPoint = isParcelEntryPoint(parts, index, projectRoot);
    if (
      !safeCommandRest([arg]) ||
      unsafeScriptLaunchFlag(arg) ||
      unsafeScriptPathFlag(arg) ||
      (!safeParcelEntryPoint && unsafeScriptPathToken(arg))
    ) {
      return false;
    }
    if (isNonLoopbackIpLiteral(arg)) {
      return false;
    }
    if (/^-H.+/.test(arg) || /^-p=?\d+/.test(arg)) {
      return false;
    }
    const { flag, inlineValue } = splitInlineFlag(arg);
    if (isBindHostFlag(flag) && inlineValue !== undefined) {
      if (!compatibleScriptHost(inlineValue, expectedHost)) {
        return false;
      }
      continue;
    }
    if (flag === "--port" && inlineValue !== undefined) {
      if (!compatibleScriptPort(inlineValue, expectedPort)) {
        return false;
      }
      continue;
    }
    if (inlineValue !== undefined && isNonLoopbackHostValue(inlineValue)) {
      return false;
    }
    if (isBindHostFlag(arg)) {
      const value = parts[index + 1];
      if (!compatibleScriptHost(value, expectedHost)) {
        return false;
      }
      index += 1;
      continue;
    }
    if (arg === "--port") {
      const value = parts[index + 1];
      if (!compatibleScriptPort(value, expectedPort)) {
        return false;
      }
      index += 1;
      continue;
    }
    const envValue = hostEnvironmentValue(arg);
    if (envValue !== undefined && !isLoopbackHost(envValue)) {
      return false;
    }
    if (isUnexpectedScriptPositional(parts, index, projectRoot)) {
      return false;
    }
  }
  return true;
}

function compatibleScriptHost(
  value: string | undefined,
  expectedHost: string | undefined
): boolean {
  if (!isLoopbackHost(value)) {
    return false;
  }
  return expectedHost ? normalizeHost(value) === normalizeHost(expectedHost) : true;
}

function compatibleScriptPort(
  value: string | undefined,
  expectedPort: string | undefined
): boolean {
  if (!safeRunFlagValue("--port", value)) {
    return false;
  }
  return expectedPort ? value === expectedPort : true;
}

function unsafeScriptPathFlag(arg: string): boolean {
  const pathFlags = new Set([
    "-c",
    "--cert",
    "--config",
    "--config-name",
    "--cwd",
    "--dir",
    "--https-key",
    "--key",
    "--out-dir",
    "--prefix",
    "--root",
    "--ssl-cert",
    "--ssl-key"
  ]);
  const { flag } = splitInlineFlag(arg);
  return (
    pathFlags.has(flag) ||
    [...pathFlags].some(
      (pathFlag) =>
        pathFlag.length === 2 && arg.startsWith(pathFlag) && arg.length > pathFlag.length
    )
  );
}

function unsafeScriptLaunchFlag(arg: string): boolean {
  const { flag } = splitInlineFlag(arg);
  return flag === "--open" || flag === "-o" || arg.startsWith("-o");
}

function unsafeScriptPathToken(arg: string): boolean {
  return /[\\/]/.test(arg);
}

function isParcelEntryPoint(parts: string[], index: number, projectRoot?: string): boolean {
  const executable = scriptExecutable(parts[0] ?? "");
  const arg = parts[index] ?? "";
  if (executable !== "parcel" || index !== 1 || !safeRelativeEntrypoint(arg)) {
    return false;
  }
  if (!projectRoot) {
    return true;
  }
  try {
    resolveProjectPathInside(projectRoot, arg);
    return true;
  } catch {
    return false;
  }
}

function safeRelativeEntrypoint(path: string): boolean {
  return (
    Boolean(path) &&
    !path.startsWith("-") &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    !path.split("/").includes("..") &&
    /^[A-Za-z0-9._/-]+$/.test(path) &&
    /\.(?:html?|[cm]?[jt]sx?)$/i.test(path)
  );
}

function isUnexpectedScriptPositional(
  parts: string[],
  index: number,
  projectRoot?: string
): boolean {
  const arg = parts[index] ?? "";
  if (index === 0 || arg.startsWith("-") || arg.includes("=")) {
    return false;
  }
  const previousFlag = splitInlineFlag(parts[index - 1] ?? "").flag;
  if (scriptValueFlags.has(previousFlag)) {
    return false;
  }
  const executable = scriptExecutable(parts[0] ?? "");
  if (isParcelEntryPoint(parts, index, projectRoot)) {
    return false;
  }
  return !(index === 1 && knownDevServerSubcommands.get(executable ?? "")?.has(arg));
}

function safeKnownDevServer(parts: string[], projectRoot?: string): boolean {
  const executable = scriptExecutable(parts[0] ?? "");
  if (!executable) {
    return false;
  }
  const nextArg = parts[1];
  if (executable === "parcel" && nextArg && !nextArg.startsWith("-")) {
    return isParcelEntryPoint(parts, 1, projectRoot);
  }
  if (nextArg?.startsWith("-")) {
    return flagFirstDevServers.has(executable);
  }

  return knownDevServerSubcommands.get(executable)?.has(nextArg) ?? false;
}

function forbiddenScriptExecutable(part: string): boolean {
  const executable = scriptExecutable(part);
  if (!executable) {
    return false;
  }
  return [
    "bash",
    "bun",
    "bunx",
    "cmd",
    "fish",
    "npm",
    "npx",
    "pnpx",
    "pnpm",
    "powershell",
    "pwsh",
    "sh",
    "tsx",
    "yarn",
    "zsh"
  ].includes(executable);
}

function scriptExecutable(part: string): string | undefined {
  return part.toLowerCase().split(/[\\/]/).pop();
}

function splitInlineFlag(arg: string): { flag: string; inlineValue: string | undefined } {
  const equals = arg.indexOf("=");
  return equals === -1
    ? { flag: arg, inlineValue: undefined }
    : { flag: arg.slice(0, equals), inlineValue: arg.slice(equals + 1) };
}

function safeRunFlagValue(flag: string, value: string | undefined): value is string {
  if (!safeRunValue(value)) {
    return false;
  }
  if (flag === "--host" || flag === "--hostname") {
    return isLoopbackHost(value);
  }
  if (flag === "--port") {
    const port = Number(value);
    return Number.isInteger(port) && port > 0 && port <= 65535;
  }
  return false;
}

function safeRunValue(value: string | undefined): value is string {
  return value ? /^[A-Za-z0-9.:-]+$/.test(value) : false;
}

function loopbackHostname(value: string): string {
  const host = normalizeHost(value);
  if (!isLoopbackHost(host)) {
    throw new Error("DriftRadar cannot work with this project: static baseUrl must be local.");
  }
  return host;
}

function isLoopbackHost(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  const host = normalizeHost(value);
  const ipVersion = isIP(host);
  return host === "localhost" || (ipVersion === 4 && host.startsWith("127.")) || host === "::1";
}

function normalizeHost(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/g, "");
}

function hostEnvironmentValue(arg: string): string | undefined {
  const match = arg.match(/^(?:HOST|HOSTNAME|VITE_HOST|NEXT_HOSTNAME)=(.+)$/);
  return match?.[1];
}

function isNonLoopbackIpLiteral(arg: string): boolean {
  const host = normalizeHostLikeValue(arg);
  return isIP(host) > 0 && !isLoopbackHost(host);
}

function normalizeHostLikeValue(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.hostname) {
      return normalizeHost(parsed.hostname);
    }
  } catch {
    // Fall through to host:port and non-special protocol parsing.
  }
  const protocolHost = value.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/(\[[^\]]+\]|[^/:]+)(?::\d+)?/);
  if (protocolHost?.[1]) {
    return normalizeHost(protocolHost[1]);
  }
  const bracketed = value.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed?.[1]) {
    return normalizeHost(bracketed[1]);
  }
  const hostPort = value.match(/^([^:]+):\d+$/);
  if (hostPort?.[1]) {
    return normalizeHost(hostPort[1]);
  }
  return normalizeHost(value);
}

function isNonLoopbackHostValue(value: string): boolean {
  try {
    const parsed = new URL(value);
    return !isLoopbackHost(parsed.hostname);
  } catch {
    return isNonLoopbackIpLiteral(value);
  }
}

function isBindHostFlag(flag: string): boolean {
  return ["-H", "--address", "--bind", "--host", "--hostname", "--listen"].includes(flag);
}

function withSafeInstallFlags(executable: string, args: string[]): string[] {
  const safeArgs = args.some((arg) => arg === "--ignore-scripts")
    ? [...args]
    : [...args, "--ignore-scripts"];
  if (executable === "pnpm" && !safeArgs.some((arg) => arg === "--ignore-pnpmfile")) {
    safeArgs.push("--ignore-pnpmfile");
  }
  return safeArgs;
}

function expectedPageCount(config: DriftRadarConfig): number {
  return config.routes.length * config.viewports.length * config.states.length;
}

export async function validateProjectTokens(config: DriftRadarConfig): Promise<void> {
  try {
    await Promise.all(config.tokenFiles.map((tokenFile) => readFile(tokenFile, "utf8")));
    await ingestTokenFiles(config.tokenFiles);
    return;
  } catch (error) {
    const invalid = invalidTokenFilesFromError(error, config.tokenFiles);
    const valid = config.tokenFiles.filter((tokenFile) => !invalid.includes(tokenFile));
    if (invalid.length === 0 || valid.length === 0) {
      throw unsupportedProjectError(new Error(tokenValidationMessage(error)));
    }
    config.tokenFiles.splice(0, config.tokenFiles.length, ...valid);
    console.warn(
      `Scan warning: ignored ${invalid.length} token file(s) Codex selected but DriftRadar could not parse: ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? ", ..." : ""}`
    );
    try {
      await ingestTokenFiles(config.tokenFiles);
    } catch (combinedError) {
      throw unsupportedProjectError(new Error(tokenValidationMessage(combinedError)));
    }
  }
}

function invalidTokenFilesFromError(error: unknown, paths: string[]): string[] {
  if (!(error instanceof TokenIngestionError)) {
    return [];
  }
  return paths.filter((path) => error.issues.some((issue) => prunableTokenFileIssue(issue, path)));
}

function prunableTokenFileIssue(issue: string, path: string): boolean {
  const prefix = `${path}: `;
  if (!issue.startsWith(prefix)) {
    return false;
  }
  const detail = issue.slice(prefix.length);
  return (
    detail === "no tokens found" ||
    detail === "No recognizable tokens found" ||
    detail === "expected a JSON token object" ||
    detail === "token names must not be empty" ||
    detail.startsWith("invalid JSON ")
  );
}

function tokenValidationMessage(error: unknown): string {
  if (error instanceof TokenIngestionError) {
    const sample = error.issues.slice(0, 5).join("; ");
    return `selected token files are not usable (${error.issues.length} issue(s)${sample ? `: ${sample}` : ""}${error.issues.length > 5 ? "; ..." : ""})`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 800 ? `${message.slice(0, 800)}...` : message;
}

interface SandboxedProjectCommand extends ProjectCommand {
  env: NodeJS.ProcessEnv;
}

export async function sandboxProjectRunCommand(
  projectRoot: string,
  commandRoot: string,
  command: ProjectCommand,
  scripts: ProjectScripts,
  baseUrl: string
): Promise<SandboxedProjectCommand> {
  return sandboxProjectCommand(
    projectRoot,
    await directProjectRunCommand(projectRoot, commandRoot, command, scripts),
    "run",
    baseUrl,
    commandRoot
  );
}

async function directProjectRunCommand(
  projectRoot: string,
  commandRoot: string,
  command: ProjectCommand,
  scripts: ProjectScripts
): Promise<ProjectCommand> {
  const scriptMap = projectScriptMap(scripts);
  const scriptName = packageRunScriptName(command);
  const body = scriptName ? scriptMap?.get(scriptName) : undefined;
  if (!body) {
    throw new Error("DriftRadar cannot work with this project: unsupported run command.");
  }

  const bodyParts = splitCommand(body);
  const executable = scriptExecutable(bodyParts[0] ?? "");
  if (!executable || !safeKnownDevServer(bodyParts, commandRoot)) {
    throw new Error("DriftRadar cannot work with this project: unsupported run command.");
  }

  const binPath = await resolveDevServerBin(projectRoot, commandRoot, executable);
  return {
    command: process.execPath,
    args: [binPath, ...bodyParts.slice(1), ...packageRunPassthroughArgs(command)]
  };
}

export async function sandboxProjectCommand(
  projectRoot: string,
  command: ProjectCommand,
  networkMode: ProjectCommandNetworkMode,
  baseUrl?: string,
  commandRoot: string = projectRoot
): Promise<SandboxedProjectCommand> {
  if (!projectSandboxAvailable()) {
    throw new Error(
      "DriftRadar cannot work with this project: package-script runtime requires the macOS sandbox-exec runtime sandbox."
    );
  }

  const realProjectRoot = await realpath(projectRoot);
  const sandboxRoot = join(projectRoot, ".driftradar", "sandbox");
  const sandboxHome = join(sandboxRoot, "home");
  const sandboxTmp = join(sandboxRoot, "tmp");
  const sandboxCache = join(sandboxRoot, "cache");
  await Promise.all([
    mkdir(sandboxHome, { recursive: true }),
    mkdir(sandboxTmp, { recursive: true }),
    mkdir(sandboxCache, { recursive: true })
  ]);

  const [realSandboxHome, realSandboxTmp, realSandboxCache] = await Promise.all([
    realpath(sandboxHome),
    realpath(sandboxTmp),
    realpath(sandboxCache)
  ]);
  const env = projectCommandEnv({
    home: realSandboxHome,
    tmp: realSandboxTmp,
    cache: realSandboxCache
  });
  let runPort: string | undefined;
  if (networkMode === "run") {
    if (!baseUrl) {
      throw new Error(
        "DriftRadar cannot work with this project: package-script runtime requires a local base URL."
      );
    }
    const parsedBaseUrl = new URL(baseUrl);
    runPort = parsedBaseUrl.port;
    const guardPath = await writeProjectNetworkGuard(projectRoot);
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : ""}--require=${quoteNodeOptionsValue(guardPath)}`;
    env.DRIFTRADAR_ALLOWED_HOST = parsedBaseUrl.hostname;
    env.DRIFTRADAR_ALLOWED_PORT = parsedBaseUrl.port;
    env.HOST = parsedBaseUrl.hostname;
    env.PORT = parsedBaseUrl.port;
    env.BROWSER = "none";
    env.ASTRO_TELEMETRY_DISABLED = "1";
    env.NEXT_TELEMETRY_DISABLED = "1";
  }
  const nodeExecutable = await realpath(process.execPath);
  const realCommandRoot = await realpath(commandRoot);
  const relativeCommandRoot = relative(realProjectRoot, realCommandRoot);
  if (relativeCommandRoot.startsWith("..") || isAbsolute(relativeCommandRoot)) {
    throw new Error(
      "DriftRadar cannot work with this project: runtime root is outside the project."
    );
  }
  const resolvedCommand = await resolveProjectCommandExecutable(
    projectRoot,
    realCommandRoot,
    command.command,
    env.PATH
  );
  const executable = await realpath(resolvedCommand.command);
  const runWriteRoot = networkMode === "run" ? realCommandRoot : realProjectRoot;
  const readRoots = [
    realProjectRoot,
    realSandboxHome,
    realSandboxTmp,
    realSandboxCache,
    ...toolchainReadRoots([
      executable,
      nodeExecutable,
      ...resolvedCommand.args.filter((arg) => isAbsolute(arg))
    ])
  ];
  const userHome = process.env.HOME ? await realpath(process.env.HOME).catch(() => "") : "";
  const hostDenyRoots = sensitiveHostHomeRoots(userHome);
  const args = [
    "-p",
    projectSandboxProfile(networkMode, readRoots, hostDenyRoots, runPort),
    "-D",
    `PROJECT_ROOT=${realProjectRoot}`,
    ...projectRunWritePaths.flatMap((entry) => [
      "-D",
      `PROJECT_WRITE_${entry.key}=${join(runWriteRoot, entry.path)}`
    ]),
    "-D",
    `SANDBOX_HOME=${realSandboxHome}`,
    "-D",
    `SANDBOX_TMP=${realSandboxTmp}`,
    "-D",
    `SANDBOX_CACHE=${realSandboxCache}`,
    executable,
    ...resolvedCommand.args,
    ...command.args
  ];
  return { command: "/usr/bin/sandbox-exec", args, env };
}

function packageRunScriptName(command: ProjectCommand): string | undefined {
  const [subcommand, maybeScript] = command.args;
  if (command.command === "npm" && subcommand === "start") {
    return "start";
  }
  return subcommand === "run" ? maybeScript : undefined;
}

function packageRunPassthroughArgs(command: ProjectCommand): string[] {
  const [, , maybeSeparator, ...rest] = command.args;
  const passthrough =
    command.command === "npm" && command.args[0] === "start"
      ? command.args.slice(1)
      : [maybeSeparator, ...rest].filter((arg): arg is string => typeof arg === "string");
  return passthrough[0] === "--" ? passthrough.slice(1) : passthrough;
}

function projectScriptMap(scripts: ProjectScripts): ProjectScriptMap | undefined {
  if (scripts instanceof Map) {
    return scripts;
  }
  return scripts instanceof Set ? undefined : scripts.scripts;
}

async function resolveDevServerBin(
  projectRoot: string,
  commandRoot: string,
  executable: string
): Promise<string> {
  const realProjectRoot = await realpath(projectRoot);
  const searchRoots = await devServerSearchRoots(realProjectRoot, commandRoot);
  for (const packageName of devServerPackages.get(executable) ?? [executable]) {
    for (const root of searchRoots) {
      const packageRoot = join(root, "node_modules", ...packageName.split("/"));
      let packageJson: { bin?: string | Record<string, string> };
      try {
        packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
          bin?: string | Record<string, string>;
        };
      } catch {
        continue;
      }
      const bin = packageBin(packageJson.bin, executable);
      if (!bin) {
        continue;
      }
      const binPath = await realpath(resolve(packageRoot, bin));
      const relativeBinPath = relative(realProjectRoot, binPath);
      if (relativeBinPath.startsWith("..") || isAbsolute(relativeBinPath)) {
        throw new Error(
          "DriftRadar cannot work with this project: dev-server bin points outside the project."
        );
      }
      return binPath;
    }
  }
  throw new Error(
    `DriftRadar cannot work with this project: dev-server package is not installed (${executable}).`
  );
}

async function devServerSearchRoots(
  realProjectRoot: string,
  commandRoot: string
): Promise<string[]> {
  const roots: string[] = [];
  let current = await realpath(commandRoot);
  const relativeCommandRoot = relative(realProjectRoot, current);
  if (relativeCommandRoot.startsWith("..") || isAbsolute(relativeCommandRoot)) {
    throw new Error(
      "DriftRadar cannot work with this project: runtime root is outside the project."
    );
  }

  while (true) {
    roots.push(current);
    if (current === realProjectRoot) {
      return roots;
    }
    const parent = dirname(current);
    if (parent === current) {
      return roots;
    }
    current = parent;
  }
}

function packageBin(
  bin: string | Record<string, string> | undefined,
  executable: string
): string | undefined {
  if (typeof bin === "string") {
    return bin;
  }
  return bin?.[executable] ?? Object.values(bin ?? {})[0];
}

function projectSandboxAvailable(): boolean {
  return process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
}

function sensitiveHostHomeRoots(userHome: string): string[] {
  if (!userHome) {
    return [];
  }
  return [
    ".aws",
    ".azure",
    ".config/gcloud",
    ".docker",
    ".gnupg",
    ".kube",
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".ssh",
    ".yarnrc",
    ".yarnrc.yml"
  ].map((entry) => join(userHome, entry));
}

function projectCommandEnv(paths: { home: string; tmp: string; cache: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  env.PATH = trustedCommandPath();
  env.HOME = paths.home;
  env.TMPDIR = paths.tmp.endsWith("/") ? paths.tmp : `${paths.tmp}/`;
  env.TEMP = paths.tmp;
  env.TMP = paths.tmp;
  env.USER = "driftradar";
  env.CI = process.env.CI ?? "0";
  env.NO_COLOR = "1";
  env.OPENSSL_CONF = "/dev/null";
  env.npm_config_cache = join(paths.cache, "npm");
  env.npm_config_userconfig = join(paths.home, ".npmrc");
  env.PNPM_HOME = join(paths.cache, "pnpm-home");
  env.XDG_CACHE_HOME = paths.cache;
  env.YARN_CACHE_FOLDER = join(paths.cache, "yarn");
  env.COREPACK_HOME = join(paths.cache, "corepack");
  return env;
}

function trustedCommandPath(): string {
  const nodeBin = dirname(process.execPath);
  return [
    nodeBin,
    resolve(nodeBin, "..", "..", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin"
  ]
    .filter(Boolean)
    .join(delimiter);
}

async function resolveProjectCommandExecutable(
  projectRoot: string,
  commandRoot: string,
  command: string,
  pathValue: string | undefined
): Promise<ProjectCommand> {
  if (packageManagerCommands.has(command)) {
    const trustedExecutable = trustedPackageManagerExecutable(projectRoot, commandRoot, command);
    if (trustedExecutable) {
      return trustedPackageManagerInvocation(command, trustedExecutable);
    }
    throw new Error(
      `DriftRadar cannot work with this project: required package manager is not available (${command}).`
    );
  }
  return { command: await resolveExecutable(command, pathValue), args: [] };
}

function trustedPackageManagerInvocation(manager: string, executable: string): ProjectCommand {
  const entrypoint = trustedPackageManagerNodeEntrypoint(manager, executable);
  return entrypoint
    ? { command: process.execPath, args: [entrypoint] }
    : { command: executable, args: [] };
}

function trustedPackageManagerNodeEntrypoint(
  manager: string,
  executable: string
): string | undefined {
  const executableDir = dirname(executable);
  const nodeBin = dirname(process.execPath);
  const candidates =
    manager === "pnpm"
      ? [
          resolve(executableDir, "../node/node_modules/pnpm/bin/pnpm.mjs"),
          resolve(nodeBin, "../node_modules/pnpm/bin/pnpm.mjs")
        ]
      : manager === "npm"
        ? [
            resolve(nodeBin, "../lib/node_modules/npm/bin/npm-cli.js"),
            resolve(nodeBin, "../node_modules/npm/bin/npm-cli.js")
          ]
        : [];
  for (const candidate of candidates) {
    const realCandidate = safeRealpathSync(candidate);
    if (realCandidate) {
      return realCandidate;
    }
  }
  return undefined;
}

async function resolveExecutable(command: string, pathValue: string | undefined): Promise<string> {
  const searchPaths = (pathValue ?? "").split(delimiter).filter(Boolean);
  for (const searchPath of searchPaths) {
    const candidate = resolve(searchPath, command);
    if (!existsSync(candidate)) {
      continue;
    }
    return realpath(candidate);
  }
  throw new Error(
    `DriftRadar cannot work with this project: required executable is not available (${command}).`
  );
}

export function toolchainReadRoots(paths: string[]): string[] {
  const roots = new Set<string>();
  for (const path of paths) {
    for (const root of directToolchainReadRoots(path)) {
      roots.add(root);
    }
    for (const root of dynamicLibraryReadRoots(path)) {
      roots.add(root);
    }
  }
  return [...roots];
}

function directToolchainReadRoots(path: string): string[] {
  const nodeRuntimeRoot = path.match(/^(.*\/dependencies\/node)(?:\/|$)/);
  if (nodeRuntimeRoot?.[1]) {
    return [nodeRuntimeRoot[1]];
  }
  const nodeModulesRoot = path.match(/^(.*\/lib\/node_modules)(?:\/|$)/);
  if (nodeModulesRoot?.[1]) {
    return [dirname(nodeModulesRoot[1])];
  }
  const binaryDir = dirname(path);
  const installRoot = dirname(binaryDir);
  if (
    binaryDir.endsWith("/bin") &&
    existsSync(join(installRoot, "lib")) &&
    !isBroadToolchainPrefix(installRoot)
  ) {
    return [installRoot];
  }
  return [dirname(path)];
}

function isBroadToolchainPrefix(path: string): boolean {
  return path === "/opt/homebrew" || path === "/usr/local";
}

function dynamicLibraryReadRoots(path: string): string[] {
  if (process.platform !== "darwin" || !existsSync("/usr/bin/otool")) {
    return [];
  }
  let output: string;
  try {
    output = execFileSync("/usr/bin/otool", ["-L", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return [];
  }

  const roots = new Set<string>();
  for (const root of dynamicLibraryReadRootsFromOtool(output)) {
    roots.add(root);
    try {
      roots.add(realpathSync(root));
    } catch {
      // The sandbox still benefits from the literal library directory when the target is absent.
    }
  }
  return [...roots];
}

export function dynamicLibraryReadRootsFromOtool(output: string): string[] {
  const roots = new Set<string>();
  for (const line of output.split("\n").slice(1)) {
    const libraryPath = line.trim().split(/\s+\(/)[0];
    if (!libraryPath || !isAbsolute(libraryPath)) {
      continue;
    }
    if (
      libraryPath.startsWith("/usr/lib/") ||
      libraryPath.startsWith("/System/Library/") ||
      libraryPath.startsWith("/Library/Apple/")
    ) {
      continue;
    }
    roots.add(dirname(libraryPath));
  }
  return [...roots];
}

function projectSandboxProfile(
  networkMode: ProjectCommandNetworkMode,
  readRoots: string[],
  hostDenyRoots: string[] = [],
  runPort?: string
): string {
  const readRootRules = [...new Set(readRoots)]
    .map((root) => `  (subpath ${sandboxString(root)})`)
    .join("\n");
  const networkRules =
    networkMode === "install"
      ? `(allow network-outbound
  (literal "/private/var/run/mDNSResponder")
  (remote tcp))`
      : "";
  const inboundRule =
    networkMode === "run" && runPort
      ? `(allow network-inbound
  (local tcp "localhost:${runPort}"))`
      : `(allow network-inbound
  (local tcp "localhost:*"))`;
  const processRules =
    networkMode === "run"
      ? blockedHostProcessExecutables
          .map((path) => `(deny process-exec (literal ${sandboxString(path)}))`)
          .join("\n")
      : "";
  const projectWriteRules =
    networkMode === "install"
      ? `\n  (subpath (param "PROJECT_ROOT"))`
      : projectRunWritePaths
          .map((entry) => `\n  (subpath (param "PROJECT_WRITE_${entry.key}"))`)
          .join("");
  const hostDenyRules = hostDenyRoots
    .map((root) => `  (subpath ${sandboxString(root)})`)
    .join("\n");

  return `(version 1)
(import "system.sb")
(deny default)
(allow process*)
${processRules}
(allow sysctl-read)
(allow mach-lookup)
(allow mach-per-user-lookup)
${hostDenyRules ? `(deny file-read* file-write*\n${hostDenyRules}\n  (with no-log))` : ""}
(allow file-read-metadata)
(allow file-read*
  (literal "/dev/null")
  (literal "/dev/random")
  (literal "/dev/urandom")
  (subpath "/bin")
  (subpath "/usr/bin")
  (subpath "/usr/lib")
  (subpath "/usr/share")
  (subpath "/System/Library")
  (subpath "/Library/Apple")
${readRootRules})
(allow file-write*
${projectWriteRules}
  (subpath (param "SANDBOX_HOME"))
  (subpath (param "SANDBOX_TMP"))
  (subpath (param "SANDBOX_CACHE")))
(allow ipc-posix-shm*)
${inboundRule}
${networkRules}
`;
}

function sandboxString(value: string): string {
  return JSON.stringify(value);
}

function quoteNodeOptionsValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function writeProjectNetworkGuard(projectRoot: string): Promise<string> {
  const guardPath = join(projectRoot, ".driftradar", "sandbox", "network-guard.cjs");
  await writeFile(
    guardPath,
    `const net = require("node:net");
const dgram = require("node:dgram");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const allowedHost = process.env.DRIFTRADAR_ALLOWED_HOST || "";
const allowedPort = Number(process.env.DRIFTRADAR_ALLOWED_PORT || 0);
const enforcedNodeOptions = process.env.NODE_OPTIONS || "";
function normalizeHost(host) {
  if (!host) return "";
  const value = String(host).toLowerCase();
  if (value === "::ffff:127.0.0.1") return "127.0.0.1";
  return value;
}
function isLoopbackHost(host) {
  const value = normalizeHost(host);
  return value === "localhost" || value === "::1" || /^127(?:\\.\\d{1,3}){3}$/.test(value);
}
function assertAllowedListen(port, host) {
  if (Number(port) !== allowedPort || !isLoopbackHost(host)) {
    throw new Error(
      "DriftRadar blocked project server listen outside " + allowedHost + ":" + allowedPort
    );
  }
}
function blockApi(api) {
  return function blockedApi() {
    throw new Error("DriftRadar blocked project " + api + " during capture");
  };
}
const originalExecFile = childProcess.execFile;
const originalExecFileSync = childProcess.execFileSync;
const originalFork = childProcess.fork;
const originalRawSpawn = childProcess.ChildProcess.prototype.spawn;
const originalSpawn = childProcess.spawn;
const originalSpawnSync = childProcess.spawnSync;
const blockedChildExecutables = new Set([
  "bash",
  "cmd",
  "cmd.exe",
  "dash",
  "env",
  "fish",
  "open",
  "osascript",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "sh",
  "xdg-open",
  "zsh"
]);
function childExecutableName(file) {
  return String(file || "").split(/[\\\\/]/).pop().toLowerCase();
}
function resolveExecutablePath(file) {
  const value = String(file || "");
  if (!value) return undefined;
  if (value.includes("/") || value.includes("\\\\")) {
    return path.resolve(value);
  }
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.resolve(dir, value);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}
function shebangInterpreter(file) {
  const executablePath = resolveExecutablePath(file);
  if (!executablePath) return undefined;
  let fd;
  try {
    fd = fs.openSync(executablePath, "r");
    const buffer = Buffer.alloc(256);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytes).toString("utf8").split(/\\r?\\n/, 1)[0] || "";
    if (!firstLine.startsWith("#!")) return undefined;
    const parts = firstLine.slice(2).trim().split(/\\s+/).filter(Boolean);
    if (childExecutableName(parts[0]) === "env") {
      return parts.find((part, index) => index > 0 && !part.startsWith("-") && !part.includes("="));
    }
    return parts[0];
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}
function assertSafeChildProcess(file, options) {
  if (options && options.shell) {
    throw new Error("DriftRadar blocked project shell child process during capture");
  }
  if (blockedChildExecutables.has(childExecutableName(file))) {
    throw new Error("DriftRadar blocked project shell child process during capture");
  }
  const interpreter = shebangInterpreter(file);
  if (interpreter && blockedChildExecutables.has(childExecutableName(interpreter))) {
    throw new Error("DriftRadar blocked project shell child process during capture");
  }
}
function guardedChildOptions(options) {
  const next = options && typeof options === "object" ? { ...options } : {};
  next.env = { ...process.env, ...(next.env || {}) };
  if (enforcedNodeOptions) {
    next.env.NODE_OPTIONS = enforcedNodeOptions;
  }
  return next;
}
function envPairsFromEnv(env) {
  return Object.entries(env || {}).map(([key, value]) => key + "=" + value);
}
function guardedChildArgs(args) {
  const next = [...args];
  const callback = typeof next[next.length - 1] === "function" ? next.pop() : undefined;
  const last = next[next.length - 1];
  if (last && typeof last === "object" && !Array.isArray(last)) {
    next[next.length - 1] = guardedChildOptions(last);
  } else {
    next.push(guardedChildOptions());
  }
  if (callback) {
    next.push(callback);
  }
  return next;
}
function guardedForkArgs(args) {
  const next = guardedChildArgs(args);
  const optionsIndex = typeof next[next.length - 1] === "object" ? next.length - 1 : -1;
  if (optionsIndex >= 0) {
    next[optionsIndex] = { ...next[optionsIndex], execPath: process.execPath };
  }
  return next;
}
childProcess.exec = blockApi("child_process.exec");
childProcess.execSync = blockApi("child_process.execSync");
childProcess.execFile = function guardedExecFile(file, ...args) {
  const guarded = guardedChildArgs(args);
  assertSafeChildProcess(file, guarded.find((arg) => arg && typeof arg === "object" && !Array.isArray(arg)));
  return originalExecFile.call(this, file, ...guarded);
};
childProcess.execFileSync = function guardedExecFileSync(file, ...args) {
  const guarded = guardedChildArgs(args);
  assertSafeChildProcess(file, guarded.find((arg) => arg && typeof arg === "object" && !Array.isArray(arg)));
  return originalExecFileSync.call(this, file, ...guarded);
};
childProcess.fork = function guardedFork(modulePath, ...args) {
  const guarded = guardedForkArgs(args);
  return originalFork.call(this, modulePath, ...guarded);
};
childProcess.spawn = function guardedSpawn(file, ...args) {
  const guarded = guardedChildArgs(args);
  assertSafeChildProcess(file, guarded.find((arg) => arg && typeof arg === "object" && !Array.isArray(arg)));
  return originalSpawn.call(this, file, ...guarded);
};
childProcess.spawnSync = function guardedSpawnSync(file, ...args) {
  const guarded = guardedChildArgs(args);
  assertSafeChildProcess(file, guarded.find((arg) => arg && typeof arg === "object" && !Array.isArray(arg)));
  return originalSpawnSync.call(this, file, ...guarded);
};
childProcess.ChildProcess.prototype.spawn = function guardedRawSpawn(options) {
  const guarded = guardedChildOptions(options);
  guarded.envPairs = envPairsFromEnv(guarded.env);
  assertSafeChildProcess(guarded.file, guarded);
  return originalRawSpawn.call(this, guarded);
};
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function patchedListen(...args) {
  const first = args[0];
  if (typeof first === "object" && first !== null) {
    assertAllowedListen(first.port, first.host);
  } else if (typeof first === "number") {
    assertAllowedListen(first, typeof args[1] === "string" ? args[1] : undefined);
  } else {
    assertAllowedListen(undefined, undefined);
  }
  return originalListen.apply(this, args);
};
net.Socket.prototype.connect = function patchedConnect(...args) {
  throw new Error("DriftRadar blocked project outbound TCP during capture");
};
net.connect = blockApi("net.connect");
net.createConnection = blockApi("net.createConnection");
const originalBind = dgram.Socket.prototype.bind;
dgram.Socket.prototype.bind = function patchedBind(...args) {
  const first = args[0];
  if (typeof first === "object" && first !== null) {
    assertAllowedListen(first.port, first.address);
  } else if (typeof first === "number") {
    assertAllowedListen(first, typeof args[1] === "string" ? args[1] : undefined);
  } else {
    assertAllowedListen(undefined, undefined);
  }
  return originalBind.apply(this, args);
};
`,
    "utf8"
  );
  return guardPath;
}

function packageScripts(projectRoot: string, baseUrl?: string): ProjectScripts {
  try {
    const raw = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    const scripts = new Map(
      Object.entries(raw.scripts ?? {})
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [key, value as string])
    );
    if (!baseUrl) {
      return scripts;
    }
    const parsed = new URL(baseUrl);
    return {
      expectedHost: parsed.hostname,
      expectedPort: parsed.port,
      projectRoot,
      scripts
    };
  } catch {
    return new Map();
  }
}

function splitCommand(command: string): string[] {
  return (
    command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => {
      const quote = part[0];
      return (quote === `"` || quote === `'`) && part.at(-1) === quote ? part.slice(1, -1) : part;
    }) ?? []
  );
}
