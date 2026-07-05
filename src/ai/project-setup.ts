import { existsSync, realpathSync, statSync } from "node:fs";
import { isIP } from "node:net";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { configSchema } from "../contracts/schemas.js";
import type { DriftRadarConfig } from "../contracts/types.js";
import { CodexHarness, type CodexStructuredRunner } from "./codex-harness.js";
import { assertNoSensitiveProjectFiles } from "./sensitive-files.js";

const routeIdPattern = /[^a-z0-9_-]+/g;

export const projectSetupOutputSchema = {
  type: "object",
  properties: {
    canRun: { type: "boolean" },
    reason: { type: "string" },
    projectName: { type: "string" },
    packageManager: {
      type: "string",
      enum: ["npm", "pnpm", "yarn", "bun", "static", "unknown"]
    },
    runtime: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["package-script", "static-site", "unsupported"]
        },
        staticRoot: { type: ["string", "null"] },
        workingDirectory: { type: ["string", "null"] }
      },
      required: ["type", "staticRoot", "workingDirectory"],
      additionalProperties: false
    },
    installCommand: { type: ["string", "null"] },
    runCommand: { type: ["string", "null"] },
    baseUrl: { type: ["string", "null"] },
    routes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          url: { type: "string" },
          label: { type: "string" }
        },
        required: ["id", "url", "label"],
        additionalProperties: false
      }
    },
    tokenFiles: { type: "array", items: { type: "string" } },
    sourceRoots: { type: "array", items: { type: "string" } },
    testCommands: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } }
  },
  required: [
    "canRun",
    "reason",
    "projectName",
    "packageManager",
    "runtime",
    "installCommand",
    "runCommand",
    "baseUrl",
    "routes",
    "tokenFiles",
    "sourceRoots",
    "testCommands",
    "notes"
  ],
  additionalProperties: false
} as const;

const projectSetupSchema = z.object({
  canRun: z.boolean(),
  reason: z.string(),
  projectName: z.string(),
  packageManager: z.enum(["npm", "pnpm", "yarn", "bun", "static", "unknown"]),
  runtime: z.object({
    type: z.enum(["package-script", "static-site", "unsupported"]),
    staticRoot: z.string().nullable(),
    workingDirectory: z.string().nullable().optional()
  }),
  installCommand: z.string().nullable(),
  runCommand: z.string().nullable(),
  baseUrl: z.string().nullable(),
  routes: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      label: z.string()
    })
  ),
  tokenFiles: z.array(z.string()),
  sourceRoots: z.array(z.string()),
  testCommands: z.array(z.string()),
  notes: z.array(z.string())
});

export type ProjectSetup = z.infer<typeof projectSetupSchema>;

export interface ProjectRuntimePlan {
  setup: ProjectSetup;
  config: DriftRadarConfig;
}

export async function analyzeProjectSetup(
  projectRoot: string,
  runner: CodexStructuredRunner = new CodexHarness({ workingDirectory: projectRoot })
): Promise<ProjectSetup> {
  const response = await runner.runJson<unknown>(projectSetupPrompt(resolve(projectRoot)), {
    ...projectSetupOutputSchema
  });
  const parsed = projectSetupSchema.safeParse(response);
  if (!parsed.success) {
    return unsupportedSetup("Codex did not return a valid DriftRadar project setup.");
  }

  return parsed.data;
}

export async function createProjectRuntimePlan(
  projectRoot: string,
  runner?: CodexStructuredRunner
): Promise<ProjectRuntimePlan> {
  const root = resolve(projectRoot);
  await assertNoSensitiveProjectFiles(root, { allowDriftRadarOutput: true });
  const setup = await analyzeProjectSetup(root, runner);
  if (!setup.canRun) {
    throw new Error(`DriftRadar cannot work with this project: ${setup.reason}`);
  }

  let config: DriftRadarConfig;
  try {
    config = configFromSetup(root, setup);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw message.startsWith("DriftRadar cannot work with this project:")
      ? error
      : new Error(`DriftRadar cannot work with this project: ${message}`, { cause: error });
  }
  return { setup, config };
}

