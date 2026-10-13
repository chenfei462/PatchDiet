import { evidenceId } from "./ids.js";
import type {
  CommandEvidence,
  EdgeReliability,
  EvidenceCategory,
  EvidencePolarity,
  EvidenceRecord,
  EvidenceSpan,
  GraphFacts
} from "./types.js";

/** Build a stable evidence record. */
export function makeEvidence(input: {
  category: EvidenceCategory;
  polarity: EvidencePolarity;
  confidence: number;
  sourceId: string;
  atomId?: string;
  detail: string;
  span?: EvidenceSpan;
  reliability?: EdgeReliability;
  command?: CommandEvidence;
  limits?: string[];
}): EvidenceRecord {
  return {
    id: evidenceId(input.category, input.sourceId, input.detail, input.atomId),
    category: input.category,
    polarity: input.polarity,
    confidence: input.confidence,
    sourceId: input.sourceId,
    atomId: input.atomId,
    span: input.span,
    reliability: input.reliability,
    command: input.command,
    detail: input.detail,
    limits: input.limits
  };
}

/**
 * Whether the graph facts are usable for a confident decision. Any recorded
 * incompleteness reason means a "no dependency path" observation is not proof
 * of unrelatedness.
 */
export function graphIsComplete(graph: GraphFacts | undefined): boolean {
  if (!graph) {
    return false;
  }
  return graph.incompleteReasons.length === 0;
}

/** Outgoing edges of a node, deterministic order. */
export function outgoingEdges(graph: GraphFacts | undefined, fromId: string) {
  if (!graph) {
    return [];
  }
  return graph.edges
    .filter((edge) => edge.fromId === fromId)
    .sort((a, b) => (a.toId < b.toId ? -1 : a.toId > b.toId ? 1 : 0));
}

/**
 * Find a dependency path from `fromId` to any of `targets`, following outgoing
 * edges. Returns the shortest path (by edge count) or `undefined`. Only
 * non-weak edges are traversed, so a weak similarity edge never becomes a
 * supporting dependency claim.
 */
export function findDependencyPath(
  graph: GraphFacts | undefined,
  fromId: string,
  targets: ReadonlySet<string>,
  options: { includeWeak?: boolean } = {}
): string[] | undefined {
  if (!graph || targets.size === 0) {
    return undefined;
  }
  const includeWeak = options.includeWeak ?? false;
  const queue: string[][] = [[fromId]];
  const seen = new Set<string>([fromId]);

  while (queue.length > 0) {
    const path = queue.shift() as string[];
    const node = path[path.length - 1];
    if (path.length > 1 && targets.has(node)) {
      return path;
    }
    for (const edge of outgoingEdges(graph, node)) {
      if (!includeWeak && edge.reliability === "weak") {
        continue;
      }
      if (seen.has(edge.toId)) {
        continue;
      }
      seen.add(edge.toId);
      queue.push([...path, edge.toId]);
    }
  }

  return undefined;
}
