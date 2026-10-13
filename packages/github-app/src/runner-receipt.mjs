import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/u;
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function regular(path, max) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > max) throw new Error("Runner artifact is redirected, hardlinked or oversized");
  return readFileSync(path);
}
function commit(root, ref) {
  return execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
    { cwd: root, encoding: "utf8", timeout: 5000, maxBuffer: 128 * 1024, windowsHide: true }).trim();
}
function validContext(context) {
  if (!/^preview-[1-9][0-9]*$/u.test(context?.jobId ?? "") || !NAME.test(context?.owner ?? "") || !NAME.test(context?.repo ?? "") ||
      !Number.isSafeInteger(context?.repositoryId) || context.repositoryId < 1 || !Number.isSafeInteger(context?.installationId) || context.installationId < 1 ||
      !Number.isSafeInteger(context?.pullNumber) || context.pullNumber < 1 || !SHA.test(context?.baseSha ?? "") || !SHA.test(context?.headSha ?? "")) {
    throw new Error("Invalid runner job and repository identity");
  }
}

/** Call only from a trusted isolated runner after a fresh shrink invocation. */
export function buildSignedRunnerReceipt({ cwd, context, secret, cleanupCommitSha } = {}) {
  validContext(context);
  if (typeof secret !== "string" || secret.length < 8) throw new Error("Runner receipt signing secret is required");
  if (cleanupCommitSha !== undefined && !SHA.test(cleanupCommitSha)) throw new Error("Invalid cleanup commit SHA");
  const root = realpathSync(resolve(cwd));
  const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"],
    { cwd: root, encoding: "utf8", timeout: 5000, maxBuffer: 128 * 1024, windowsHide: true }).trim();
  if (realpathSync(gitRoot) !== root) throw new Error("Runner must execute at repository root");
  const artifactDir = join(root, ".patchdiet");
  const dirStat = lstatSync(artifactDir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error("Runner artifact directory is redirected");
  const reportBytes = regular(join(artifactDir, "run.json"), 4 * 1024 * 1024);
  const patchBytes = regular(join(artifactDir, "cleanup.diff"), 20 * 1024 * 1024);
  const report = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(reportBytes));
  if (!DIGEST.test(report.cleanupDiffSha256 ?? "") || hash(patchBytes) !== report.cleanupDiffSha256) throw new Error("Cleanup patch hash does not match emitted report");
  const baseline = report.verification?.baseline;
  const final = report.verification?.final;
  if (report.mode !== "verified" || report.partial === true || baseline?.stage !== "baseline" || final?.stage !== "final" ||
      baseline.status !== "passed" || final.status !== "passed" || final.treesMatch !== true ||
      !SHA.test(final.artifactTreeSha ?? "") || final.artifactTreeSha !== final.expectedTreeSha ||
      baseline.baseCommitSha !== report.baseCommitSha || final.baseCommitSha !== report.baseCommitSha ||
      baseline.headCommitSha !== report.headCommitSha || final.headCommitSha !== report.headCommitSha ||
      !Array.isArray(final.commands) || final.commands.length < 1 || final.commands.some((command) => command.status !== "passed" || command.exitCode !== 0)) {
    throw new Error("Report has no attested exact-artifact final oracle verification");
  }
  if (!SHA.test(report.baseCommitSha ?? "") || !SHA.test(report.headCommitSha ?? "") ||
      report.baseCommitSha !== context.baseSha || report.headCommitSha !== context.headSha ||
      typeof report.baseRef !== "string" || typeof report.headRef !== "string" ||
      commit(root, report.baseRef) !== report.baseCommitSha || commit(root, report.headRef) !== report.headCommitSha) {
    throw new Error("Runner report Git identity differs from pinned job or current refs");
  }
  const ordinal = report.candidates?.findIndex((candidate) => candidate?.verdict === "removed" && DIGEST.test(candidate?.contentSha256 ?? "")) ?? -1;
  const candidate = ordinal >= 0 ? report.candidates[ordinal] : null;
  const safePath = candidate && typeof candidate.filePath === "string" && /^[A-Za-z0-9_./-]{1,255}$/u.test(candidate.filePath) &&
    !candidate.filePath.startsWith("/") && candidate.filePath.split("/").every((part) => part && part !== "." && part !== "..");
  const line = safePath ? /\+([1-9][0-9]*)/u.exec(candidate.hunkHeader ?? "") : null;
  const annotations = line ? [{ path: candidate.filePath, startLine: Number(line[1]), endLine: Number(line[1]), message: String(candidate.reason ?? "Review verified cleanup candidate").slice(0, 500) }] : [];
  const receipt = {
    jobId: context.jobId, owner: context.owner, repo: context.repo, repositoryId: context.repositoryId,
    installationId: context.installationId, pullNumber: context.pullNumber, baseSha: context.baseSha, headSha: context.headSha,
    reportSha256: hash(reportBytes), cleanupDiffSha256: hash(patchBytes),
    ...(cleanupCommitSha ? { cleanupCommitSha } : {}),
    verification: { exactArtifact: true, finalOraclePassed: true },
    annotations,
    candidates: candidate && safePath ? [{ id: `candidate-${ordinal}`, contentSha256: candidate.contentSha256 }] : []
  };
  const body = JSON.stringify(receipt);
  return { receipt, body, signature: `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` };
}
