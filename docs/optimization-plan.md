# PatchDiet 优化方案

> 以用户视角对 v0.1.1 版本进行全面检查，整理发现的问题及改进计划，并完整执行。

---

## 问题清单

### 🐛 Bug / 逻辑错误

| # | 文件 | 问题 |
|---|------|------|
| B1 | `packages/report/src/index.ts:9` | 报告标题混入法语 `"##    Résumé"`，与全英文工具不一致 |
| B2 | `packages/core/src/shrink.ts:1487` | `isUnrelatedPath` 硬编码了 `unused.ts`、`notes.py`、`scratch.txt`、`theme.js` 等明显是开发调试时的占位值，导致 `patchdiet check` 的候选文件计数不准确 |

### 🎨 用户体验 (UX)

| # | 文件 | 问题 |
|---|------|------|
| U1 | `packages/cli/src/index.ts:42` | `patchdiet init` 当配置文件已存在时静默退出，用户完全不知道发生了什么 |
| U2 | `packages/cli/src/index.ts:174` | `patchdiet doctor` 输出纯文本，没有任何通过/失败的视觉标记，扫描困难 |
| U3 | `packages/cli/src/index.ts:494` | `patchdiet shrink` 完成摘要没有突出显示节省比例，关键数字埋在文字里 |

### ⚙️ 配置默认值

| # | 文件 | 问题 |
|---|------|------|
| C1 | `packages/core/src/config.ts:205` | `cacheTests` 默认 `false`，导致用户反复跑相同 candidate 会重复执行测试，体验差 |
| C2 | `packages/core/src/config.ts:239` | `createPresetConfig` 生成的配置模板 `cache_tests: false`，与上同 |
| C3 | `patchdiet.yaml` | 项目自身配置 `cache_tests: false`，未享用缓存加速 |

### 📖 文档

| # | 文件 | 问题 |
|---|------|------|
| D1 | `README.md:49` | Quickstart "从本仓库运行" 要求用户先 build，命令冗长且不直观 |
| D2 | `README.md:169` | GitHub Action 示例写的是私人仓库地址 `chenfei462/PatchDiet@v0.1.1`，新用户无法直接使用 |

---

## 执行计划

- [x] **B1** — 修复报告标题法语 `Résumé` → `Summary`  
- [x] **B2** — 修复 `isUnrelatedPath`，复用已有的 `isDocsPath` / `isGeneratedLikePath` 逻辑  
- [x] **U1** — `patchdiet init` 无论新建还是已存在均打印明确提示  
- [x] **U2** — `patchdiet doctor` 每行加 `✓` / `✗` / `⚠` 视觉标记  
- [x] **U3** — `patchdiet shrink` 摘要第一行突出显示节省百分比  
- [x] **C1/C2/C3** — 将 `cache_tests` 默认值改为 `true`  
- [x] **D1/D2** — 改善 README Quickstart 并修正 GitHub Action 示例引用  