export function configFromSetup(projectRoot: string, setup: ProjectSetup): DriftRadarConfig {
  const root = resolve(projectRoot);
  const tokenFiles = setup.tokenFiles.map((path) => resolveProjectPathInside(root, path));
  const sourceRoots = setup.sourceRoots.map((path) => resolveProjectPathInside(root, path));
  const invalidSourceRoot = sourceRoots.find((path) => !statSync(path).isDirectory());
  if (invalidSourceRoot) {
    throw new Error(
      `DriftRadar cannot work with this project: source root must be a directory (${invalidSourceRoot}).`
    );
  }
  const routes = setup.routes.map((route, index) => ({
    id: safeRouteId(route.id || route.label || `route-${index + 1}`, index),
    url: route.url,
    label: route.label || route.id || `Route ${index + 1}`
  }));
  const hasRunnableRuntime =
    setup.runtime.type === "static-site" ||
    (setup.runtime.type === "package-script" && Boolean(setup.runCommand));

  if (!hasRunnableRuntime || !setup.baseUrl || routes.length === 0 || tokenFiles.length === 0) {
    throw new Error(
      "DriftRadar cannot work with this project: Codex did not find a runnable UI, route list, and token file."
    );
  }

  if (setup.runtime.type === "static-site") {
    if (setup.runtime.workingDirectory) {
      throw new Error(
        "DriftRadar cannot work with this project: static-site runtime must not set workingDirectory."
      );
    }
    const staticRoot = resolveProjectPathInside(root, setup.runtime.staticRoot ?? ".");
    if (!statSync(staticRoot).isDirectory()) {
      throw new Error(
        `DriftRadar cannot work with this project: static root must be a directory (${setup.runtime.staticRoot ?? "."}).`
      );
    }
  }
  if (setup.runtime.type === "package-script") {
    const runtimeRoot = projectRuntimeRoot(root, setup);
    if (!statSync(runtimeRoot).isDirectory()) {
      throw new Error(
        `DriftRadar cannot work with this project: package runtime workingDirectory must be a directory (${setup.runtime.workingDirectory ?? "."}).`
      );
    }
  }

  assertLocalUrl(setup.baseUrl);
  if (!new URL(setup.baseUrl).port) {
    throw new Error(
      `DriftRadar cannot work with this project: baseUrl must include an explicit local port (${setup.baseUrl}).`
    );
  }
  if (setup.runtime.type === "static-site" && new URL(setup.baseUrl).protocol !== "http:") {
    throw new Error(
      `DriftRadar cannot work with this project: static-site baseUrl must use http (${setup.baseUrl}).`
    );
  }
  for (const route of routes) {
    assertLocalUrl(route.url, setup.baseUrl);
    assertSameOrigin(route.url, setup.baseUrl);
  }

  const missingToken = tokenFiles.find((path) => !existsSync(path));
  if (missingToken) {
    throw new Error(
      `DriftRadar cannot work with this project: token file not found (${missingToken}).`
    );
  }

  return configSchema.parse({
    projectName: setup.projectName || basename(root),
    baseUrl: setup.baseUrl,
    routes,
    tokenFiles,
    outputDir: join(root, ".driftradar"),
    captureMode: "real",
    ai: {
      enabled: true,
      model: "gpt-5.4-mini",
      reasoningEffort: "medium",
      sourceRoots: sourceRoots.length > 0 ? sourceRoots : [root]
    }
  });
}

export function projectRuntimeRoot(projectRoot: string, setup: ProjectSetup): string {
  return resolveProjectPathInside(resolve(projectRoot), setup.runtime.workingDirectory ?? ".");
}

