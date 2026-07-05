import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import fg from "fast-glob";

const sensitiveProjectGlobs = [
  "**/.env",
  "**/.env.*",
  "**/.envrc",
  "**/.git-credential*",
  "**/.git-credentials",
  "**/.pnpmrc",
  "**/.pypirc",
  "**/.yarnrc",
  "**/.yarnrc.yml",
  "**/.netrc",
  "**/.aws/**",
  "**/.ssh/**",
  "**/.kube/**",
  "**/id_rsa",
  "**/id_dsa",
  "**/id_ed25519",
  "**/credential",
  "**/credential/**",
  "**/credentials",
  "**/credentials/**",
  "**/.credential",
  "**/.credential/**",
  "**/.credentials",
  "**/.credentials/**",
  "**/.secret",
  "**/secret",
  "**/secret/**",
  "**/.secrets",
  "**/secrets",
  "**/secrets/**",
  "**/*credential*.env",
  "**/*credential*.ini",
  "**/*credential*.json",
  "**/*credential*.txt",
  "**/*credential*.yaml",
  "**/*credential*.yml",
  "**/*secret*.env",
  "**/*secret*.ini",
  "**/*secret*.json",
  "**/*secret*.txt",
  "**/*secret*.yaml",
  "**/*secret*.yml",
  "**/*service-account*",
  "**/*service*account*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.keystore",
  "**/*.mobileprovision"
];
const legacyCodexHomeExampleIgnores = [".driftradar/codex-home/**/.env.example"];
export interface SensitiveProjectFileOptions {
  allowDriftRadarOutput?: boolean;
}

export async function assertNoSensitiveProjectFiles(
  projectRoot: string,
  options: SensitiveProjectFileOptions = {}
): Promise<void> {
  const realProjectRoot = await realpath(projectRoot);
  if (!options.allowDriftRadarOutput) {
    const [existingRunArtifact] = await fg([".driftradar", ".driftradar/**"], {
      cwd: projectRoot,
      dot: true,
      followSymbolicLinks: false,
      onlyFiles: false
    });
    if (existingRunArtifact) {
      throw new Error(
        "DriftRadar cannot work with this project: previous DriftRadar output is present. Remove .driftradar before using AI setup."
      );
    }
  }
  const [match] = await fg(sensitiveProjectGlobs, {
    cwd: projectRoot,
    caseSensitiveMatch: false,
    dot: true,
    followSymbolicLinks: false,
    ignore: legacyCodexHomeExampleIgnores,
    onlyFiles: false,
    suppressErrors: true
  });
  if (match) {
    throw new Error(
      `DriftRadar cannot work with this project: sensitive file present (${match}). Move secrets out of the project before using AI setup.`
    );
  }
  const entries = await fg(["**/*"], {
    cwd: projectRoot,
    dot: true,
    followSymbolicLinks: false,
    onlyFiles: false,
    suppressErrors: true
  });
  for (const entry of entries) {
    const absolutePath = resolve(projectRoot, entry);
    const stats = await lstat(absolutePath);
    if (!stats.isSymbolicLink()) {
      continue;
    }
    const realTarget = await realpath(absolutePath);
    const relativeTarget = relative(realProjectRoot, realTarget);
    if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
      throw new Error(
        `DriftRadar cannot work with this project: symlink points outside the project (${entry}). Move secrets out of the project before using AI setup.`
      );
    }
  }
  await assertNoCredentialedPackageConfig(projectRoot);
  await assertNoCredentialedGitConfig(projectRoot);
}

async function assertNoCredentialedPackageConfig(projectRoot: string): Promise<void> {
  const matches = await fg(["**/.npmrc"], {
    cwd: projectRoot,
    absolute: true,
    caseSensitiveMatch: false,
    dot: true,
    followSymbolicLinks: false,
    onlyFiles: false,
    suppressErrors: true
  });
  for (const file of matches) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    if (containsCredentialedPackageConfig(content)) {
      throw new Error(
        "DriftRadar cannot work with this project: credential-bearing package manager config is present. Remove credentials from package manager config before using AI setup."
      );
    }
  }
}

