import { constants } from "node:fs";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { ZodError } from "zod";
import { configSchema } from "../contracts/schemas.js";
import type { DriftRadarConfig } from "../contracts/types.js";
import { ingestTokenFiles } from "../tokens/ingest-tokens.js";

export async function loadConfig(path: string): Promise<DriftRadarConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read config ${path}: ${messageOf(error)}`, { cause: error });
  }

  try {
    return configSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${path}: ${error.message}`, { cause: error });
    }

    if (error instanceof ZodError) {
      throw new Error(
        `Invalid config ${path}:\n${error.issues
          .map((issue) => `- ${issue.path.join(".") || "<root>"}: ${issue.message}`)
          .join("\n")}`,
        { cause: error }
      );
    }

    throw error;
  }
}

export async function validateConfigFile(path: string): Promise<DriftRadarConfig> {
  const config = await loadConfig(path);

  await Promise.all(
    config.tokenFiles.map(async (tokenFile) => {
      const tokenPath = resolve(tokenFile);
      let tokenStat;
      try {
        tokenStat = await stat(tokenPath);
        await access(tokenPath, constants.R_OK);
      } catch (error) {
        throw new Error(`Token file not readable: ${tokenFile} (${messageOf(error)})`, {
          cause: error
        });
      }

      if (!tokenStat.isFile()) {
        throw new Error(`Token file must be a file: ${tokenFile}`);
      }

      if (![".css", ".json"].includes(extname(tokenPath).toLowerCase())) {
        throw new Error(`Token file must be CSS or JSON: ${tokenFile}`);
      }
    })
  );
  await ingestTokenFiles(config.tokenFiles);

  const outputDir = resolve(config.outputDir);
  const probePath = join(outputDir, `.driftradar-write-check-${process.pid}-${Date.now()}`);
  try {
    await mkdir(outputDir, { recursive: true });
    await access(outputDir, constants.W_OK | constants.X_OK);
    await writeFile(probePath, "");
  } catch (error) {
    throw new Error(`Output directory not writable: ${config.outputDir} (${messageOf(error)})`, {
      cause: error
    });
  } finally {
    await rm(probePath, { force: true }).catch(() => undefined);
  }

  return config;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
