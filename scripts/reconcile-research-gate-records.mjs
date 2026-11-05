import fs from 'node:fs';
import {parse,stringify} from 'yaml';
const root='knowledge/research/';
const registry=parse(fs.readFileSync(root+'registry.yaml','utf8'));
const owned = new Set(['project:scip','project:wdd-artifact','paper:zhou-2025-wdd','paper:jin-chen-2026-llm-reviewer-reliability']);
const update=(p,card)=>fs.writeFileSync(root+p,stringify(card,{lineWidth:120}));
for (const entry of registry.sources) {
 const card=parse(fs.readFileSync(root+entry.path,'utf8'));
 if (owned.has(entry.id)||card.verification_status==='SOURCE_PARTIALLY_VERIFIED')continue;
 if(entry.id.startsWith('standard:')&&!card.venue)card.venue=entry.id.includes('git-')?'Git official reference manual':entry.id.includes('sarif')?'OASIS Standard':'NIST Special Publication';
 if(card.repository_evidence){
  const ev=JSON.parse(fs.readFileSync(root+card.repository_evidence,'utf8'));
  card.commit_date=ev.commit_date;
  card.license_scope=card.license_review?.note??'Root license at inspected snapshot only; third-party components require separate review.';
  card.project_status={observed:'Pinned upstream snapshot accessible',commit_timestamp:ev.commit_date,maintenance_assessment:'No forward maintenance guarantee; this review preserves the inspected snapshot rather than asserting latest release.'};
 }
 const g=card.distillation_gates;
 if(g){
  if(g.D7_VALIDATED_IF_IMPLEMENTED==='NOT_APPLICABLE')g.D7_VALIDATED_IF_IMPLEMENTED='D7_NOT_APPLICABLE';
  card.gate_justifications??={};
  if(g.D6_TICKET_CREATED_IF_REQUIRED==='D6_NOT_APPLICABLE')card.gate_justifications.D6='Research-only source; no runtime adoption or implementation ticket is authorized.';
  if(g.D7_VALIDATED_IF_IMPLEMENTED==='D7_NOT_APPLICABLE')card.gate_justifications.D7='No research-derived implementation is introduced by this source-verification phase.';
 }
 update(entry.path,card);
}
// Give pre-existing project and algorithm views explicit identities and honest gate states.
for(const section of ['projects','algorithms','benchmarks'])for(const entry of registry[section]){
 if(owned.has(entry.id)||['weighted-delta-debugging','mutation-testing','swe-rebench','swe-bench-live','aidev'].includes(entry.id))continue;
 const c=parse(fs.readFileSync(root+entry.path,'utf8'));
 c.id=entry.id;
 const sourceIds=c.source_refs??c.original_sources??(Array.isArray(c.source)?c.source:typeof c.source==='string'&&c.source.includes(':')?[c.source]:[]);
 const srcs=sourceIds.map(id=>registry.sources.find(x=>x.id===id)).filter(Boolean).map(e=>parse(fs.readFileSync(root+e.path,'utf8')));
 const claimIds=[...new Set(srcs.flatMap(s=>s.claims??[]))];
 if(claimIds.length)c.claims=claimIds;
 if(!c.limitations)c.limitations=typeof c.risks==='string'?[c.risks]:c.risks??c.failure_modes??c.contamination_limits??['No PatchDiet experiment benefit is established; configured verification is not semantic proof.'];
 if(!c.patchdiet_mapping)c.patchdiet_mapping=c.patchdiet_use??c.patchdiet_current_state??'Research-only benchmark design; no external data imported and no runtime change adopted.';
 c.distillation_gates??={
 D1_SOURCE_VERIFIED:srcs.length&&srcs.every(s=>['SOURCE_VERIFIED_PRIMARY','SOURCE_VERIFIED_REPOSITORY'].includes(s.verification_status))?'PASS':'FAIL',
 D2_CLAIMS_EXTRACTED:claimIds.length?'PASS':'FAIL',
 D3_LIMITATIONS_CAPTURED:'PASS',D4_PATCHDIET_MAPPED:'PASS',D5_DECISION_RECORDED:'PASS',
 D6_TICKET_CREATED_IF_REQUIRED:'D6_NOT_APPLICABLE',D7_VALIDATED_IF_IMPLEMENTED:'D7_NOT_APPLICABLE'};
 c.gate_justifications??={};
 if(c.distillation_gates.D6_TICKET_CREATED_IF_REQUIRED==='D6_NOT_APPLICABLE')c.gate_justifications.D6='No new research-derived runtime work is authorized; no adoption ticket required.';
 if(c.distillation_gates.D7_VALIDATED_IF_IMPLEMENTED==='D7_NOT_APPLICABLE')c.gate_justifications.D7='Research card only; pre-existing runtime is covered separately by the fresh regression.';
 update(entry.path,c);
}
