// One-time, reviewable migration of the legacy research ledger.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';

const root = path.resolve('knowledge/research');
const read = async p => parse(await fs.readFile(path.join(root, p), 'utf8'));
const write = async (p, value) => fs.writeFile(path.join(root, p), stringify(value, { lineWidth: 120 }));
const registry = await read('registry.yaml');
const snapshot = 'reports/PRE_CORRECTION_RECORDS.json';
try { await fs.access(path.join(root, snapshot)); throw new Error('Migration already started: inspect saved records instead of overwriting history'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const before = {};
for (const section of ['sources', 'algorithms', 'projects', 'claims', 'tickets']) {
  for (const entry of registry[section]) before[entry.path] = await read(entry.path);
}
await fs.writeFile(path.join(root, snapshot), JSON.stringify({ registry, records: before }, null, 2) + '\n');

const primaryEvidence = {
  'standard:sarif-2.1.0': ['OASIS Standard 27 March 2020', 'Sections 3.27 results and 3.28 locations; findings representation, not proof', 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html'],
  'standard:git-diff-format': ['Git diff-format 2.55.0', 'Generating patch text with -p; Combined diff format', 'https://git-scm.com/docs/diff-format/2.55.0'],
  'standard:git-apply': ['Git git-apply 2.51.0', 'DESCRIPTION; --check; --index; SUBMODULES; application is distinct from behavioral validation', 'https://git-scm.com/docs/git-apply/2.51.0'],
  'standard:nist-ssdf-1.1': ['NIST SP 800-218 final, February 2022', 'Publication authors and abstract; SSDF practices in the final PDF; no certification claim', 'https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-218.pdf'],
  'paper:perses-icse-2018': ['ICSE 2018 author manuscript, 11 pages', 'Title page; sections 2–4 syntax guidance; section 5 C/Java evaluation only', 'https://web.cs.ucdavis.edu/~su/publications/perses.pdf'],
  'paper:microsoft-modern-code-review-2013': ['ICSE 2013 author manuscript, 10 pages', 'Title page author order and abstract; organizational case study, no deletion correctness claim', 'https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ICSE202013-codereview.pdf'],
  'paper:google-modern-code-review-2018': ['ICSE-SEIP 2018 author manuscript, 10 pages', 'Title page, abstract, DOI; interviews/survey/logs describe Google practices', 'https://storage.googleapis.com/gweb-research2023-media/pubtools/4476.pdf']
};
const audits = [];
for (const entry of registry.sources) {
  const source = before[entry.path];
  const previous = structuredClone(source);
  let status = 'SOURCE_PARTIALLY_VERIFIED';
  let reason = 'Legacy metadata does not establish content-level verification; missing fixed provenance.';
  const evidence = primaryEvidence[entry.id];
  if (evidence) {
    status = 'SOURCE_VERIFIED_PRIMARY';
    source.paper_version_used = evidence[0];
    source.inspection = { retrieved_at: '2026-10-26', url: evidence[2], locators: [evidence[1]], scope: 'Only recorded, bounded claims; independent review pending' };
    reason = 'Primary content inspected at listed locators; not merely a webpage existence check.';
  }
  if (source.repository) reason = 'DOWNGRADED: prior branch/date string is not an inspected commit. New captures require separate license/content review.';
  if (entry.id.includes('rothermel')) reason = 'Publisher HTTP 403; bibliographic identity known, original content verification remains open.';
  if (entry.id === 'paper:microsoft-modern-code-review-2013') source.authors = ['Alberto Bacchelli', 'Christian Bird'];
  if (entry.id === 'paper:google-modern-code-review-2018') source.doi = '10.1145/3183519.3183525';
  source.primary_secondary = source.repository ? 'primary-repository' : 'primary';
  source.verification_status = status;
  source.status.source_verified = status === 'SOURCE_VERIFIED_PRIMARY';
  source.status.distilled = false;
  source.provenance_audit = { ticket: 'PD-R100', previous_status: entry.status, previous_pin: previous.license_verified_at_commit ?? null, reason, historical_record: snapshot };
  if (source.repository) {
    delete source.license_verified_at_commit;
    source.license_review = { status: 'NOT_VERIFIED_AT_FIXED_COMMIT', reported_license: previous.license, code_copy_allowed: false };
  }
  source.distillation_gates = {
    D1_SOURCE_VERIFIED: source.status.source_verified ? 'PASS' : 'FAIL', D2_CLAIMS_EXTRACTED: 'FAIL',
    D3_LIMITATIONS_CAPTURED: source.limitations?.length ? 'PASS' : 'FAIL', D4_PATCHDIET_MAPPED: source.patchdiet_relevance ? 'PASS' : 'FAIL',
    D5_DECISION_RECORDED: source.status.decision ? 'PASS' : 'FAIL', D6_TICKET_CREATED_IF_REQUIRED: 'FAIL', D7_VALIDATED_IF_IMPLEMENTED: 'FAIL'
  };
  entry.status = status;
  audits.push({ id: entry.id, path: entry.path, title: source.title, authors: source.authors ?? [], year: source.year ?? null, venue: source.venue ?? null, doi: source.doi ?? null, canonical_url: source.canonical_url, source_type: source.source_type, authority_tier: source.authority_tier, primary_secondary: source.primary_secondary, retrieved_at: source.retrieved_at, license: source.license ?? null, repository: source.repository ?? null, inspected_commit: null, paper_version_used: source.paper_version_used ?? null, claim_references: source.claims ?? [], previous_status: 'SOURCE_VERIFIED', status, reason, missing: [!source.venue && source.source_type === 'peer-reviewed-paper' ? 'venue' : null, source.repository ? 'inspected commit and pinned license review' : null, entry.id.includes('rothermel') ? 'original paper content' : null].filter(Boolean) });
  await write(entry.path, source);
}
for (const entry of registry.projects) {
  const card = before[entry.path];
  card.source_refs = [entry.id];
  card.provenance_status = 'SOURCE_PARTIALLY_VERIFIED';
  card.previous_license_verified_at_commit = card.license_verified_at_commit ?? null;
  delete card.license_verified_at_commit;
  card.license_review_status = 'NOT_VERIFIED_AT_FIXED_COMMIT';
  card.distillation_gates = { D1_SOURCE_VERIFIED: 'FAIL', D2_CLAIMS_EXTRACTED: 'FAIL', D3_LIMITATIONS_CAPTURED: 'PASS', D4_PATCHDIET_MAPPED: 'PASS', D5_DECISION_RECORDED: 'PASS', D6_TICKET_CREATED_IF_REQUIRED: 'FAIL', D7_VALIDATED_IF_IMPLEMENTED: 'FAIL' };
  await write(entry.path, card);
}
for (const entry of registry.algorithms) entry.status = 'NOT_VERIFIED';
registry.research_status = 'RESEARCH_DISTILLATION_PARTIAL';
registry.engineering_status = 'ENGINEERING_EVIDENCE_NOT_YET_CLOSED';
await write('registry.yaml', registry);
await fs.writeFile(path.join(root, 'reports/SOURCE_REGISTRY_AUDIT.json'), JSON.stringify({ ticket: 'PD-R100', audited_at: '2026-10-26', sources: audits }, null, 2) + '\n');
await fs.writeFile(path.join(root, 'reports/SOURCE_REGISTRY_AUDIT.md'), '# PD-R100 — Source registry forensic audit\n\nInitial forensic classification of every one of the 20 legacy sources. Repository sources are downgraded first; any later re-verification must cite a fixed capture. Original records are preserved in PRE_CORRECTION_RECORDS.json.\n\n| Source | Classification | Reason |\n| --- | --- | --- |\n' + audits.map(a => `| ${a.id} | ${a.status} | ${a.reason} |`).join('\n') + '\n\nAll requested metadata fields, missing fields and claim references are recorded per source in SOURCE_REGISTRY_AUDIT.json. Missing venue for repositories is not a paper venue; repo founding year is unverified historical metadata. This report does not assert research distillation or license closure.\n');
console.log(JSON.stringify({ audited: audits.length, primary: audits.filter(a => a.status === 'SOURCE_VERIFIED_PRIMARY').length, partial: audits.filter(a => a.status === 'SOURCE_PARTIALLY_VERIFIED').length }));
