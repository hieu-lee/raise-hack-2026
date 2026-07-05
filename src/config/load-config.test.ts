import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, validateConfigFile } from "./load-config.js";

describe("config validation", () => {
  it("loads valid config with defaults", async () => {
    const config = await validateConfigFile("fixtures/config/valid.json");

    expect(config.projectName).toBe("DriftRadar fixture");
    expect(config.outputDir).toBe(".driftradar");
    expect(config.viewports.map((viewport) => viewport.name)).toEqual(["desktop", "mobile"]);
    expect(config.ollama.enabled).toBe(false);
  });

  it("reports actionable schema errors", async () => {
    await expect(loadConfig("fixtures/config/invalid.json")).rejects.toThrow(
      /projectName: Too small/
    );
  });

  it("reports missing token files", async () => {
    await expect(validateConfigFile("fixtures/config/missing-token.json")).rejects.toThrow(
      /Token file not readable: fixtures\/config\/missing.css/
    );
  });

  it("reports invalid token contents", async () => {
    await expect(validateConfigFile("fixtures/config/bad-token-file.json")).rejects.toThrow(
      /color.bad: expected a color token/
    );
  });

  it("rejects token directories", async () => {
    await expect(validateConfigFile("fixtures/config/token-directory.json")).rejects.toThrow(
      /Token file must be a file: fixtures\/config/
    );
  });

  it("rejects malformed route URLs", async () => {
    await expect(loadConfig("fixtures/config/bad-route-url.json")).rejects.toThrow(
      /routes.0.url: must be a valid absolute URL or relative URL/
    );
  });

  it("rejects blank route URLs", async () => {
    await expect(loadConfig("fixtures/config/blank-route-url.json")).rejects.toThrow(
      /routes.0.url: Too small/
    );
  });

  it("rejects non-browser URL schemes", async () => {
    await expect(loadConfig("fixtures/config/bad-url-scheme.json")).rejects.toThrow(
      /baseUrl: must use http or https/
    );
  });

  it("rejects non-http ollama URLs", async () => {
    await expect(loadConfig("fixtures/config/bad-ollama-url.json")).rejects.toThrow(
      /ollama.baseUrl: must use http or https/
    );
  });

  it("rejects duplicate artifact keys", async () => {
    await expect(loadConfig("fixtures/config/duplicate-keys.json")).rejects.toThrow(
      /routes.1.id: must be unique/
    );
  });

  it("rejects path-unsafe viewport names", async () => {
    await expect(loadConfig("fixtures/config/bad-viewport-name.json")).rejects.toThrow(
      /viewports.0.name: use lowercase/
    );
  });

  it("rejects uppercase artifact keys", async () => {
    await expect(loadConfig("fixtures/config/bad-key-case.json")).rejects.toThrow(
      /routes.0.id: use lowercase/
    );
  });

  it("checks output directory writability", async () => {
    const dir = await mkdtemp(join(tmpdir(), "driftradar-config-"));
    const configPath = join(dir, "config.json");
    const outputDir = join(dir, "readonly");

    try {
      await writeFile(
        configPath,
        JSON.stringify({
          projectName: "Readonly output fixture",
          baseUrl: "http://localhost:4173",
          routes: [{ id: "home", url: "/" }],
          tokenFiles: ["fixtures/config/tokens.css"],
          outputDir
        })
      );
      await mkdir(outputDir);
      await chmod(outputDir, 0o555);
      await expect(validateConfigFile(configPath)).rejects.toThrow(/Output directory not writable/);
    } finally {
      await chmod(outputDir, 0o700).catch(() => undefined);
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("checks output directory search permission", async () => {
    const dir = await mkdtemp(join(tmpdir(), "driftradar-config-"));
    const configPath = join(dir, "config.json");
    const outputDir = join(dir, "write-only");

    try {
      await writeFile(
        configPath,
        JSON.stringify({
          projectName: "Write-only output fixture",
          baseUrl: "http://localhost:4173",
          routes: [{ id: "home", url: "/" }],
          tokenFiles: ["fixtures/config/tokens.css"],
          outputDir
        })
      );
      await mkdir(outputDir);
      await chmod(outputDir, 0o222);
      await expect(validateConfigFile(configPath)).rejects.toThrow(/Output directory not writable/);
    } finally {
      await chmod(outputDir, 0o700).catch(() => undefined);
      await rm(dir, { force: true, recursive: true });
    }
  });
});