function projectSetupPrompt(projectRoot: string): string {
  return `/goal
Read the codebase in this folder with the Codex harness: ${projectRoot}

Decide whether this project has a UI that can run on this local machine.
Some repositories are libraries, backend-only services, mobile-only apps, cloud-only apps, or require unavailable private infrastructure; those are not runnable for DriftRadar.

Return JSON matching the schema exactly:
- canRun=false when no local browser UI can be started. Put the blocker in reason and leave runnable fields null or empty.
- canRun=true only when a local browser UI can be started through one of DriftRadar's safe runtime contracts:
  1. runtime.type="static-site" for plain HTML/CSS/JS that DriftRadar can serve itself. Set packageManager="static", installCommand=null, runCommand=null, runtime.staticRoot to the static file root, and choose a localhost baseUrl with an unused explicit port.
  2. runtime.type="package-script" for npm, pnpm, yarn, or bun scripts from the project root. DriftRadar runs these only inside its local runtime sandbox; return canRun=false if the UI requires direct host access outside the project tree, a non-loopback network service, or an unsupported process model.
- runCommand for package-script must start the UI server and keep running; use npm run, pnpm run, yarn run, or bun run with a script declared in package.json.
- Set runtime.workingDirectory to "." for root package scripts, to the nested package directory when the runnable UI is in a nested package, and to null for static-site or unsupported runtimes.
- For nested package scripts, make runCommand a package script declared in that nested package.json, not a workspace filter command.
- Supported package scripts include common local browser UI dev servers such as Vite, Next.js, Astro, Storybook, webpack serve, Angular, Nuxt, and Parcel.
- use npm run <script> -- --host 127.0.0.1 --port <port> for npm scripts.
- use pnpm run <script> --host 127.0.0.1 --port <port>, yarn run <script> --host 127.0.0.1 --port <port>, or bun run <script> --host 127.0.0.1 --port <port> without an extra -- separator.
- installCommand may be npm install, npm ci, pnpm install, yarn install, or bun install.
- do not use shell operators, environment prefixes, cd, bash, exec/dlx/x, publish, add, or chained commands.
- package-script runCommand must include an explicit --host or --hostname value set to localhost, 127.0.0.1, or ::1.
- baseUrl must be the localhost URL DriftRadar should capture, with a loopback host such as 127.0.0.1, localhost, or ::1.
- routes should include a small useful route set for the UI, using relative URLs when possible.
- tokenFiles must point at DriftRadar-parseable design-token CSS or JSON files in the repo: CSS custom properties under :root, .dark, [data-theme=dark], or Tailwind v4 @theme, or W3C/flat design-token JSON values.
- Do not choose VS Code themes, TextMate grammars, syntax-highlighter themes, package metadata, lockfiles, reports, arbitrary app data JSON, or generated config JSON as tokenFiles. If no parseable design-token file exists, return canRun=false.
- sourceRoots must point at UI source directories for code-aware patch suggestions.
- testCommands should include relevant local validation commands.
- prefer commands that pin an explicit port when the project supports that; never use 0.0.0.0 or a LAN/public host.
- Return canRun=false for dynamic stacks that cannot be expressed as a static-site or package-script runtime.

Do not modify files. Do not install dependencies.`;
}

function unsupportedSetup(reason: string): ProjectSetup {
  return {
    canRun: false,
    reason,
    projectName: "",
    packageManager: "unknown",
    runtime: { type: "unsupported", staticRoot: null },
    installCommand: null,
    runCommand: null,
    baseUrl: null,
    routes: [],
    tokenFiles: [],
    sourceRoots: [],
    testCommands: [],
    notes: []
  };
}

function resolveProjectPath(projectRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectRoot, path);
}

export function resolveProjectPathInside(projectRoot: string, path: string): string {
  const resolved = resolveProjectPath(projectRoot, path);
  let realProjectRoot: string;
  let realResolved: string;
  try {
    realProjectRoot = realpathSync(projectRoot);
    realResolved = realpathSync(resolved);
  } catch (error) {
    throw new Error(`DriftRadar cannot work with this project: path not found (${path}).`, {
      cause: error
    });
  }

  const relativePath = relative(realProjectRoot, realResolved);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(
      `DriftRadar cannot work with this project: Codex returned a path outside the project (${path}).`
    );
  }
  return resolved;
}

function assertLocalUrl(url: string, base?: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch (error) {
    throw new Error(`DriftRadar cannot work with this project: invalid local URL (${url}).`, {
      cause: error
    });
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (parsed.username || parsed.password) {
    throw new Error(
      `DriftRadar cannot work with this project: local URL must not include credentials (${url}).`
    );
  }
  const ipVersion = isIP(host);
  const isLoopback =
    host === "localhost" || (ipVersion === 4 && host.startsWith("127.")) || host === "::1";
  if (!isLoopback) {
    throw new Error(
      `DriftRadar cannot work with this project: Codex returned a non-local URL (${url}).`
    );
  }
}

function assertSameOrigin(url: string, base: string): void {
  const routeUrl = new URL(url, base);
  const baseUrl = new URL(base);
  if (routeUrl.origin !== baseUrl.origin) {
    throw new Error(
      `DriftRadar cannot work with this project: route URL must stay on the base origin (${url}).`
    );
  }
}

function safeRouteId(value: string, index: number): string {
  const normalized = value.toLowerCase().replace(routeIdPattern, "-").replace(/^-|-$/g, "");
  return normalized || `route-${index + 1}`;
}
