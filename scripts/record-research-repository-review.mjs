// Records the manual license/README inspection of captured immutable artifacts.
import fs from 'node:fs/promises';
import { parse, stringify } from 'yaml';
const root = 'knowledge/research/';
const registry = parse(await fs.readFile(root + 'registry.yaml', 'utf8'));
const rows = [];
for (const entry of registry.sources) {
  const source = parse(await fs.readFile(root + entry.path, 'utf8'));
  if (!source.repository) continue;
  const evidencePath = `evidence/repositories/${entry.id.replaceAll(':', '-')}.json`;
  const evidence = JSON.parse(await fs.readFile(root + evidencePath, 'utf8'));
  if (evidence.error || !evidence.readme_sha256 || !evidence.license_sha256) {
    rows.push(`| ${entry.id} | SOURCE_PARTIALLY_VERIFIED | ${evidence.error ?? 'missing artifact'} |`);
    continue;
  }
  if (entry.id === 'project:picire') {
    evidence.license_type = 'BSD-3-Clause AND LicenseRef-Zeller-legacy-notice';
    evidence.manual_license_note = 'BSD three-clause terms followed by a historical Zeller public-domain/patent notice. No patent clearance inferred; no code copied.';
    await fs.writeFile(root + evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  }
  source.inspected_commit = evidence.inspected_commit;
  source.license_verified_at_commit = evidence.inspected_commit;
  source.license_path = evidence.license_path;
  source.license = evidence.license_type;
  source.license_type = evidence.license_type;
  source.repository_evidence = evidencePath;
  source.inspection = { retrieved_at: evidence.retrieved_at, url: evidence.license_url, locators: [evidence.license_path, evidence.readme_url], scope: 'Repository identity, root license text and README-level architecture. No claims about uninspected implementation correctness.' };
  source.verification_status = 'SOURCE_VERIFIED_REPOSITORY';
  source.status.source_verified = true;
  source.status.distilled = false;
  source.license_review = { status: 'ROOT_LICENSE_INSPECTED_AT_COMMIT', code_copy_allowed: false, note: evidence.manual_license_note ?? 'Research summaries only. Dependencies, subcomponents and any future copied files require their own notices review.' };
  source.distillation_gates.D1_SOURCE_VERIFIED = 'PASS';
  if (entry.id === 'benchmark:swe-bench') {
    source.title = 'SWE-bench official benchmark repository';
    source.authors = ['SWE-bench contributors'];
    source.year = 2023;
    source.paper_version_used = null;
    source.inspection.scope += ' Paper authors/experimental results are separate evidence, not inferred from repository authors.';
  }
  await fs.writeFile(root + entry.path, stringify(source, { lineWidth: 120 }));
  entry.status = source.verification_status;
  const projectEntry = registry.projects.find(project => project.id === entry.id);
  if (projectEntry) {
    const project = parse(await fs.readFile(root + projectEntry.path, 'utf8'));
    Object.assign(project, { inspected_commit: evidence.inspected_commit, license_verified_at_commit: evidence.inspected_commit, retrieved_at: evidence.retrieved_at, license_path: evidence.license_path, license: evidence.license_type, license_type: evidence.license_type, repository_evidence: evidencePath, provenance_status: source.verification_status, license_review_status: 'ROOT_LICENSE_INSPECTED_AT_COMMIT' });
    project.distillation_gates.D1_SOURCE_VERIFIED = 'PASS';
    await fs.writeFile(root + projectEntry.path, stringify(project, { lineWidth: 120 }));
  }
  rows.push(`| ${entry.id} | ${evidence.inspected_commit} | ${evidence.license_path}: ${evidence.license_type} |`);
}
await fs.writeFile(root + 'registry.yaml', stringify(registry, { lineWidth: 120 }));
await fs.writeFile(root + 'reports/REPOSITORY_LICENSE_REVIEW.md', '# Fixed repository provenance review\n\nDate: 2026-10-26 (America/Los_Angeles). This is new evidence following the mandatory downgrade of all legacy unpinned repositories. Immutable artifacts include complete root license text and SHA-256 hashes of license/README. Scope is repository verification, not complete research distillation or universal code reuse permission.\n\n| Source | Inspected commit | Root license |\n| --- | --- | --- |\n' + rows.join('\n') + '\n\nC-Reduce uses University of Illinois/NCSA terms, not MIT. Picire includes BSD-3-Clause terms plus a historical upstream notice; do not discard that notice. Dates in UTC may be 2026-10-27 while the retrieval date in America/Los_Angeles is 2026-10-26.\n');
console.log(JSON.stringify({ repository_reviews: rows.length }));
