import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'yaml';

const rootArg = process.argv.indexOf('--root');
const root = path.resolve(rootArg < 0 ? 'knowledge/research' : process.argv[rootArg + 1]);
const errors = [];
const warnings = [];
const read = rel => {
  try { return parse(fs.readFileSync(path.join(root, rel), 'utf8')) ?? {}; }
  catch (error) { errors.push(`cannot read ${rel}: ${error.message}`); return {}; }
};
const registry = read('registry.yaml');
const sections = ['sources', 'claims', 'algorithms', 'projects', 'tickets', 'adrs', 'benchmarks'];
const sets = Object.fromEntries(sections.map(section => [section, new Set()]));
const records = new Map();
const registeredPaths = new Set();
const meaningful = value => typeof value === 'string' ? value.trim().length > 0 : Array.isArray(value) ? value.length > 0 && value.every(meaningful) : value && typeof value === 'object' ? Object.values(value).some(meaningful) : typeof value === 'number' && Number.isFinite(value);
const requireFields = (owner, card, fields) => {
  for (const field of fields) if (!meaningful(card[field])) errors.push(`${owner}: missing ${field}`);
};
const sourceStatuses = new Set(['SOURCE_VERIFIED_PRIMARY', 'SOURCE_VERIFIED_REPOSITORY', 'SOURCE_PARTIALLY_VERIFIED', 'SOURCE_UNVERIFIED', 'SOURCE_INVALID', 'SOURCE_SUPERSEDED']);
const verified = status => ['SOURCE_VERIFIED_PRIMARY', 'SOURCE_VERIFIED_REPOSITORY'].includes(status);
for (const section of sections) {
  if (!Array.isArray(registry[section])) errors.push(`${section}: registry section must be an array`);
  const paths = new Set();
  for (const entry of registry[section] ?? []) {
    if (!entry.id || !entry.path) { errors.push(`${section}: entry requires id and path`); continue; }
    if (sets[section].has(entry.id)) errors.push(`duplicate id ${entry.id} within ${section}`);
    if (paths.has(entry.path)) errors.push(`duplicate path ${entry.path} within ${section}`);
    sets[section].add(entry.id);
    paths.add(entry.path);
    registeredPaths.add(entry.path.replaceAll('\\', '/'));
    const absolute = path.resolve(root, entry.path);
    if (!absolute.startsWith(root + path.sep)) { errors.push(`${entry.id}: path escapes research root`); continue; }
    if (!fs.existsSync(absolute)) { errors.push(`${section}:${entry.id}: missing ${entry.path}`); continue; }
    if (section === 'adrs') { records.set(`${section}:${entry.id}`, fs.readFileSync(absolute, 'utf8')); continue; }
    const card = read(entry.path);
    records.set(`${section}:${entry.id}`, card);
    const cardId = card.id ?? (section === 'algorithms' ? card.name : undefined);
    if (cardId !== entry.id) errors.push(`${section}: id mismatch ${entry.id} != ${cardId}`);
  }
}
const checkRef = (owner, ref, section) => {
  if (!ref || !sets[section].has(ref)) errors.push(`${owner}: unresolved ${section} ref ${ref}`);
};
const refs = (owner, values, section) => {
  if (values === undefined) return;
  if (!Array.isArray(values)) { errors.push(`${owner}: ${section} references must be an array`); return; }
  for (const value of values) checkRef(owner, typeof value === 'object' ? value?.id : value, section);
};
const gateKeys = ['D1_SOURCE_VERIFIED', 'D2_CLAIMS_EXTRACTED', 'D3_LIMITATIONS_CAPTURED', 'D4_PATCHDIET_MAPPED', 'D5_DECISION_RECORDED', 'D6_TICKET_CREATED_IF_REQUIRED', 'D7_VALIDATED_IF_IMPLEMENTED'];
const gateSummary = [];
function checkGates(owner, card, sourceStatus) {
  const gates = card.distillation_gates;
  if (!gates) { errors.push(`${owner}: missing distillation_gates`); return; }
  for (let i = 0; i < gateKeys.length; i++) {
    const key = gateKeys[i];
    const legal = ['PASS', 'FAIL', ...(i === 5 ? ['D6_NOT_APPLICABLE'] : i === 6 ? ['D7_NOT_APPLICABLE'] : [])];
    if (!legal.includes(gates[key])) errors.push(`${owner}: invalid or missing ${key}: ${gates[key]}`);
  }
  if (sourceStatus && (gates.D1_SOURCE_VERIFIED === 'PASS') !== verified(sourceStatus)) errors.push(`${owner}: D1_SOURCE_VERIFIED contradicts ${sourceStatus}`);
  if (gates.D2_CLAIMS_EXTRACTED === 'PASS' && !meaningful(card.claims) && !meaningful(card.extracted_claims)) errors.push(`${owner}: D2_CLAIMS_EXTRACTED lacks claims or extracted_claims`);
  if (gates.D3_LIMITATIONS_CAPTURED === 'PASS' && !meaningful(card.limitations)) errors.push(`${owner}: D3_LIMITATIONS_CAPTURED lacks limitations`);
  if (gates.D4_PATCHDIET_MAPPED === 'PASS' && !meaningful(card.patchdiet_mapping ?? card.patchdiet_relevance ?? card.patchdiet_usage)) errors.push(`${owner}: D4_PATCHDIET_MAPPED lacks PatchDiet mapping`);
  if (gates.D5_DECISION_RECORDED === 'PASS' && !meaningful(card.status?.decision ?? card.decision ?? (typeof card.status === 'string' ? card.status : undefined))) errors.push(`${owner}: D5_DECISION_RECORDED lacks decision`);
  if (gates.D6_TICKET_CREATED_IF_REQUIRED === 'PASS' && !meaningful(card.ticket_refs)) errors.push(`${owner}: D6_TICKET_CREATED_IF_REQUIRED PASS lacks ticket_refs`);
  for (const n of [6, 7]) if (gates[gateKeys[n - 1]] === `D${n}_NOT_APPLICABLE` && !meaningful(card.gate_justifications?.[`D${n}`])) errors.push(`${owner}: D${n}_NOT_APPLICABLE lacks justification`);
  if (gates.D7_VALIDATED_IF_IMPLEMENTED === 'PASS' && !meaningful(card.validation_evidence ?? card.validation ?? card.tests)) errors.push(`${owner}: D7 PASS lacks validation evidence`);
  if (['DISTILLED_AND_APPLIED', 'RESEARCH_DISTILLATION_COMPLETE'].includes(card.status) && gateKeys.some(key => gates[key] !== 'PASS' && !String(gates[key]).endsWith('_NOT_APPLICABLE'))) errors.push(`${owner}: complete status with failed gates`);
  gateSummary.push({ id: owner, status: sourceStatus ?? card.status, gates, unresolved: gateKeys.filter(key => gates[key] === 'FAIL') });
}
for (const section of sections) for (const entry of registry[section] ?? []) {
  const card = records.get(`${section}:${entry.id}`);
  if (!card) continue;
  const owner = `${section}:${entry.id}`;
  if (section === 'adrs') {
    for (const match of card.matchAll(/\b((?:standard|paper|project|benchmark):[a-zA-Z0-9_.-]+)/g)) checkRef(owner, match[1], 'sources');
    for (const match of card.matchAll(/`(claim:[^`\s]+)`/g)) checkRef(owner, match[1], 'claims');
    continue;
  }
  refs(owner, card.source_refs, 'sources');
  refs(owner, card.original_sources, 'sources');
  refs(owner, card.algorithm_refs, 'algorithms');
  refs(owner, card.algorithms, 'algorithms');
  refs(owner, card.project_refs, 'projects');
  refs(owner, card.claim_refs, 'claims');
  refs(owner, card.ticket_refs, 'tickets');
  refs(owner, card.adr_refs, 'adrs');
  refs(owner, card.benchmark_refs, 'benchmarks');
  if (card.source?.id) checkRef(owner, card.source.id, 'sources');
  if (typeof card.source === 'string' && /^(paper|project|standard|benchmark):/.test(card.source)) checkRef(owner, card.source, 'sources');
  if (Array.isArray(card.source)) refs(owner, card.source, 'sources');
  for (const [key, target] of Object.entries({ sources: 'sources', claims: 'claims', algorithms: 'algorithms', projects: 'projects', tickets: 'tickets', adrs: 'adrs', benchmarks: 'benchmarks' })) refs(owner, card.research_basis?.[key], target);
  for (const dependency of card.dependencies ?? []) if (/^PD-[RE]\d+$/.test(dependency)) checkRef(owner, dependency, 'tickets');
  if (section === 'sources') {
    refs(owner, card.claims, 'claims');
    const status = card.verification_status;
    if (!sourceStatuses.has(status)) errors.push(`${owner}: invalid verification_status ${status}`);
    if (status !== entry.status) errors.push(`${owner}: registry/card status mismatch ${entry.status} != ${status}`);
    if (card.status?.source_verified !== verified(status)) errors.push(`${owner}: source_verified contradicts ${status}`);
    if (status === 'SOURCE_VERIFIED_REPOSITORY') {
      requireFields(owner, card, ['repository', 'license', 'license_path', 'license_scope', 'inspected_commit', 'commit_date', 'retrieved_at', 'project_status']);
      if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(card.inspected_commit ?? '')) errors.push(`${owner}: inspected_commit must be an immutable full hash`);
      if (/UNKNOWN|NOT_VERIFIED|PENDING|MANUAL_REVIEW_REQUIRED/i.test(card.license ?? '')) errors.push(`${owner}: license is not verified`);
      if (meaningful(card.commit_date) && Number.isNaN(Date.parse(card.commit_date))) errors.push(`${owner}: invalid commit_date`);
      if (meaningful(card.retrieved_at) && !/^\d{4}-\d{2}-\d{2}/.test(card.retrieved_at)) errors.push(`${owner}: invalid retrieved_at`);
    }
    if (status === 'SOURCE_VERIFIED_PRIMARY') {
      requireFields(owner, card, ['title', 'authors', 'year', 'venue', 'canonical_url', 'paper_version_used']);
      if (!meaningful(card.inspection?.url)) errors.push(`${owner}: missing primary inspection.url`);
    }
    if (verified(status) && /dataset/.test(card.source_type ?? '')) {
      requireFields(owner, card, ['official_source', 'dataset_version', 'license', 'data_use_constraints', 'redistribution_limits', 'privacy_constraints', 'sampling_limitations']);
    }
    if (card.repository_evidence) {
      const evidenceRefs = Array.isArray(card.repository_evidence) ? card.repository_evidence : [card.repository_evidence];
      const captured = [];
      for (const evidenceRef of evidenceRefs) try {
        const file = path.join(root, evidenceRef);
        const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
        captured.push(evidence);
        for (const [field, content] of [['license_sha256', evidence.license_text]]) {
          if (evidence[field] && content && crypto.createHash('sha256').update(content).digest('hex') !== evidence[field]) errors.push(`${owner}: evidence ${field} mismatch`);
        }
      } catch (error) { errors.push(`${owner}: cannot inspect repository_evidence: ${error.message}`); }
      if (captured.length && !captured.some(evidence => {
        const evidenceCommit = evidence.inspected_commit ?? evidence.sha ?? evidence.commit?.sha;
        const evidencePath = evidence.license_path ?? evidence.path ?? evidence.name;
        return card.inspected_commit === evidenceCommit && (card.license_path === evidencePath || evidencePath === undefined || evidencePath === null || evidencePath === 'LICENSE.txt');
      })) errors.push(`${owner}: repository evidence commit/license mismatch`);
    }
    checkGates(owner, card, status);
  }
  if (section === 'claims') {
    checkRef(owner, entry.source, 'sources');
    if (entry.source !== card.source?.id) errors.push(`${owner}: registry/card source mismatch`);
    requireFields(owner, card, ['statement', 'limitations', 'patchdiet_mapping']);
    if (card.automatic_removal_authority !== false) errors.push(`${owner}: automatic_removal_authority must be false`);
  }
  if (section === 'algorithms' || section === 'projects' || section === 'benchmarks') {
    checkGates(owner, card);
    const basis = card.source_refs ?? card.original_sources ?? (Array.isArray(card.source) ? card.source : typeof card.source === 'string' && card.source.includes(':') ? [card.source] : []);
    if (card.distillation_gates?.D1_SOURCE_VERIFIED === 'PASS' && (!basis.length || basis.some(id => !verified(records.get(`sources:${id}`)?.verification_status)))) errors.push(`${owner}: D1_SOURCE_VERIFIED PASS lacks verified source basis`);
  }
  if (section === 'tickets' && card.automatic_removal_authority === true) errors.push(`${owner}: research ticket cannot grant automatic removal authority`);
}
// Detect source/claim/card files omitted from the registry, excluding raw evidence and archived reports.
function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['evidence', 'reports', 'adr'].includes(entry.name) && directory === root) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) { scan(absolute); continue; }
    if (!/\.ya?ml$/.test(entry.name) || absolute === path.join(root, 'registry.yaml')) continue;
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    if (registeredPaths.has(relative)) continue;
    const card = read(relative);
    if (card.id && (card.verification_status || /^(paper|project|standard|benchmark|claim|source):/.test(card.id) || /^PD-[RE]\d+$/.test(card.id))) errors.push(`unregistered record ${card.id}: ${relative}`);
  }
}
scan(root);
const uniqueErrors = [...new Set(errors)];
const output = {
  validated_at: new Date().toISOString(), registry_version: registry.registry_version,
  errors: uniqueErrors, warnings, counts: Object.fromEntries(sections.map(section => [section, (registry[section] ?? []).length])),
  source_gate_summary: gateSummary,
  unresolved_gate_count: gateSummary.reduce((sum, row) => sum + row.unresolved.length, 0),
  research_complete: false, experiments_authorized: false,
  scope: 'Internal references, required provenance fields and gate consistency only. Explicit failed research gates remain blockers for independent review. This report never authorizes experiments.',
  final_status: uniqueErrors.length || warnings.length ? 'RESEARCH_PARTIAL' : 'RESEARCH_INTEGRITY_VALIDATED'
};
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/RESEARCH_INTEGRITY_VALIDATION.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ errors: uniqueErrors.length, warnings: warnings.length, unresolved_gates: output.unresolved_gate_count, final_status: output.final_status, report: path.join(root, 'reports/RESEARCH_INTEGRITY_VALIDATION.json') }));
process.exitCode = uniqueErrors.length || warnings.length ? 2 : 0;
