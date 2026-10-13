/**
 * Pure benchmark metrics + gate helpers (no I/O). Kept separate so the
 * aggregation/gate semantics are adversarially testable without fixtures.
 *
 * Three measured stages, never merged into one number:
 *
 * (1) staticDetection   — the public readonly Scope Map (pre-reduction)
 *     positively ties a task-exclusion finding to a prelabelled-unnecessary
 *     atom of that case.
 * (2) runtimeConfirmed  — a labelled-unnecessary atom whose removal was
 *     actually DELIVERED in a verified artifact that passed full independent
 *     re-verification (apply, oracle, tree identity, held-out, artifact-label
 *     agreement). Raw removal headers alone never grant credit.
 * (3) deletion          — cases with at least one unnecessary atom removed
 *     (independent of verification outcome). Kept for visibility only; it is
 *     never used as a detection gate.
 *
 * fullPipelineDetection = per-case UNION of (1) and (2), deduplicated by case.
 * The exit gate is on the union rate; the static rate stays published as-is.
 */

export const GATES = {
  precision: 0.98,
  fullPipelineDetection: 0.8,
  finalOracle: 1.0,
  hiddenRegressions: 0,
};

/** Exact positive task-exclusion detail emitted by the public scope engine. */
const POSITIVE_EXCLUSION_DETAIL = "task exclusion statement matches this atom";

/**
 * Detection verdict for one atom against a public Scope Map report.
 *
 * Requires an actual SAME-ATOM record: the classification must carry an
 * intent-category `limits`-polarity evidence record whose detail is the
 * engine's POSITIVE exclusion finding (`task exclusion statement matches
 * this atom ...`), emitted from an explicit source — not a borrowed record
 * for another atom and not an inconclusive/unable-to-establish warning that
 * merely contains the word "exclusion". Alternatively the atom must be
 * classified candidate with no risk flags. A generic graph/limits warning,
 * or evidence tied to a different atom, never counts.
 */
export function scopeDetectionVerdict(scopeReport, predicate) {
  const evidenceById = new Map(scopeReport.evidence.map((record) => [record.id, record]));
  for (const classification of scopeReport.atoms) {
    if (!predicate(classification)) continue;
    const exclusionEvidence = classification.evidenceIds.some((evidenceId) => {
      const record = evidenceById.get(evidenceId);
      return (
        record !== undefined &&
        // Same-atom requirement: a record belonging to another atom never
        // grants credit, even if a classification carries its id.
        record.atomId === classification.atomId &&
        record.category === "intent" &&
        record.polarity === "limits" &&
        // Explicit relevant source (e.g. cli:task), never an anonymous record.
        typeof record.sourceId === "string" &&
        record.sourceId.length > 0 &&
        typeof record.detail === "string" &&
        // POSITIVE finding only: an "exclusion could not be established" /
        // inconclusive warning contains "exclusion" but is not a finding.
        record.detail.startsWith(POSITIVE_EXCLUSION_DETAIL)
      );
    });
    return {
      found: true,
      detected: (classification.state === "candidate" && classification.risks.length === 0) || exclusionEvidence,
      state: classification.state,
      exclusionEvidence,
    };
  }
  return { found: false, detected: false, state: null, exclusionEvidence: false };
}

/**
 * Per-case stage computation. Inputs (per case):
 *  - hasUnnecessaryLabel: boolean
 *  - staticDetected: boolean (stage 1 measured before reduction)
 *  - runtimeConfirmed: boolean (stage 2: a matched unnecessary atom removed
 *    AND the artifact fully independently re-verified AND label agreement)
 *  - removedUnnecessary: boolean (stage 3)
 *  - failed checks: `ok` false excludes the case from neither stage silently —
 *    a failed/unverified removal is simply absent from stage 2 and union
 *    credit falls back to the static stage if that genuinely fired.
 */
export function caseStages(entry) {
  const staticDetected = entry.staticDetected === true;
  const runtimeConfirmed = entry.runtimeConfirmed === true;
  return {
    staticDetected,
    runtimeConfirmed,
    removedUnnecessary: entry.removedUnnecessary === true,
    fullPipelineDetected: staticDetected || runtimeConfirmed,
  };
}

/**
 * Aggregates stage measurements. `cases` is the applicable (non-skipped)
 * corpus; the denominator for every detection/deletion stage is the set of
 * applicable cases that carry at least one prelabelled unnecessary atom —
 * including conservative misses and failed cases (they count in the
 * denominator, never silently dropped).
 */
