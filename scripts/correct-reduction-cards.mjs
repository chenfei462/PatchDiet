// Evidence-backed correction; old cards remain in reports/PRE_CORRECTION_RECORDS.json.
import fs from 'node:fs/promises';
import { parse, stringify } from 'yaml';
const root = 'knowledge/research/';
const registry = parse(await fs.readFile(root + 'registry.yaml', 'utf8'));
const save = async (p, data) => fs.writeFile(root + p, stringify(data, { lineWidth: 120 }));
const specs = [
  {
    ticket: 'PD-R102', slug: 'ddmin', algorithmId: 'ddmin', id: 'paper:zeller-hildebrandt-2002-ddmin',
    title: 'Simplifying and Isolating Failure-Inducing Input', authors: ['Andreas Zeller', 'Ralf Hildebrandt'], year: 2002,
    venue: 'IEEE Transactions on Software Engineering 28(2), 183–200', doi: '10.1109/32.988498',
    canonical: 'https://doi.org/10.1109/32.988498', inspected: 'https://www.cs.toronto.edu/~chechik/courses18/csc410/delta-debugging.pdf',
    version: 'TSE February 2002 author manuscript, 17 pages; university-hosted copy', locators: ['Definitions 8–10', 'Figure 5', 'Propositions 11–13', 'Figure 15 and section V'],
    problem: 'Minimize an input that retains an observed failure using a test function.',
    input: 'Finite ordered changes C with test(C)=FAIL and test(empty)=PASS; outcomes PASS, FAIL, UNRESOLVED.',
    output: 'A failure-inducing 1-minimal configuration after an unbudgeted completed ddmin run.',
    algorithm: 'Partition C into n approximately equal-count subsets; test subsets first, then complements; shrink on FAIL, otherwise increase granularity.',
    pseudocode: 'C = initial; n = 2\nwhile size(C) >= 2:\n  parts = split_by_count(C, n)\n  if a part S has test(S) == FAIL: C = S; n = 2; continue\n  if a complement C-S has test(C-S) == FAIL: C = C-S; n = max(n-1, 2); continue\n  if n == size(C): return C\n  n = min(2*n, size(C))\nreturn C\n',
    complexity: 'Oracle queries: O(n²) worst case (n²+3n bound in Proposition 12); O(log n) special best case (Proposition 13).',
    termination: 'Finite input and terminating tests; accepted steps strictly shrink; unsuccessful steps increase granularity to singletons. Budget interruption removes the minimality guarantee.',
    correctness: '1-minimal means no single retained element can be deleted while still observing FAIL. UNRESOLVED means failure not reproduced, not proof of passing. Monotonicity is not required for this local guarantee.',
    assumptions: ['stable test outcomes', 'finite atomization', 'test(empty)=PASS and test(initial)=FAIL', 'each oracle execution terminates'],
    limitations: ['Not subset-minimal for non-monotone tests', 'Not globally minimum-size', 'No semantic equivalence proof', 'Budgeted/flaky execution cannot inherit completed-run guarantee'],
    distinctions: { one_minimal: 'No one-element deletion preserves the property.', subset_minimal: 'No strict subset preserves the property; stronger than 1-minimal in a non-monotone model.', globally_minimal: 'Minimum objective value across the declared search domain, which must be specified.', minimum_size: 'Smallest cardinality/size among all property-preserving candidates in that domain.', dd_vs_ddmin: 'ddmin simplifies a failing configuration; dd narrows a passing/failing pair and returns a 1-minimal difference.' },
    mapping: 'Benchmark reference only. Paper FAIL (interesting failure reproduced) maps to PatchDiet candidate checks PASS (required behavior retained), via an explicit adapter.',
    claim: 'A completed classic ddmin run returns a 1-minimal failure-inducing configuration under its stable test model; it need not return a smallest or subset-minimal configuration.'
  },
  {
    ticket: 'PD-R103', slug: 'hdd', algorithmId: 'hierarchical-delta-debugging', id: 'paper:misherghi-su-2006-hdd',
    title: 'HDD: Hierarchical Delta Debugging', authors: ['Ghassan Misherghi', 'Zhendong Su'], year: 2006,
    venue: 'ICSE 2006, 142–151', doi: '10.1145/1134285.1134307', canonical: 'https://doi.org/10.1145/1134285.1134307',
    inspected: 'https://web.cs.ucdavis.edu/~su/publications/icse06-hdd.pdf', version: 'ICSE 2006 author manuscript, 10 pages',
    locators: ['Section 3.2 Algorithm 1', 'Sections 3.3–3.4', 'Section 4 and Tables 1–2'],
    problem: 'Reduce tree-structured failure-inducing inputs using hierarchical decomposition.', input: 'Parse tree, unparser and stable executable interestingness test.', output: 'A property-preserving pruned tree.',
    algorithm: 'Run ddmin over nodes at one depth, prune rejected nodes/subtrees, then advance to the next depth of the surviving tree (breadth-first).',
    pseudocode: 'level = 0\nwhile nodes_at_level(tree, level) is not empty:\n  nodes = nodes_at_level(tree, level)\n  keep = ddmin(nodes, S => test(unparse(tree retaining S at level)))\n  prune(tree, level, keep)\n  level += 1\nreturn tree\n',
    complexity: 'O(n²) worst-case test count for HDD; shape affects practical cost. HDD* repeated passes have a separate worst-case bound.',
    termination: 'Finite levels, terminating inner ddmin calls; HDD* repeats until no reduction.',
    correctness: 'One HDD traversal does not in general ensure 1-tree-minimality. HDD+ and HDD* are distinct variants with that guarantee (Proposition 3.7).',
    assumptions: ['faithful tree serialization', 'stable executable oracle', 'meaningful hierarchy'],
    limitations: ['Tree constraints do not guarantee all variants parse or typecheck', 'Cross-level dependencies can make earlier nodes removable later', 'Original GCC/XML examples are not PatchDiet benchmarks'],
    mapping: 'Hypothesis: file → symbol → AST node → token/atom hierarchy may improve candidate grouping. Do not implement before comparison.',
    evaluation: 'Original study compares ddmin, HDD and HDD* on GCC C inputs and Mozilla XML/XSL inputs, reporting fewer tests for its selected structured cases.',
    claim: 'HDD applies ddmin level by level to a tree; its single-pass output must not be described as generally 1-tree-minimal.'
  },
  {
    ticket: 'PD-R104', slug: 'wdd', algorithmId: 'weighted-delta-debugging', id: 'paper:zhou-2025-wdd',
    title: 'WDD: Weighted Delta Debugging', authors: ['Xintong Zhou', 'Zhenyang Xu', 'Mengxiao Zhang', 'Yongqiang Tian', 'Chengnian Sun'], year: 2025,
    venue: 'ICSE 2025, 1592–1603', doi: '10.1109/ICSE55347.2025.00071', canonical: 'https://arxiv.org/abs/2411.19410v2',
    inspected: 'https://arxiv.org/html/2411.19410v2', version: 'arXiv:2411.19410v2, 16 December 2024; ICSE 2025 accepted preprint', locators: ['Sections III–V', 'Algorithm 1 weightedPartition and ensureOneMinimal', 'Section VI, Table I'],
    problem: 'Equal-count partitions disregard unequal fragment sizes.', input: 'Ordered fragments with size weights and an executable property oracle.', output: 'Smaller property-preserving input.',
    algorithm: 'Wddmin balances partition total weights and tests partitions/complements, then repeats single-element deletions to a fixed point. WProbDD separately modifies the probabilistic model using weights.',
    pseudocode: 'partitions = [L]\nwhile partitions not empty:\n  test partitions and complements, retain property-preserving reductions\n  split remaining divisible partitions by approximately equal total weight\nrepeat:\n  remove one retained element if oracle accepts\nuntil no single deletion succeeds\nreturn L\n',
    complexity: 'Depends on partitioning and oracle outcomes; single-element fixed-point cleanup can require quadratic queries. No PatchDiet speed bound established.',
    termination: 'Partitions eventually reach singletons; accepted cleanup deletions strictly reduce finite L.', correctness: 'Wddmin cleanup targets 1-minimality relative to the executable property. Weight alone does not justify acceptance.',
    assumptions: ['positive size weights', 'stable oracle', 'faithful fragment reconstruction'], limitations: ['Fragment-size correlation is empirical, not causal proof', 'Risk, test-cost and scope-confidence weights are PatchDiet hypotheses, not the paper algorithm', 'Reported C/XML gains do not transfer automatically'],
    mapping: 'AST-size weights are a plausible experiment; risk/test-cost/scope weights require separate evidence.',
    evaluation: '62 C/XML benchmarks, Wddmin/WProbDD substituted into HDD and Perses; reported time/size improvements vary by framework and subject.',
    official_artifact: 'https://github.com/weightdd/WeightDD', artifact_status: 'SOURCE_PARTIALLY_VERIFIED',
    artifact_note: 'Official artifact README and Zenodo 10.5281/zenodo.14270380 inspected; Linux/Docker requirements recorded. Fixed repository commit/license inspection remains open; paper and code verification are distinct.',
    claim: 'WDD uses fragment sizes to alter partitioning/modeling; Wddmin is not ordinary ddmin preceded by a weight sort.'
  },
  {
    ticket: 'PD-R105', slug: 'probdd', algorithmId: 'probabilistic-delta-debugging', id: 'paper:wang-2021-probdd',
    title: 'Probabilistic Delta Debugging', authors: ['Guancheng Wang', 'Ruobing Shen', 'Junjie Chen', 'Yingfei Xiong', 'Lu Zhang'], year: 2021,
    venue: 'ESEC/FSE 2021, 881–892', doi: '10.1145/3468264.3468625', canonical: 'https://doi.org/10.1145/3468264.3468625',
    inspected: 'https://xiongyingfei.github.io/papers/FSE21a.pdf', version: 'Original ESEC/FSE 2021 author manuscript, 12 pages', locators: ['Sections 3.1–3.3', 'Algorithm and Theorem 4.1', 'Section 5'],
    problem: 'Use prior property-test outcomes to choose expected profitable deletions.', input: 'Finite sequence, initial probability 0<p0<1, binary property function.', output: 'An observed property-preserving subsequence and learned relevance estimates.',
    algorithm: 'Maintain independent Bernoulli relevance estimates. Order by ascending probability; choose a deletion prefix maximizing k·product(1-p). Verify its complement; update only deleted/attempted elements.',
    pseudocode: 'p[e] = p0\nwhile any retained p[e] < 1:\n  S = low_probability_prefix maximizing size(S)*product(1-p[e] for e in S)\n  if property(L-S): L = L-S; set p[e]=0 for e in S\n  else: for e in S: p[e] = p[e] / (1-product(1-p[j] for j in S))\nreturn L\n',
    complexity: 'Original Theorem 4.1 gives O(n) worst-case property tests for its algorithm/model; this is not an arbitrary budgeted random sampler.',
    termination: 'Original stops when retained probabilities reach 1 (removed elements have 0); numerical tolerance and tie-breaking must be specified for any implementation.',
    correctness: 'Model arguments assume monotonicity, unambiguity and independence; later 2025 analysis documents missed single deletions when revisits are skipped. Do not infer unconditional minimality.',
    assumptions: ['monotonicity/unambiguity for theoretical model', 'independent Bernoulli relevance approximation', 'stable binary property oracle'],
    limitations: ['Sequential posterior updates ignore interactions among tests', 'Dependent/non-monotone real inputs may violate model', 'Later CDD findings are separate primary evidence about limitations'],
    mapping: 'Research-only learned search policy. Configured checks remain authoritative; INCONCLUSIVE must not become property=true.',
    evaluation: 'Original evaluates HDD/CHISEL substitutions across multiple reduction domains; stochastic variants repeated five times on a specified Linux server. This does not measure PatchDiet.',
    claim: 'Original ProbDD selects deletions with a relevance-probability/expected-gain model and updates after tests; it is not unconstrained random subset sampling.'
  },
  {
    ticket: 'PD-R106', slug: 'cdd', algorithmId: 'counter-based-delta-debugging', id: 'paper:zhang-2025-cdd',
    title: 'Toward a Better Understanding of Probabilistic Delta Debugging', authors: ['Mengxiao Zhang', 'Zhenyang Xu', 'Yongqiang Tian', 'Xinru Cheng', 'Chengnian Sun'], year: 2025,
    venue: 'ICSE 2025', doi: '10.1109/ICSE55347.2025.00117', canonical: 'https://arxiv.org/abs/2408.04735v4',
    inspected: 'https://cs.uwaterloo.ca/~cnsun/public/publication/icse25_cdd/icse25_cdd.pdf', version: 'ICSE 2025 author manuscript, 12 pages; arXiv v4 metadata checked separately', locators: ['Section III round/size derivation', 'Section IV-D minimality limitation', 'Section V Algorithm 2'],
    problem: 'Simplify ProbDD by replacing element probabilities with a round-based subset schedule.', input: 'Ordered list, binary property oracle, initial probability p0.', output: 'Property-preserving retained list after scheduled deletion rounds.',
    algorithm: 'Compute subset size from round r and p0; partition current list into contiguous subsets, test each complement once, increment round, stop after the size-one round.',
    pseudocode: 'r=0\ndo:\n  s=ComputeSize(r,p0)  // Algorithm 2; maximize expected gain using round-derived probability\n  subsets=Partition(L,s)\n  for S in subsets:\n    if property(L-S): L=L-S\n  r=r+1\nwhile s>1\nreturn L\n',
    complexity: 'A round-based decreasing subset schedule removes the probability sort/update machinery; no PatchDiet cost measurement exists.',
    termination: 'Subset size decreases until a size-one round has executed. This is not a fixed-point cleanup.',
    correctness: 'Retains the tested property; skipping revisits can miss opportunities exposed by later deletions, so do not claim unconditional 1-minimality.',
    assumptions: ['terminating stable oracle', 'p0 and ordered partition schedule defined', 'finite input'],
    limitations: ['Introduced inside a later primary analysis of ProbDD, not a separate standalone CDD paper', 'Comparable results on 76 study benchmarks do not establish universal equality', 'Counter is the round count, not historical per-group/pair rewards'],
    mapping: 'Research-only scheduling comparison; no feedback ranking or pair-counter runtime changes.',
    evaluation: 'Primary paper analyzes ddmin/ProbDD queries and compares CDD on test-input minimization and debloating benchmarks; wrappers can recover some missed reductions.',
    claim: 'CDD is introduced in section V of the ProbDD analysis paper as a round-counter/subset-size simplification; it is not per-group outcome-counter ranking.'
  },
  {
    ticket: 'PD-R107', slug: 'vulcan', algorithmId: 'vulcan', id: 'paper:xu-2023-vulcan',
    title: 'Pushing the Limit of 1-Minimality of Language-Agnostic Program Reduction', authors: ['Zhenyang Xu', 'Yongqiang Tian', 'Mengxiao Zhang', 'Gaosen Zhao', 'Yu Jiang', 'Chengnian Sun'], year: 2023,
    venue: 'Proceedings of the ACM on Programming Languages 7, OOPSLA1, Article 97', doi: '10.1145/3586049', canonical: 'https://doi.org/10.1145/3586049',
    inspected: 'https://researchmgt.monash.edu/ws/portalfiles/portal/716513714/716367322-oa.pdf', version: 'Published April 2023 manuscript, 29 pages', locators: ['Sections 1–4 transformations/framework', 'Section 5 evaluation', 'Section 8 conclusion'],
    problem: 'A reducer can stop at a large 1-minimal result relative to its limited transformation vocabulary.', input: 'Program, grammar, main language-agnostic reducer and property oracle.', output: 'Further reduced program preserving the observed property.',
    algorithm: 'Alternate the main reducer with identifier replacement, subtree replacement and tree-based local exhaustive enumeration to expose new reduction opportunities.',
    pseudocode: 'P=main_reduce(P,property)\nrepeat within search budget:\n  generate auxiliary grammar-guided transformations\n  verify property for transformed candidates\n  apply main reducer to accepted candidates\n  retain improving reduced result\nreturn best property-preserving result\n',
    complexity: 'Transformation search adds oracle/time cost; local exhaustive enumeration can be expensive. No global minimum bound.',
    termination: 'Bound auxiliary search and stop when the configured framework makes no further progress; schematic pseudocode is not a reproduction specification.',
    correctness: '1-minimality is relative to available moves. Transformations can escape that local minimum; only property tests accept outputs.',
    assumptions: ['usable grammar and serializer', 'stable property test', 'bounded transformation search'],
    limitations: ['Auxiliary outputs must be no larger than their input; equal-size transformations may expose new reductions', 'No semantic-equivalence or global-minimum proof', 'C/Rust/SMT-LIBv2 evaluation is not a safe PR-removal benchmark'],
    mapping: 'Study search-space expansion only; PatchDiet must not transform source code merely to make tests pass.',
    evaluation: 'Published evaluation compares sizes and costs with Perses and additional reduction of C-Reduce outputs; extra search can improve size at increased cost.',
    claim: 'Vulcan uses additional grammar-guided transformations plus a main reducer to escape some transformation-relative 1-minimal results; it does not establish a global minimum.'
  },
  {
    ticket: 'PD-R108', slug: 'lpr', algorithmId: 'lpr', id: 'paper:zhang-2024-lpr',
    title: 'LPR: Large Language Models-Aided Program Reduction', authors: ['Mengxiao Zhang', 'Yongqiang Tian', 'Zhenyang Xu', 'Yiwen Dong', 'Shin Hwei Tan', 'Chengnian Sun'], year: 2024,
    venue: 'ISSTA 2024', doi: '10.1145/3650212.3652126', canonical: 'https://arxiv.org/abs/2312.13064v3',
    inspected: 'https://arxiv.org/html/2312.13064v3', version: 'arXiv:2312.13064v3, 11 May 2024; author PDF Algorithm 1 cross-checked', locators: ['Section 3.2 Algorithm 1 and workflow', 'Section 3.3 prompts', 'Evaluation and limitations'],
    problem: 'Combine language-generic reduction with language-specific transformation proposals.', input: 'Program, prompts, LLM, language-generic reducer and executable property function ψ.', output: 'A smaller program for which ψ is observed to hold.',
    algorithm: 'LLM identifies transformation targets and proposes rewrites; ψ checks each proposal, then Perses reduces the accepted candidate. Repeat transformations/reduction while overall size improves.',
    pseudocode: 'repeat:\n  previous=P\n  for transformation prompt:\n    targets=LLM_identify(P,prompt)\n    for target in targets:\n      Q=LLM_transform(P,target)\n      if property(Q): P=Q\n      P=Perses(P,property)\nuntil no overall size improvement\nreturn prior best\n',
    complexity: 'LLM latency/cost plus reducer and property-test costs; no general bound inferred from selected benchmarks.',
    termination: 'Outer loop checks size improvement; executable implementations also need bounded LLM calls, timeouts and search.',
    correctness: 'LLM proposes targets/rewrites. The executable ψ remains authoritative; reducer acceptance does not prove semantic equivalence or requirement completeness.',
    assumptions: ['property test is meaningful and stable', 'LLM output treated as untrusted', 'generic reducer uses same property'],
    limitations: ['Evaluation covers 50 C/Rust/JavaScript compiler-oriented subjects', 'Can temporarily enlarge programs (e.g. loop unrolling)', 'Model/prompt/cost dependence', 'Compiler interestingness is not PatchDiet task correctness'],
    mapping: 'Advisory candidate suggestions only; never summarize as LLM safely removes code. No runtime integration authorized.',
    evaluation: 'Author-reported reductions/time comparisons with Vulcan on 50 subjects; those are study-specific results, not PatchDiet gains.',
    claim: 'In LPR, LLMs propose transformations and executable property ψ validates them; LLM confidence never replaces the property oracle.'
  }
];
for (const spec of specs) {
  const sourcePath = `sources/program-reduction/${spec.slug}.yaml`;
  const claimPath = `claims/program-reduction/${spec.slug}-001.yaml`;
  const algorithmPath = `algorithms/${spec.algorithmId}.yaml`;
  const source = { id: spec.id, title: spec.title, authors: spec.authors, year: spec.year, venue: spec.venue, doi: spec.doi, canonical_url: spec.canonical, source_type: 'peer-reviewed-paper', authority_tier: 'A', primary_secondary: 'primary', retrieved_at: '2026-10-26', paper_version_used: spec.version, inspection: { url: spec.inspected, locators: spec.locators, retrieved_at: '2026-10-26' }, verification_status: 'SOURCE_VERIFIED_PRIMARY', claims: [`claim:${spec.slug}:001`], assumptions: spec.assumptions, limitations: spec.limitations, patchdiet_relevance: { relevance: 'high', mapping: spec.mapping }, status: { source_verified: true, distilled: false, decision: 'RESEARCH_ONLY' }, distillation_gates: { D1_SOURCE_VERIFIED: 'PASS', D2_CLAIMS_EXTRACTED: 'PASS', D3_LIMITATIONS_CAPTURED: 'PASS', D4_PATCHDIET_MAPPED: 'PASS', D5_DECISION_RECORDED: 'PASS', D6_TICKET_CREATED_IF_REQUIRED: 'D6_NOT_APPLICABLE', D7_VALIDATED_IF_IMPLEMENTED: 'NOT_APPLICABLE' } };
  if (spec.official_artifact) Object.assign(source, { official_artifact: spec.official_artifact, artifact_status: spec.artifact_status, artifact_note: spec.artifact_note });
  await save(sourcePath, source);
  await save(claimPath, { id: `claim:${spec.slug}:001`, statement: spec.claim, source: { id: spec.id, locators: spec.locators }, evidence_type: 'peer-reviewed-paper', scope: 'program-reduction', assumptions: spec.assumptions, limitations: spec.limitations, patchdiet_mapping: { mapping: spec.mapping, affected_components: ['packages/core/src/reducer.ts'] }, automatic_removal_authority: false, status: 'RESEARCH_ONLY', independent_review: 'PENDING' });
  const card = { name: spec.algorithmId, family: 'program-reduction', original_sources: [spec.id], source_version: spec.version, evidence_locators: spec.locators, problem: spec.problem, input: spec.input, output: spec.output, algorithm: spec.algorithm, pseudocode: spec.pseudocode, pseudocode_scope: 'Original paraphrase for research; use cited full algorithm before implementing a reproduction.', complexity: spec.complexity, oracle_calls: 'Only executable property outcomes accept candidates; do not count probability/structure/LLM advice as a successful test.', termination: spec.termination, correctness_scope: spec.correctness, assumptions: spec.assumptions, limitations: spec.limitations, failure_modes: ['unstable or insufficient oracle', 'invalid serialization', 'unsupported domain transfer'], patchdiet_current_state: 'Existing runtime preserved; this correction adds no runtime strategy.', patchdiet_gap: 'No controlled PatchDiet comparison establishes benefit.', patchdiet_mapping: spec.mapping, recommended_use: 'RESEARCH_ONLY until independently reviewed and benchmarked.', not_recommended_for: 'Automatic removal authority or semantic correctness claims.', tests_required: ['property polarity adapter', 'inconclusive oracle', 'deterministic reconstruction', 'budget exit does not claim minimality'], benchmark_metrics: ['Removal Precision', 'Removal Recall', 'oracle calls', 'runtime', 'final verification', 'hidden regression rate'], status: 'RESEARCH_ONLY', independent_review: 'PENDING' };
  if (spec.distinctions) card.minimality_distinctions = spec.distinctions;
  if (spec.evaluation) card.source_evaluation = spec.evaluation;
  await save(algorithmPath, card);
  registry.sources.push({ id: spec.id, path: sourcePath, authority_tier: 'A', status: source.verification_status, retrieved_at: '2026-10-26' });
  registry.claims.push({ id: `claim:${spec.slug}:001`, path: claimPath, source: spec.id });
  const entry = registry.algorithms.find(e => e.id === spec.algorithmId);
  if (entry) entry.status = 'RESEARCH_ONLY'; else registry.algorithms.push({ id: spec.algorithmId, path: algorithmPath, status: 'RESEARCH_ONLY' });
}
// Explicit quarantine of legacy algorithm descriptions without verified original provenance.
for (const entry of registry.algorithms.filter(e => !specs.some(s => s.algorithmId === e.id))) {
  const card = parse(await fs.readFile(root + entry.path, 'utf8'));
  const registered = new Set(registry.sources.map(s => s.id));
  const unresolved = (card.original_sources ?? []).filter(s => !registered.has(s));
  if (unresolved.length) {
    card.unverified_legacy_citations = unresolved;
    card.original_sources = card.original_sources.filter(s => registered.has(s));
    card.provenance_gap = 'Original primary source not verified; legacy algorithm text is quarantined and may not inform experiments.';
  }
  card.status = 'NOT_VERIFIED';
  card.independent_review = 'PENDING';
  await save(entry.path, card);
}
await save('registry.yaml', registry);
console.log(JSON.stringify({ corrected_algorithm_cards: specs.length, new_primary_sources: specs.length, new_atomic_claims: specs.length }));
