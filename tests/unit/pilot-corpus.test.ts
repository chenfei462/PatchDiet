import { describe, expect, it } from "vitest";

const sha = "a".repeat(40);
const fixture = { schemaVersion: "patchdiet-natural-pr-corpus/1", cases: [{
  id: "case-1", consent: true, source: { repoUrl: "https://github.com/octocat/demo", pullNumber: 6, baseSha: sha, headSha: sha },
  labeler: "reviewer-1", labeledAt: "2026-10-08T00:00:00Z", labels: [
    { candidateId: "atom-1", verdict: "unnecessary", rationale: "Unrelated formatting edit" },
    { candidateId: "atom-2", verdict: "necessary", rationale: "Required login fix" }
  ], pilot: { reviewMinutesBefore: 20, reviewMinutesAfter: 12, suggestions: 2, acceptedSuggestions: 1, regressions: 0 }
}] };

describe("opt-in natural PR corpus validation", () => {
  it("validates caller-supplied labels and reports only measured aggregates", async () => {
    // @ts-expect-error Runtime .mjs module intentionally has no declaration.
    const { validateCorpus, aggregatePilot } = await import("../../scripts/import-natural-pr-corpus.mjs");
    const cases = validateCorpus(fixture);
    expect(aggregatePilot(cases)).toMatchObject({ claimedNaturalCases: 1, independentlyVerifiedNaturalCases: 0,
      labelledCandidates: 2, pilotCases: 1, totalReviewMinutesSaved: 8, acceptedSuggestions: 1, regressions: 0 });
    expect(() => validateCorpus({ ...fixture, cases: [...fixture.cases, ...fixture.cases] })).toThrow(/duplicate/);
    expect(() => validateCorpus({ ...fixture, cases: [{ ...fixture.cases[0], consent: false }] })).toThrow(/consent/);
    expect(() => validateCorpus({ ...fixture, cases: [{ ...fixture.cases[0], labels: [{ candidateId: "atom-1", verdict: "unnecessary", rationale: "" }] }] })).toThrow(/rationale/);
    expect(() => validateCorpus({ ...fixture, cases: [{ ...fixture.cases[0], pilot: { ...fixture.cases[0].pilot, acceptedSuggestions: 3 } }] })).toThrow(/accepted/);
  });
});