export function aggregateStages(cases) {
  const applicable = cases.filter((entry) => entry.skipped !== true);
  const denominator = applicable.filter((entry) => entry.hasUnnecessaryLabel === true);
  const stageOf = denominator.map((entry) => ({ id: entry.id, ...caseStages(entry) }));
  const stage = (pick) => {
    const hits = stageOf.filter((entry) => pick(entry));
    return {
      numerator: hits.length,
      denominator: stageOf.length,
      rate: stageOf.length === 0 ? undefined : hits.length / stageOf.length,
      missCases: stageOf.filter((entry) => !pick(entry)).map((entry) => entry.id),
    };
  };
  return {
    staticDetection: stage((entry) => entry.staticDetected),
    runtimeConfirmed: stage((entry) => entry.runtimeConfirmed),
    fullPipelineDetection: stage((entry) => entry.fullPipelineDetected),
    deletion: stage((entry) => entry.removedUnnecessary),
  };
}

/** Per-class breakdown of the same stages. */
export function perClassStages(cases, className) {
  return aggregateStages(cases.filter((entry) => entry.class === className));
}

/**
 * Precision: labelled-unnecessary removals / all removals. Zero denominator
 * is undefined, never 100%.
 */
export function removalPrecision(removedLabels) {
  const total = removedLabels.length;
  if (total === 0) return { numerator: 0, denominator: 0, rate: undefined };
  const unnecessary = removedLabels.filter((label) => label === "unnecessary").length;
  return { numerator: unnecessary, denominator: total, rate: unnecessary / total };
}

/**
 * Validates a {numerator, denominator, rate} measurement: safe nonnegative
 * integers (Number.isSafeInteger — the safe-count contract; counts beyond
 * 2^53-1 would silently break numerator/denominator arithmetic), numerator
 * <= denominator, rate finite in 0..1, and rate === numerator/denominator.
 * Zero denominator must be undefined (never 100%).
 * Returns null when valid, otherwise a failure string.
 */
export function validateMeasurement(name, measurement) {
  if (measurement === undefined || measurement === null || typeof measurement !== "object") {
    return `${name}: missing measurement`;
  }
  const { numerator, denominator, rate } = measurement;
  if (!Number.isSafeInteger(numerator) || numerator < 0) return `${name}: invalid numerator ${String(numerator)}`;
  if (!Number.isSafeInteger(denominator) || denominator < 0) return `${name}: invalid denominator ${String(denominator)}`;
  if (numerator > denominator) return `${name}: numerator ${numerator} > denominator ${denominator}`;
  if (denominator === 0) {
    return rate === undefined ? null : `${name}: zero denominator must be undefined, got ${String(rate)}`;
  }
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    return `${name}: rate ${String(rate)} is not finite in 0..1`;
  }
  if (Math.abs(rate - numerator / denominator) > 1e-9) {
    return `${name}: rate ${rate} does not equal ${numerator}/${denominator}`;
  }
  return null;
}

/** Full gate evaluation; returns a list of human-readable failures (empty = pass). */
export function evaluateGates({ stages, precision, finalOracle, hiddenRegressions, successfulReductionCases }) {
  const failures = [];
  // Fail closed on malformed statistics: NaN rates, impossible rates (>1),
  // negative or non-integer counts, numerator/denominator disagreement.
  for (const [name, measurement] of Object.entries(stages ?? {})) {
    const invalid = validateMeasurement(name, measurement);
    if (invalid !== null) failures.push(invalid);
  }
  const precisionInvalid = validateMeasurement("removalPrecision", precision);
  if (precisionInvalid !== null) failures.push(precisionInvalid);
  const oracleInvalid = validateMeasurement("independentFinalOracle", finalOracle);
  if (oracleInvalid !== null) failures.push(oracleInvalid);
  if (failures.length > 0) return failures;
  if (precision.rate === undefined || precision.rate < GATES.precision) {
    failures.push(
      `removal precision ${precision.rate === undefined ? "undefined (zero removals)" : (precision.rate * 100).toFixed(1) + "%"} < ${GATES.precision * 100}%`,
    );
  }
  const union = stages.fullPipelineDetection ?? {};
  if (union.rate === undefined || union.rate < GATES.fullPipelineDetection) {
    const staticRate = stages.staticDetection?.rate;
    failures.push(
      `full-pipeline detection (static UNION runtime-confirmed) ${union.rate === undefined ? "undefined" : (union.rate * 100).toFixed(1) + "%"} < ${GATES.fullPipelineDetection * 100}% (static alone ${staticRate === undefined ? "undefined" : (staticRate * 100).toFixed(1) + "%"})`,
    );
  }
  if (finalOracle.rate === undefined || finalOracle.rate < GATES.finalOracle) {
    failures.push(`independent final oracle ${finalOracle.rate === undefined ? "undefined" : (finalOracle.rate * 100).toFixed(1) + "%"} < 100%`);
  }
  if (hiddenRegressions !== GATES.hiddenRegressions) {
    failures.push(`hidden regressions ${hiddenRegressions} > 0`);
  }
  if (successfulReductionCases.length === 0) {
    failures.push("zero successful reduction cases (nonzero positive removals required)");
  }
  return failures;
}
