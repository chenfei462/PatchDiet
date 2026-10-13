export type OracleVerdict = "PASS" | "FAIL" | "INCONCLUSIVE";

export interface ReductionGroup {
  id: string;
  contentHash: string;
  memberIds: string[];
}

export interface ReductionContext {
  baseSha: string;
  headSha: string;
  requiredCommands: string[];
  environment: string;
  toolVersion: string;
}

export interface ReductionAttempt {
  ids: string[];
  key: string;
  verdict: OracleVerdict;
  cached: boolean;
}

export interface ReductionResult {
  selectedIds: string[];
  attempts: ReductionAttempt[];
  inconclusive: boolean;
}

export function candidateSetKey(context: ReductionContext, groups: ReductionGroup[]): string {
  const canonical = [...groups]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((group) => [group.id, group.contentHash, [...group.memberIds].sort()] as const);
  return createHash("sha256").update(JSON.stringify([
    "patchdiet-reducer-v1",
    context.baseSha,
    context.headSha,
    context.requiredCommands,
    context.environment,
    context.toolVersion,
    canonical,
  ])).digest("hex");
}

export async function reduceGroups(
  groups: ReductionGroup[],
  context: ReductionContext,
  evaluate: (removedIds: string[]) => Promise<OracleVerdict>,
  options: { cache?: boolean; priority?: Record<string, number> } = {}
): Promise<ReductionResult> {
  // Priority is advisory and applies only to groups the caller has already
  // declared eligible. It never adds a group or changes oracle results.
  const ordered = [...groups].sort((a, b) =>
    (options.priority?.[b.id] ?? 0) - (options.priority?.[a.id] ?? 0) || a.id.localeCompare(b.id));
  if (new Set(ordered.map((group) => group.id)).size !== ordered.length) {
    throw new Error("reducer: duplicate group id");
  }
  if (ordered.some((group) => !group.id || !group.contentHash || group.memberIds.length === 0)) {
    throw new Error("reducer: group id, content hash and members are required");
  }

  const attempts: ReductionAttempt[] = [];
  // v2 controls: the context+content keyed verdict cache can be disabled
  // (performance.cache_tests: false) so every trial executes for real.
  const useCache = options.cache !== false;
  const cache = new Map<string, "PASS" | "FAIL">();
  let inconclusive = false;
  const test = async (set: ReductionGroup[]): Promise<OracleVerdict> => {
    const chosen = [...set].sort((a, b) => a.id.localeCompare(b.id));
    const ids = chosen.map((group) => group.id);
    const key = candidateSetKey(context, chosen);
    const cached = useCache ? cache.get(key) : undefined;
    if (cached) {
      attempts.push({ ids, key, verdict: cached, cached: true });
      return cached;
    }
    let verdict: OracleVerdict;
    try {
      verdict = await evaluate(ids);
    } catch {
      verdict = "INCONCLUSIVE";
    }
    if (verdict !== "PASS" && verdict !== "FAIL" && verdict !== "INCONCLUSIVE") {
      verdict = "INCONCLUSIVE";
    }
    attempts.push({ ids, key, verdict, cached: false });
    if (verdict === "INCONCLUSIVE") inconclusive = true;
    else if (useCache) cache.set(key, verdict);
    return verdict;
  };

  if (ordered.length === 0) return { selectedIds: [], attempts, inconclusive };
  if (await test(ordered) === "PASS") {
    return { selectedIds: ordered.map((group) => group.id), attempts, inconclusive };
  }

  // Search both subsets and complements at progressively finer granularity.
  // This finds useful passing combinations without ever unioning independent
  // PASS verdicts. The subsequent single-group add pass gives a 1-maximal set
  // under the observed oracle; it does not claim a global optimum.
  let selected: ReductionGroup[] = [];
  for (let n = 2; n <= ordered.length; n += 1) {
    const subsets = partition(ordered, n);
    const candidates = [
      ...subsets,
      ...subsets.map((subset) => ordered.filter((group) => !subset.includes(group))),
    ].filter((set) => set.length > 0);
    const passing: ReductionGroup[][] = [];
    for (const candidate of candidates) {
      if (await test(candidate) === "PASS") passing.push(candidate);
    }
    if (passing.length > 0) {
      passing.sort((a, b) => b.length - a.length ||
        a.map((group) => group.id).join("\0").localeCompare(b.map((group) => group.id).join("\0")));
      selected = passing[0]!;
      break;
    }
  }

  if (selected.length > 0) {
    for (const group of ordered) {
      if (selected.includes(group)) continue;
      const expanded = [...selected, group];
      if (await test(expanded) === "PASS") selected = expanded;
    }
  }
  return { selectedIds: selected.map((group) => group.id).sort(), attempts, inconclusive };
}
import { createHash } from "node:crypto";


function partition<T>(items: T[], count: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(index * items.length / count);
    const end = Math.floor((index + 1) * items.length / count);
    if (start < end) groups.push(items.slice(start, end));
  }
  return groups;
}
