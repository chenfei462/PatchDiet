# Sample Cart PR

Status: 30-second preview sample for the browser demo

## Headline

AI wrote a small cart fix plus review noise. PatchDiet shows the 30-second preview path: `5 files / 33 lines -> 2 files / 14 lines`, `58% review noise removed`, `4m estimated attention saved`.

## Context

- Demo path: `http://127.0.0.1:4173/demo/`
- Sample diff: `examples/sample-pr.diff`
- Browser mode: 30-second preview-only diff heuristics
- CLI verified handoff command: `patchdiet shrink --test "npm test"`
- Reviewer artifacts: `.patchdiet/report.github.md`, `.patchdiet/report.html`, `.patchdiet/removal.patch`, `.patchdiet/candidates.json`, `.patchdiet/diet-card.svg`

## Before / After

| Metric | Before | After |
| --- | ---: | ---: |
| Files | 5 | 2 |
| Hunks | 5 | 2 |
| Changed lines | 33 | 14 |
| Review noise removed | n/a | 58% |
| Estimated attention saved | n/a | 4m |

## What PatchDiet Flags In Preview

- `README.md`: temporary agent notes unrelated to the cart behavior.
- `docs/agent-plan.md`: planning notes left in the PR.
- `dist/cart.generated.js`: generated-like artifact reviewers should not inspect first.

## What Stays For Review

- `src/cart.ts`: behavior-bearing total calculation change.
- `src/cart.test.ts`: test proving quantity handling.

## Preview-only boundary

The web demo does not run tests. It parses the unified diff locally and shows likely review noise so judges and new users understand the product story quickly.

## Verified boundary

The CLI path is the proof path. Browser preview highlights likely noise; CLI verified proof reruns checks in temporary git worktrees and only counts removals when checks still pass. `patchdiet shrink --test "npm test"` uses git worktrees and only treats cleanup as verified when configured checks still pass. PatchDiet still does not prove semantic equivalence.

For the primary judge/investor proof, use `agent-large-pr`: `4 files / 128 changed lines -> 2 files / 32 changed lines`, `75% changed-line reduction`, with `node --test` passing.

## Sample Diff

```diff
diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -1,7 +1,18 @@
 export interface CartItem {
   price: number;
   quantity: number;
 }
 
 export function total(items: CartItem[]): number {
-  return items.reduce((sum, item) => sum + item.price, 0);
+  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
+}
+
+export function formatTotal(total: number): string {
+  return `$${total.toFixed(2)}`;
+}
+
+export function debugCart(items: CartItem[]): void {
+  console.log("cart debug", items);
 }
```

## Demo Script

1. Run `npm run demo`.
2. Open `http://127.0.0.1:4173/demo/`.
3. Point to the already loaded sample receipt: `5 files / 33 lines -> 2 files / 14 lines`.
4. Show the three deletion candidates and visible preview receipts.
5. Copy `patchdiet shrink --test "npm test"` as the verified proof command.
6. Close on the Diet Card and GitHub comment artifacts.
