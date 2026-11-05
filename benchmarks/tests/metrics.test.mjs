/**
 * Adversarial tests for the pure benchmark metrics/gate helpers
 * (benchmarks/lib/metrics.mjs). Run: node --test benchmarks/tests/
 *
 * These tests assert the semantics that were previously gamed: deletion rate
 * can never masquerade as detection; a failed/unverified removal never grants
 * runtime credit; zero denominators are undefined; below-80% exits nonzero
 * (gate list non-empty); a generic "limits" record without an explicit
 * exclusion detail never counts as detection; unrelated-atom evidence does
 * not count.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GATES,
  scopeDetectionVerdict,
  aggregateStages,
  evaluateGates,
  removalPrecision,
  validateMeasurement,
} from "../lib/metrics.mjs";

const atom = (over = {}) => ({
  atomId: "atom-A",
  filePath: "src/a.js",
  hunkHeader: "@@ -1 +1 @@",
  state: "uncertain",
  evidenceIds: [],
  risks: [],
  ...over,
});
const report = (atoms, evidence = []) => ({ atoms, evidence });
const limitEv = (id, atomId, detail = "task exclusion statement matches this atom (terms: debug)", over = {}) => ({
  id, sourceId: "cli:task", category: "intent", polarity: "limits", detail, atomId, ...over,
});
const evReport = (record) => report(
  [atom({ evidenceIds: ["ev"] })],
  [limitEv("ev", record.atomId ?? "atom-A", record.detail, record)],
);

test("exclusion detection requires SAME atom, intent category, limits polarity AND explicit positive detail", () => {
  const v = scopeDetectionVerdict(evReport({ atomId: "atom-A" }), (c) => c.atomId === "atom-A");
  assert.equal(v.found, true);
  assert.equal(v.detected, true);
  assert.equal(v.exclusionEvidence, true);
});

// Root-review regression 1: a record belonging to atom-b must never grant
// credit to atom-a, even when atom-a's classification carries the id.
test("borrowed evidence from another atom cannot grant detection (root review)", () => {
  const v = scopeDetectionVerdict(
    evReport({ atomId: "atom-B", detail: "task exclusion statement matches this atom" }),
    (c) => c.atomId === "atom-A",
  );
  assert.equal(v.detected, false);
});

// Root-review regression 2: an inconclusive/unable-to-establish warning
// containing the word "exclusion" is NOT a positive finding.
test("inconclusive exclusion warning is not positive detection (root review)", () => {
  const v = scopeDetectionVerdict(
    evReport({ atomId: "atom-A", detail: "task exclusion could not be established because graph facts are incomplete" }),
    (c) => c.atomId === "atom-A",
  );
  assert.equal(v.detected, false);
});

test("missing or empty sourceId does not grant detection", () => {
  for (const sourceId of [undefined, ""]) {
    const v = scopeDetectionVerdict(
      report([atom({ evidenceIds: ["ev"] })], [limitEv("ev", "atom-A", "task exclusion statement matches this atom", { sourceId })]),
      () => true,
    );
    assert.equal(v.detected, false);
  }
});

test("non-intent category or non-limits polarity does not grant detection", () => {
  const nonIntent = scopeDetectionVerdict(
    report([atom({ evidenceIds: ["ev"] })], [limitEv("ev", "atom-A", "task exclusion statement matches this atom", { category: "verification" })]),
    () => true,
  );
  assert.equal(nonIntent.detected, false);
  const supportsPolarity = scopeDetectionVerdict(
    report([atom({ evidenceIds: ["ev"] })], [{ id: "ev", sourceId: "cli:task", category: "intent", polarity: "supports-required", detail: "task exclusion statement matches this atom", atomId: "atom-A" }]),
    () => true,
  );
  assert.equal(supportsPolarity.detected, false);
});

test("generic limits record without exclusion detail does NOT count", () => {
  const ev = {
    id: "ev-1", category: "verification", polarity: "limits",
    detail: "an inconclusive check prohibits a high-confidence automatic removal", atomId: "atom-A",
  };
  const v = scopeDetectionVerdict(report([atom({ evidenceIds: ["ev-1"] })], [ev]), () => true);
  assert.equal(v.found, true);
  assert.equal(v.detected, false);
});

test("limits evidence tied to a DIFFERENT atom does not count", () => {
  const ev = limitEv("ev-1", "atom-B");
  const v = scopeDetectionVerdict(report([atom({ atomId: "atom-A", evidenceIds: ["ev-1"] })], [ev]), (c) => c.atomId === "atom-A");
  assert.equal(v.found, true);
  assert.equal(v.detected, false);
});

test("graph-incomplete / unrelated graph diagnostics never grant detection", () => {
  const v = scopeDetectionVerdict(report([atom()], []), () => true);
  assert.equal(v.detected, false);
});

test("candidate with zero risks counts as detected without any evidence record", () => {
  const v = scopeDetectionVerdict(report([atom({ state: "candidate", risks: [] })], []), () => true);
  assert.equal(v.detected, true);
});

test("candidate WITH risk flags is not detected", () => {
  const v = scopeDetectionVerdict(report([atom({ state: "candidate", risks: [{ kind: "dependency" }] })], []), () => true);
  assert.equal(v.detected, false);
});

const caseDef = (over = {}) => ({
  id: over.id ?? "c1", class: over.class ?? "synthetic", skipped: false,
  hasUnnecessaryLabel: true, staticDetected: false, runtimeConfirmed: false,
  removedUnnecessary: false, ...over,
});

test("union semantics: runtime confirmation alone lifts full-pipeline detection; deletion alone does not", () => {
  const stages = aggregateStages([caseDef({ staticDetected: false, runtimeConfirmed: true })]);
  assert.equal(stages.fullPipelineDetection.rate, 1);
  assert.equal(stages.staticDetection.rate, 0);
  assert.equal(stages.runtimeConfirmed.rate, 1);
});

test("a case with deletion but NO independent verification gets runtime credit NOWHERE", () => {
  const stages = aggregateStages([caseDef({ removedUnnecessary: true, runtimeConfirmed: false, staticDetected: false })]);
  assert.equal(stages.deletion.rate, 1); // deletion happened
  assert.equal(stages.runtimeConfirmed.rate, 0); // but is not confirmed
  assert.equal(stages.fullPipelineDetection.rate, 0); // and cannot pass the gate alone
});

test("failed cases and conservative misses stay in the denominator", () => {
  const stages = aggregateStages([
    caseDef({ id: "hit", staticDetected: true }),
    caseDef({ id: "failed-case", ok: false, staticDetected: false, runtimeConfirmed: false }),
    caseDef({ id: "miss", staticDetected: false }),
  ]);
  assert.equal(stages.fullPipelineDetection.denominator, 3);
  assert.equal(stages.fullPipelineDetection.rate, 1 / 3);
  assert.deepEqual(stages.fullPipelineDetection.missCases, ["failed-case", "miss"]);
});

test("below-80% union produces a gate failure; deletion rate of 100% cannot substitute", () => {
  const cases = [];
  for (let i = 0; i < 10; i += 1) {
    cases.push(caseDef({ id: `c${i}`, removedUnnecessary: true, runtimeConfirmed: false, staticDetected: false }));
  }
  cases[0].staticDetected = true;
  cases[0].runtimeConfirmed = true;
  const stages = aggregateStages(cases);
  const failures = evaluateGates({
    stages,
    precision: { numerator: 14, denominator: 14, rate: 1 },
    finalOracle: { numerator: 11, denominator: 11, rate: 1 },
    hiddenRegressions: 0,
    successfulReductionCases: ["c0"],
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /full-pipeline detection .*10\.0% < 80%/);
});

test("union >=80% with zero static contribution passes via runtime confirmation only", () => {
  const cases = [];
  for (let i = 0; i < 10; i += 1) cases.push(caseDef({ id: `c${i}`, runtimeConfirmed: true }));
  const stages = aggregateStages(cases);
  const failures = evaluateGates({
    stages,
    precision: { numerator: 5, denominator: 5, rate: 1 },
    finalOracle: { numerator: 10, denominator: 10, rate: 1 },
    hiddenRegressions: 0,
    successfulReductionCases: cases.map((c) => c.id),
  });
  assert.deepEqual(failures, []);
});

test("zero denominator is undefined, never 100%", () => {
  const stages = aggregateStages([]);
  assert.equal(stages.fullPipelineDetection.rate, undefined);
  assert.equal(removalPrecision([]).rate, undefined);
  const failures = evaluateGates({
    stages, precision: removalPrecision([]), finalOracle: { numerator: 0, denominator: 0, rate: undefined },
    hiddenRegressions: 0, successfulReductionCases: [],
  });
  assert.equal(failures.length, 4);
  assert.match(failures[0], /undefined/);
  assert.match(failures[1], /full-pipeline detection .*undefined/);
});

test("skipped cases leave all denominators", () => {
  const stages = aggregateStages([caseDef({ skipped: true }), caseDef({ id: "real", staticDetected: true })]);
  assert.equal(stages.fullPipelineDetection.denominator, 1);
  assert.equal(stages.fullPipelineDetection.rate, 1);
});

test("precision below 98% fails even with perfect detection", () => {
  const stages = aggregateStages([caseDef({ staticDetected: true })]);
  const failures = evaluateGates({
    stages, precision: { numerator: 97, denominator: 100, rate: 0.97 },
    finalOracle: { numerator: 1, denominator: 1, rate: 1 },
    hiddenRegressions: 0, successfulReductionCases: ["c1"],
  });
  assert.ok(failures.some((f) => f.includes("removal precision 97.0%")));
});

test("gate constants are the published, unlowered thresholds", () => {
  assert.equal(GATES.precision, 0.98);
  assert.equal(GATES.fullPipelineDetection, 0.8);
  assert.equal(GATES.finalOracle, 1.0);
  assert.equal(GATES.hiddenRegressions, 0);
});

// ── Root-review regressions: gate statistics fail closed ─────────

test("NaN detection rate fails closed (root review)", () => {
  const failures = evaluateGates({
    stages: { fullPipelineDetection: { numerator: 0, denominator: 10, rate: Number.NaN }, staticDetection: { rate: 0 } },
    precision: { numerator: 1, denominator: 1, rate: 1 },
    finalOracle: { numerator: 1, denominator: 1, rate: 1 },
    hiddenRegressions: 0,
    successfulReductionCases: ["case"],
  });
  assert.ok(failures.length > 0);
  assert.match(failures[0], /fullPipelineDetection.*not finite in 0..1/);
});

test("impossible rate above one fails closed (root review)", () => {
  const failures = evaluateGates({
    stages: { fullPipelineDetection: { numerator: 0, denominator: 10, rate: 2 }, staticDetection: { rate: 0 } },
    precision: { numerator: 1, denominator: 1, rate: 1 },
    finalOracle: { numerator: 1, denominator: 1, rate: 1 },
    hiddenRegressions: 0,
    successfulReductionCases: ["case"],
  });
  assert.ok(failures.length > 0);
});

test("rate disagreeing with numerator/denominator fails closed", () => {
  const failures = evaluateGates({
    stages: { fullPipelineDetection: { numerator: 1, denominator: 10, rate: 0.9 }, staticDetection: { rate: 0 } },
    precision: { numerator: 1, denominator: 1, rate: 1 },
    finalOracle: { numerator: 1, denominator: 1, rate: 1 },
    hiddenRegressions: 0,
    successfulReductionCases: ["case"],
  });
  assert.ok(failures.some((f) => f.includes("does not equal 1/10")));
});

test("negative or non-integer counts fail closed; numerator above denominator fails closed", () => {
  assert.match(validateMeasurement("x", { numerator: -1, denominator: 10, rate: 0 }), /invalid numerator/);
  assert.match(validateMeasurement("x", { numerator: 1.5, denominator: 10, rate: 0.15 }), /invalid numerator/);
  assert.match(validateMeasurement("x", { numerator: 11, denominator: 10, rate: 1.1 }), /numerator 11 > denominator 10/);
  assert.match(validateMeasurement("x", { numerator: 0, denominator: -3, rate: 0 }), /invalid denominator/);
  assert.equal(validateMeasurement("x", { numerator: 3, denominator: 10, rate: 0.3 }), null);
  assert.equal(validateMeasurement("x", { numerator: 0, denominator: 0, rate: undefined }), null);
  assert.match(validateMeasurement("x", { numerator: 0, denominator: 0, rate: 1 }), /zero denominator must be undefined/);
});

// Root-review regression: the safe-count contract — counts beyond
// Number.MAX_SAFE_INTEGER are rejected, not silently accepted as integers
// (2**53 loses precision in numerator/denominator arithmetic).
test("non-safe-integer counts fail closed (root review)", () => {
  assert.match(validateMeasurement("x", { numerator: 2 ** 53, denominator: 2 ** 53, rate: 1 }), /invalid numerator/);
  assert.match(validateMeasurement("x", { numerator: 0, denominator: 2 ** 53, rate: 0 }), /invalid denominator/);
  assert.equal(validateMeasurement("x", { numerator: 2 ** 53 - 1, denominator: 2 ** 53 - 1, rate: 1 }), null);
});

test("zero denominator reported as a rate is rejected, undefined is accepted", () => {
  const failures = evaluateGates({
    stages: { fullPipelineDetection: { numerator: 0, denominator: 0, rate: 1 }, staticDetection: { rate: 0 } },
    precision: { numerator: 1, denominator: 1, rate: 1 },
    finalOracle: { numerator: 1, denominator: 1, rate: 1 },
    hiddenRegressions: 0,
    successfulReductionCases: ["case"],
  });
  assert.ok(failures.some((f) => f.includes("fullPipelineDetection")));
});