async function assertNoCredentialedGitConfig(projectRoot: string): Promise<void> {
  const realProjectRoot = await realpath(projectRoot);
  const matches = new Set<string>(
    await fg([".git/config", ".git/config.worktree", ".git/modules/**/config", ".gitmodules"], {
      cwd: projectRoot,
      absolute: true,
      dot: true,
      followSymbolicLinks: false,
      onlyFiles: true,
      suppressErrors: true
    })
  );
  for (const gitDir of await gitConfigRoots(projectRoot)) {
    matches.add(join(gitDir, "config"));
    matches.add(join(gitDir, "config.worktree"));
    for (const moduleConfig of await fg(["modules/**/config"], {
      cwd: gitDir,
      absolute: true,
      dot: true,
      followSymbolicLinks: false,
      onlyFiles: true,
      suppressErrors: true
    })) {
      matches.add(moduleConfig);
    }
  }
  for (const relativePath of [".git/config", ".git/config.worktree", ".gitmodules"]) {
    matches.add(resolve(projectRoot, relativePath));
  }
  for (const file of matches) {
    try {
      const stats = await lstat(file);
      if (stats.isSymbolicLink()) {
        const realFile = await realpath(file);
        const relativeFile = relative(realProjectRoot, realFile);
        if (relativeFile.startsWith("..") || isAbsolute(relativeFile)) {
          throw outsideGitConfigSymlinkError();
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("Git config")) {
        throw error;
      }
      continue;
    }
    const content = await readFile(file, "utf8");
    if (containsCredentialedGitConfig(content)) {
      throw new Error(
        "DriftRadar cannot work with this project: credential-bearing Git config is present. Remove credentials from Git remotes before using AI setup."
      );
    }
  }
}

function outsideGitConfigSymlinkError(): Error {
  return new Error(
    "DriftRadar cannot work with this project: symlink points outside the project (Git config). Move secrets out of the project before using AI setup."
  );
}

async function gitConfigRoots(projectRoot: string): Promise<string[]> {
  const gitPath = resolve(projectRoot, ".git");
  let stats;
  try {
    stats = await lstat(gitPath);
  } catch {
    return [];
  }

  if (stats.isSymbolicLink()) {
    const realGitPath = await realpath(gitPath);
    const realProjectRoot = await realpath(projectRoot);
    const relativeGitPath = relative(realProjectRoot, realGitPath);
    if (relativeGitPath.startsWith("..") || isAbsolute(relativeGitPath)) {
      throw new Error(
        "DriftRadar cannot work with this project: .git symlink points outside the project. Use a normal worktree checkout before using AI setup."
      );
    }
    return [realGitPath];
  }

  if (!stats.isFile()) {
    return [];
  }

  const content = await readFile(gitPath, "utf8");
  const match = content.match(/^\s*gitdir:\s*(.+?)\s*$/im);
  if (!match?.[1]) {
    return [];
  }

  const gitDir = await realpath(resolve(dirname(gitPath), match[1]));
  const roots = [gitDir];
  try {
    const commonDirRaw = (await readFile(join(gitDir, "commondir"), "utf8")).trim();
    if (commonDirRaw) {
      roots.push(await realpath(resolve(gitDir, commonDirRaw)));
    }
  } catch {
    // Worktrees without commondir still have a local gitdir config to inspect.
  }
  return roots;
}

function containsCredentialedGitConfig(content: string): boolean {
  return (
    /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s@]+@/.test(content) ||
    /^\s*(?:extraheader|http\..*\.extraheader)\s*=\s*["']?(?:authorization|proxy-authorization|cookie|private-token|job-token|x-[a-z0-9-]*(?:token|auth|key|cookie)|[a-z0-9-]*(?:token|auth|key|cookie))\s*:/gim.test(
      content
    ) ||
    /^\s*credential\.helper\s*=\s*.+/gim.test(content) ||
    /^\s*\[credential(?:\s+[^\]]+)?\][\s\S]*?^\s*helper\s*=/gim.test(content) ||
    /^\s*(?:password|token|oauth|authtoken|privatekey)\s*=/gim.test(content) ||
    /\b(?:bearer|basic|ghp_|github_pat_|glpat-|x-oauth-basic)\b/i.test(content)
  );
}

function containsCredentialedPackageConfig(content: string): boolean {
  const credentialKey = "(?:_auth(?:Token)?|npmAuthToken|npmAuthIdent|_password|password|token)";
  return (
    /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s@]+@/.test(content) ||
    new RegExp(
      String.raw`^\s*(?:(?:\/\/|[A-Za-z][A-Za-z0-9+.-]*:\/\/).*:)?${credentialKey}\s*=`,
      "gim"
    ).test(content) ||
    /\b(?:bearer|basic|ghp_|github_pat_|glpat-|npm_[A-Za-z0-9]{20,})/i.test(content)
  );
}
