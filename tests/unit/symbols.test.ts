import { describe, expect, it } from "vitest";

import { extractSymbolCandidatesFromDiff } from "../../packages/core/src/symbols.js";

describe("extractSymbolCandidatesFromDiff", () => {
  it("extracts TypeScript and Python function/class candidates from added diff lines", () => {
    const diff = `diff --git a/src/math.ts b/src/math.ts
--- a/src/math.ts
+++ b/src/math.ts
@@ -0,0 +1,6 @@
+export function multiply(a: number, b: number) {
+  return a * b;
+}
+export class Calculator {}
diff --git a/src/math.py b/src/math.py
--- a/src/math.py
+++ b/src/math.py
@@ -0,0 +1,5 @@
+def multiply(a, b):
+    return a * b
+class Calculator:
+    pass
`;

    expect(extractSymbolCandidatesFromDiff(diff)).toEqual([
      {
        filePath: "src/math.ts",
        language: "typescript",
        kind: "function",
        name: "multiply",
        hunkHeader: "@@ -0,0 +1,6 @@",
        riskLevel: "medium"
      },
      {
        filePath: "src/math.ts",
        language: "typescript",
        kind: "class",
        name: "Calculator",
        hunkHeader: "@@ -0,0 +1,6 @@",
        riskLevel: "medium"
      },
      {
        filePath: "src/math.py",
        language: "python",
        kind: "function",
        name: "multiply",
        hunkHeader: "@@ -0,0 +1,5 @@",
        riskLevel: "medium"
      },
      {
        filePath: "src/math.py",
        language: "python",
        kind: "class",
        name: "Calculator",
        hunkHeader: "@@ -0,0 +1,5 @@",
        riskLevel: "medium"
      }
    ]);
  });

  it("extracts default exports and arrow-function declarations", () => {
    const diff = `diff --git a/src/widget.tsx b/src/widget.tsx
--- a/src/widget.tsx
+++ b/src/widget.tsx
@@ -0,0 +1,6 @@
+export default function Widget() {
+  return null;
+}
+export default class WidgetModel {}
+export const useWidget = () => null;
`;

    expect(extractSymbolCandidatesFromDiff(diff)).toEqual([
      {
        filePath: "src/widget.tsx",
        language: "typescript",
        kind: "function",
        name: "Widget",
        hunkHeader: "@@ -0,0 +1,6 @@",
        riskLevel: "medium"
      },
      {
        filePath: "src/widget.tsx",
        language: "typescript",
        kind: "class",
        name: "WidgetModel",
        hunkHeader: "@@ -0,0 +1,6 @@",
        riskLevel: "medium"
      },
      {
        filePath: "src/widget.tsx",
        language: "typescript",
        kind: "function",
        name: "useWidget",
        hunkHeader: "@@ -0,0 +1,6 @@",
        riskLevel: "medium"
      }
    ]);
  });
});
