# Release Copy

## Show HN

Show HN: PatchDiet - shrink bloated AI-generated PRs into minimal patches

I built PatchDiet after noticing that coding agents often produce PRs that pass tests but include unrelated files and scope creep. PatchDiet takes a git diff, removes unnecessary changes conservatively, and outputs a smaller cleanup patch plus a report explaining what was removed and why. It is local-first and does not upload your code.

## X / LinkedIn

Title:
Your AI agent passed the tests. PatchDiet still deleted 71% of the patch.

Body:
PatchDiet takes an already-generated PR, reverts candidate hunks in temporary worktrees, reruns your checks, and emits a smaller cleanup patch plus an auditable report. Local-first. No source upload. Not a PR review bot.

## 知乎

标题：
AI 写的 PR 太大？我做了一个自动瘦身工具

摘要：
PatchDiet 不负责“再写一遍代码”，而是处理 AI 已经写出来的 PR。它把补丁拆到 hunk 级，尝试在临时 worktree 里回退可疑改动，重新跑测试，再输出一个更小的 cleanup patch 和必要性报告。

## 掘金

标题：
测试通过不代表 PR 好合并：给 AI 生成补丁做瘦身

导语：
我做了一个本地优先的 CLI，专门处理 Claude Code、Codex、Cursor 这类 AI coding agent 产出的“大而杂 PR”。PatchDiet 会删掉和当前验证目标无关的 diff，把 4 个文件、14 行改动缩成 1 个文件、4 行改动，并留下可以审计的报告。

## 中文短标题

- 我做了一个工具，把 AI 生成的臃肿 PR 自动瘦身
- AI 写的 PR 太大？PatchDiet 自动删掉无关 diff
- 测试通过不代表 PR 好合并：PatchDiet 给 AI 补丁做缩减
