import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {stringify} from 'yaml';

// Reviewer-owned synthetic registry tests; no production or research-source edits.
const gates = {D1_SOURCE_VERIFIED:'PASS',D2_CLAIMS_EXTRACTED:'PASS',D3_LIMITATIONS_CAPTURED:'PASS',D4_PATCHDIET_MAPPED:'PASS',D5_DECISION_RECORDED:'PASS',D6_TICKET_CREATED_IF_REQUIRED:'D6_NOT_APPLICABLE',D7_VALIDATED_IF_IMPLEMENTED:'D7_NOT_APPLICABLE'};
function fixture() {
  return {
    registry:{registry_version:1,sources:[{id:'paper:test',path:'source.yaml',status:'SOURCE_VERIFIED_PRIMARY'}],claims:[{id:'claim:test',path:'claim.yaml',source:'paper:test'}],algorithms:[],projects:[],tickets:[],adrs:[],benchmarks:[]},
    records:{'source.yaml':{id:'paper:test',title:'Synthetic primary',authors:['Test'],year:2026,venue:'Test',canonical_url:'https://example.org/paper',paper_version_used:'v1',inspection:{url:'https://example.org/paper',locators:['section 1']},source_type:'peer-reviewed-paper',retrieved_at:'2026-10-27',verification_status:'SOURCE_VERIFIED_PRIMARY',status:{source_verified:true,decision:'RESEARCH_ONLY'},claims:['claim:test'],limitations:['Bounded'],patchdiet_mapping:'Research only',distillation_gates:{...gates},gate_justifications:{D6:'No implementation',D7:'No implementation'}},'claim.yaml':{id:'claim:test',source:{id:'paper:test'},statement:'Bounded',limitations:['Bounded'],patchdiet_mapping:'Research only',automatic_removal_authority:false}}
  };
}
const cases = {
  baseline:()=>{},
  primary_missing_retrieval:(_,r)=>{delete r['source.yaml'].retrieved_at;},
  algorithm_dangling_claim:(reg,r)=>{reg.algorithms.push({id:'test-algorithm',path:'algorithm.yaml'});r['algorithm.yaml']={name:'test-algorithm',original_sources:['paper:test'],claims:['claim:nonexistent'],limitations:['Bounded'],patchdiet_mapping:'Research',status:'RESEARCH_ONLY',distillation_gates:{...gates},gate_justifications:{D6:'No implementation',D7:'No implementation'}};},
  implemented_unvalidated_D7:(reg,r)=>{reg.projects.push({id:'project:test',path:'project.yaml'});r['project.yaml']={id:'project:test',source_refs:['paper:test'],claims:['claim:test'],limitations:['Bounded'],patchdiet_mapping:'Runtime implementation',status:'ALREADY_IMPLEMENTED',distillation_gates:{...gates},gate_justifications:{D6:'No ticket',D7:'No implementation'},implemented:true};},
  repository_missing_license_type:(reg,r)=>{reg.sources[0].status='SOURCE_VERIFIED_REPOSITORY';Object.assign(r['source.yaml'],{verification_status:'SOURCE_VERIFIED_REPOSITORY',repository:'https://github.com/example/test',license:'MIT',license_path:'LICENSE',license_scope:'Root code',inspected_commit:'a'.repeat(40),commit_date:'2026-10-27T00:00:00Z',project_status:'Active'});}
};
const results=[];
for(const [name, mutate] of Object.entries(cases)) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'patchdiet-reviewer-v2-'));
  try {
    const {registry,records}=fixture(); mutate(registry,records);
    fs.writeFileSync(path.join(temp,'registry.yaml'),stringify(registry));
    for(const [file,card] of Object.entries(records))fs.writeFileSync(path.join(temp,file),stringify(card));
    const run=spawnSync(process.execPath,[path.resolve('scripts/validate-research-integrity.mjs'),'--root',temp],{encoding:'utf8',windowsHide:true});
    const report=JSON.parse(fs.readFileSync(path.join(temp,'reports/RESEARCH_INTEGRITY_VALIDATION.json'),'utf8'));
    results.push({name,exit:run.status,errors:report.errors,experiments_authorized:report.experiments_authorized});
  } finally {
    const resolved=path.resolve(temp),prefix=path.resolve(os.tmpdir())+path.sep;
    if(!resolved.startsWith(prefix)||!path.basename(resolved).startsWith('patchdiet-reviewer-v2-'))throw new Error('Unsafe cleanup target');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
}
const output={review_date:'2026-10-27',scope:'Synthetic validator adversarial fixtures only; no experiments or data import',results};
fs.writeFileSync('knowledge/research/evidence/reviewer-v2-validator-probes.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
