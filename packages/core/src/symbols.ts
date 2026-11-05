export interface SymbolCandidate {
  filePath: string;
  language: string;
  kind: string;
  name: string;
  hunkHeader: string;
  riskLevel: string;
}

const languageExtensions: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cpp": "cpp",
  ".h": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".m": "objective-c",
  ".mm": "objective-cpp"
};

function detectLanguage(filePath: string): string {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) return "unknown";
  const ext = filePath.slice(dotIndex).toLowerCase();
  return languageExtensions[ext] ?? "unknown";
}

function extractFunctionName(line: string): string | null {
  const trimmed = line.trim();
  const tsFunctionMatch = trimmed.match(/^(?:export\s+)?(?:default\s+)?function\s+(\w+)/);
  if (tsFunctionMatch) return tsFunctionMatch[1];
  const tsArrowMatch = trimmed.match(/^(?:export\s+)?const\s+(\w+)\s*=\s*(?:\([^)]*\)|[^=])\s*=>/);
  if (tsArrowMatch) return tsArrowMatch[1];
  const pyDefMatch = trimmed.match(/^def\s+(\w+)/);
  if (pyDefMatch) return pyDefMatch[1];
  return null;
}

function extractClassName(line: string): string | null {
  const trimmed = line.trim();
  const tsClassMatch = trimmed.match(/^(?:export\s+)?(?:default\s+)?class\s+(\w+)/);
  if (tsClassMatch) return tsClassMatch[1];
  const pyClassMatch = trimmed.match(/^class\s+(\w+)/);
  if (pyClassMatch) return pyClassMatch[1];
  return null;
}

export function extractSymbolCandidatesFromDiff(diff: string): SymbolCandidate[] {
  const candidates: SymbolCandidate[] = [];
  const lines = diff.split(/\r?\n/);

  let filePath = "";
  let hunkHeader = "";

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      filePath = match?.[1] ?? "";
      continue;
    }
    if (line.startsWith("@@ ")) {
      hunkHeader = line;
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;

    const content = line.slice(1);
    const funcName = extractFunctionName(content);
    if (funcName) {
      candidates.push({
        filePath,
        language: detectLanguage(filePath),
        kind: "function",
        name: funcName,
        hunkHeader,
        riskLevel: "medium"
      });
      continue;
    }

    const className = extractClassName(content);
    if (className) {
      candidates.push({
        filePath,
        language: detectLanguage(filePath),
        kind: "class",
        name: className,
        hunkHeader,
        riskLevel: "medium"
      });
    }
  }

  return candidates;
}
