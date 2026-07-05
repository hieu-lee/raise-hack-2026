import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ObservationRecord, TokenSet } from "../contracts/types.js";
import { analyzeObservations } from "../analyze/observations.js";
import { classifyDrift } from "./drift-classifier.js";

interface Fixture {
  tokens: TokenSet;
  observations: ObservationRecord[];
}

describe("drift classifier", () => {
  it("classifies all required drift categories from fixture observations", async () => {
    const fixture = await readFixture();
    const issues = classifyDrift(analyzeObservations(fixture.observations, fixture.tokens));
    const categories = new Set(issues.map((issue) => issue.category));

    expect(categories).toEqual(
      new Set([
        "token_misuse",
        "new_pattern_candidate",
        "accidental_regression",
        "acceptable_exception"
      ])
    );
    expect(issues.find((issue) => issue.category === "acceptable_exception")?.severity).toBe("low");
    expect(
      issues.find((issue) => issue.category === "new_pattern_candidate")?.evidence.occurrenceCount
    ).toBe(3);
  });

  it("keeps issue IDs stable for unchanged input", async () => {
    const fixture = await readFixture();
    const first = classifyDrift(analyzeObservations(fixture.observations, fixture.tokens));
    const second = classifyDrift(analyzeObservations(fixture.observations, fixture.tokens));

    expect(second.map((issue) => issue.id)).toEqual(first.map((issue) => issue.id));
  });

  it("deduplicates repeated captures across viewport and state", async () => {
    const fixture = await readFixture();
    const duplicate = {
      ...fixture.observations[0],
      viewport: "mobile",
      state: "hover" as const
    };
    const issues = classifyDrift(
      analyzeObservations([...fixture.observations, duplicate], fixture.tokens)
    );
    const tokenMisuse = issues.find((issue) => issue.category === "token_misuse");

    expect(tokenMisuse?.evidence.relatedIssueIds).toHaveLength(1);
  });

  it("keeps external near-token observations as acceptable exceptions", async () => {
    const fixture = await readFixture();
    const externalNearToken = {
      ...fixture.observations[0],
      elementId: "external-near-token",
      selectorHint: ".external-logo",
      tagName: "img",
      textSample: "External partner logo"
    };
    const issues = classifyDrift(analyzeObservations([externalNearToken], fixture.tokens));

    expect(issues).toHaveLength(1);
    expect(issues[0]?.category).toBe("acceptable_exception");
  });

  it("does not let external observations inflate pattern clusters", async () => {
    const fixture = await readFixture();
    const card = fixture.observations.find(
      (observation) => observation.elementId === "card-regression"
    );
    const external = fixture.observations.find(
      (observation) => observation.elementId === "external-logo"
    );
    if (!card || !external) {
      throw new Error("fixture is missing expected observations");
    }

    const secondCard = { ...card, elementId: "card-regression-2" };
    const issues = classifyDrift(analyzeObservations([card, secondCard, external], fixture.tokens));

    expect(issues.some((issue) => issue.category === "new_pattern_candidate")).toBe(false);
  });
});

async function readFixture(): Promise<Fixture> {
  return JSON.parse(await readFile("fixtures/classify/golden-categories.json", "utf8")) as Fixture;
}
