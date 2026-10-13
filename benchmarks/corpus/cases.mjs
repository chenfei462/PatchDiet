/**
 * Benchmark corpus: labelled synthetic/adversarial and injected fixtures.
 *
 * Every case declares:
 *  - baseFiles / headFiles: full repository contents at BASE and HEAD.
 *  - run: the exact runShrink invocation (strategy, granularity, oracle, task).
 *  - labelRules: map a changed atom (matched by path + substring of its HEAD
 *    side changed content) to `necessary` / `unnecessary` / `uncertain`.
 *    Labels are assigned BEFORE reduction and never derived from the verdict.
 *  - heldOut: independent necessary-behavior oracle files + command, run
 *    against any delivered artifact (never used by the producer).
 *  - expect: what the runner asserts (verified/unverified, removal policy).
 *
 * Labeling convention for CONDITIONALLY REDUNDANT pairs (mutually redundant
 * alternatives): each alternative alone is unnecessary given the other exists
 * in HEAD; that is a pre-reduction fact independent of the reducer verdict.
 * Both atoms are labelled `unnecessary` with a note; removing BOTH is caught
 * by the held-out oracle as a hidden regression, not by labels.
 */

const JS_TOTAL_BASE = "export function total(n) {\n  return n;\n}\n";
const JS_TOTAL_DEBUG =
  "export function total(n) {\n  const trace = {n};\n  console.error('injected-debug', trace);\n  return n * 2;\n}\n";
const JS_TOTAL_HELD_OUT =
  "import { total } from './src/total.js';\nif (total(4) !== 8 || total(0) !== 0) process.exit(7);\nconsole.log('held-out ok');\n";

const PY_TOTAL_BASE = "def total(n):\n    return n\n";
const PY_TOTAL_DEBUG =
  "def total(n):\n    trace = {'n': n}\n    print('injected-debug', trace)\n    return n * 2\n";
const PY_TOTAL_HELD_OUT =
  "from src.total import total\nassert total(4) == 8\nassert total(0) == 0\nprint('held-out ok')\n";

const TS_TOTAL_BASE = "export function total(n: number): number {\n  return n;\n}\n";
const TS_TOTAL_DEBUG =
  "export function total(n: number): number {\n  const trace: { n: number } = { n };\n  console.error('injected-debug', trace);\n  return n * 2;\n}\n";
const TS_TOTAL_HELD_OUT =
  "import { total } from './src/total.ts';\nif (total(4) !== 8 || total(0) !== 0) process.exit(7);\nconsole.log('held-out ok');\n";

const WEAK = [`"${process.execPath}" -e "process.exit(0)"`];

export const cases = [
  // ── Injected task fixtures (class 2) ─────────────────────────────
  {
    id: "inj-js-debug",
    class: "injected",
    language: "javascript",
    description: "JS: required total fix plus two unrelated debug statements (fine AST atoms).",
    baseFiles: [{ path: "src/total.js", content: JS_TOTAL_BASE }],
    headFiles: [{ path: "src/total.js", content: JS_TOTAL_DEBUG }],
    run: {
      taskText: "Fix total(n) to return twice n. Preserve the public function name. Debug logging and debug-only locals are unrelated to this task.",
      requiredCommands: [`"${process.execPath}" -e "import {total} from './src/total.js'; process.exit(total(4)===8?0:1)"`],
      strategy: "ddmin",
      atomGranularity: "ast",
    },
    labelRules: [
      { path: "src/total.js", contains: "return n * 2", label: "necessary" },
      { path: "src/total.js", contains: "trace", label: "unnecessary" },
      { path: "src/total.js", contains: "injected-debug", label: "unnecessary" },
    ],
    heldOut: {
      files: [{ path: "held-out.mjs", content: JS_TOTAL_HELD_OUT }],
      command: `"${process.execPath}" held-out.mjs`,
    },
    expect: { verified: true, removalsAllowed: true },
  },
  {
    id: "inj-python-debug",
    class: "injected",
    language: "python",
    description: "Python: required total fix plus two unrelated debug statements (fine AST atoms).",
    baseFiles: [{ path: "src/total.py", content: PY_TOTAL_BASE }],
    headFiles: [{ path: "src/total.py", content: PY_TOTAL_DEBUG }],
    run: {
      taskText: "Fix total(n) to return twice n. Preserve the public function name. Debug logging and debug-only locals are unrelated to this task.",
      requiredCommands: ["PYTHON check_total.py"],
      strategy: "ddmin",
      atomGranularity: "ast",
    },
    pythonOracle: {
      // Real oracle executed with the discovered Python interpreter.
      script: "from src.total import total\nimport sys\nsys.exit(0 if total(4) == 8 else 1)\n",
      file: "check_total.py",
    },
    labelRules: [
      { path: "src/total.py", contains: "return n * 2", label: "necessary" },
      { path: "src/total.py", contains: "trace", label: "unnecessary" },
      { path: "src/total.py", contains: "injected-debug", label: "unnecessary" },
    ],
    heldOut: {
      files: [{ path: "held_out.py", content: PY_TOTAL_HELD_OUT }],
      command: "PYTHON held_out.py",
    },
    expect: { verified: true, removalsAllowed: true },
  },
  {
    id: "inj-python-two-debug-sites",
    class: "injected",
    language: "python",
    description:
      "Python, two debug sites across two files (debug local+print in total.py, print in util.py) with a util-consuming oracle. " +
      "HISTORY: present in the original 16-case corpus; runner-computed labels failed on a pure-deletion AST atom, then the case " +
      "was DROPPED from the corpus after the producer's ddmin went INCONCLUSIVE (mode unverified vs expected verified) instead of " +
      "being reported as a failed case. Restored here unmodified as a preserved failing/historical input: it counts in every " +
      "denominator and its real outcome is reported, never hidden. No post-verdict label change.",
    baseFiles: [
      { path: "src/total.py", content: PY_TOTAL_BASE },
      { path: "src/util.py", content: "def util(n):\n    return n\n" },
    ],
    headFiles: [
      { path: "src/total.py", content: PY_TOTAL_DEBUG },
      { path: "src/util.py", content: "def util(n):\n    print('injected-debug-util', n)\n    return n\n" },
    ],
    run: {
      taskText: "Fix total(n) to return twice n. Preserve the public function names. Debug logging and debug-only locals are unrelated to this task.",
      requiredCommands: [
        "PYTHON check_total.py",
        "PYTHON check_util.py",
      ],
      strategy: "ddmin",
      atomGranularity: "ast",
    },
    pythonOracle: {
      script: "from src.total import total\nimport sys\nsys.exit(0 if total(4) == 8 else 1)\n",
      file: "check_total.py",
    },
    secondPythonOracle: {
      script: "from src.util import util\nimport sys\nsys.exit(0 if util(1) == 1 else 1)\n",
      file: "check_util.py",
    },
    labelRules: [
      { path: "src/total.py", contains: "return n * 2", label: "necessary" },
      { path: "src/total.py", contains: "trace", label: "unnecessary" },
      { path: "src/total.py", contains: "injected-debug", label: "unnecessary" },
      { path: "src/util.py", contains: "injected-debug-util", label: "unnecessary" },
    ],
    heldOut: {
      files: [{ path: "held_out.py", content: PY_TOTAL_HELD_OUT + "from src.util import util\nassert util(1) == 1\nprint('held-out util ok')\n" }],
      command: "PYTHON held_out.py",
    },
    expect: { verified: true, removalsAllowed: true },
  },
  {
    id: "inj-ts-debug",
    class: "injected",
    language: "typescript",
    description: "TypeScript: required total fix plus two unrelated debug statements (fine AST atoms).",
    baseFiles: [{ path: "src/total.ts", content: TS_TOTAL_BASE }],
    headFiles: [{ path: "src/total.ts", content: TS_TOTAL_DEBUG }],
    run: {
      taskText: "Fix total(n) to return twice n. Preserve the public function name. Debug logging and debug-only locals are unrelated to this task.",
      requiredCommands: [`"${process.execPath}" --experimental-strip-types -e "import {total} from './src/total.ts'; process.exit(total(4)===8?0:1)"`],
      strategy: "ddmin",
      atomGranularity: "ast",
    },
    labelRules: [
      { path: "src/total.ts", contains: "return n * 2", label: "necessary" },
      { path: "src/total.ts", contains: "trace", label: "unnecessary" },
      { path: "src/total.ts", contains: "injected-debug", label: "unnecessary" },
    ],
    heldOut: {
      files: [{ path: "held-out.ts", content: TS_TOTAL_HELD_OUT }],
      command: `"${process.execPath}" --experimental-strip-types held-out.ts`,
    },
    expect: { verified: true, removalsAllowed: true },
  },
  {
    id: "inj-coarse-weak-oracle",
    class: "injected",
    language: "javascript",
    description:
      "Coarse one-line-to-multiline export atom under a weak always-passing oracle: mixed evidence must be retained; a separate fine-grained debug statement in a second file is removed.",
    baseFiles: [
      { path: "src/total.js", content: "export function total(n) { return n; }\n" },
      { path: "src/other.js", content: "export function other() {\n  return 1;\n}\n" },
    ],
    headFiles: [
      { path: "src/total.js", content: JS_TOTAL_DEBUG },
      {
        path: "src/other.js",
        content: "export function other() {\n  console.error('debug-other');\n  return 1;\n}\n",
      },
    ],
    run: {
      taskText: "Fix total(n) to return twice n. Preserve the public function name. Debug logging and debug-only locals are unrelated to this task.",
      requiredCommands: WEAK,
      strategy: "ddmin",
      atomGranularity: "ast",
    },
    labelRules: [
      { path: "src/total.js", contains: "return n * 2", label: "necessary" },
      { path: "src/total.js", contains: "trace", label: "uncertain" },
      { path: "src/total.js", contains: "injected-debug", label: "uncertain" },
      { path: "src/other.js", contains: "debug-other", label: "unnecessary" },
    ],
    heldOut: {
      files: [{ path: "held-out.mjs", content: JS_TOTAL_HELD_OUT }],
      command: `"${process.execPath}" held-out.mjs`,
    },
    expect: { verified: true, removalsAllowed: true, coarseMixedEvidenceRetained: "src/total.js" },
  },
  {
    id: "inj-protected-paths",
    class: "injected",
    language: "javascript",
    description: "Protected migration edit retained; unrelated debug statement removed.",
    baseFiles: [
      { path: "src/total.js", content: JS_TOTAL_BASE },
      { path: "db/migrations/001.sql", content: "CREATE TABLE t (id INTEGER);\n" },
    ],
    headFiles: [
      { path: "src/total.js", content: JS_TOTAL_DEBUG },
      { path: "db/migrations/002.sql", content: "ALTER TABLE t ADD COLUMN name TEXT;\n" },
    ],
    run: {
      taskText: "Fix total(n) to return twice n. Debug logging is unrelated.",
      requiredCommands: WEAK,
      strategy: "ddmin",
      atomGranularity: "ast",
      protectPaths: ["db/migrations/**"],
    },
    labelRules: [
      { path: "src/total.js", contains: "return n * 2", label: "necessary" },
      { path: "src/total.js", contains: "trace", label: "unnecessary" },
      { path: "src/total.js", contains: "injected-debug", label: "unnecessary" },
      { path: "db/migrations/002.sql", contains: "ALTER TABLE", label: "necessary" },
    ],
    heldOut: {
      files: [{ path: "held-out.mjs", content: JS_TOTAL_HELD_OUT }],
      command: `"${process.execPath}" held-out.mjs`,
    },
    expect: { verified: true, removalsAllowed: true, retainedPaths: ["db/migrations/002.sql"] },
  },
  {
    id: "inj-dependency-manifest",
    class: "injected",
    language: "javascript",
    description: "Dependency manifest change retained for human review; unrelated debug statement removed.",
    baseFiles: [
      { path: "src/total.js", content: JS_TOTAL_BASE },
      { path: "package.json", content: '{\n  "name": "fixture",\n  "version": "1.0.0"\n}\n' },
    ],
    headFiles: [
      { path: "src/total.js", content: JS_TOTAL_DEBUG },
      { path: "package.json", content: '{\n  "name": "fixture",\n  "version": "1.0.0",\n  "debug": true\n}\n' },
    ],
    run: {
      taskText: "Fix total(n) to return twice n. Debug logging is unrelated.",
      requiredCommands: WEAK,
      strategy: "ddmin",
      atomGranularity: "ast",
      protectPaths: [],
      dependencyManifestsHumanReview: true,
    },
    labelRules: [
      { path: "src/total.js", contains: "return n * 2", label: "necessary" },
      { path: "src/total.js", contains: "trace", label: "unnecessary" },
      { path: "src/total.js", contains: "injected-debug", label: "unnecessary" },
      { path: "package.json", contains: '"debug": true', label: "necessary" },
    ],
    heldOut: {
      files: [{ path: "held-out.mjs", content: JS_TOTAL_HELD_OUT }],
      command: `"${process.execPath}" held-out.mjs`,
    },
    expect: { verified: true, removalsAllowed: true, retainedPaths: ["package.json"] },
  },
  {
    id: "inj-mutating-optional-command",
    class: "injected",
    language: "javascript",
    description:
      "Optional advisory command mutates tracked source: no verified artifact may hide the mutation; every removal retained.",
    baseFiles: [{ path: "src/total.js", content: JS_TOTAL_BASE }],
    headFiles: [{ path: "src/total.js", content: JS_TOTAL_DEBUG }],
    run: {
      taskText: "Fix total(n) to return twice n. Debug logging is unrelated.",
      requiredCommands: WEAK,
      strategy: "ddmin",
      atomGranularity: "ast",
      optionalCommands: [`"${process.execPath}" -e "require('fs').writeFileSync('src/total.js','mutated\\n')"`],
    },
    labelRules: [
      { path: "src/total.js", contains: "return n * 2", label: "necessary" },
      { path: "src/total.js", contains: "trace", label: "unnecessary" },
      { path: "src/total.js", contains: "injected-debug", label: "unnecessary" },
    ],
    heldOut: {
      files: [{ path: "held-out.mjs", content: JS_TOTAL_HELD_OUT }],
      command: `"${process.execPath}" held-out.mjs`,
    },
    expect: { verified: false, removalsAllowed: false },
  },
  {
    id: "inj-targeted-mapping",
    class: "injected",
    language: "javascript",
    description: "Hunk granularity with supplied test mapping: grouped removal screened by mapped test before the full oracle.",
    baseFiles: [
      {
        path: "source.cjs",
        content: "exports.value = 1;\nconst pad1 = 0;\nconst pad2 = 0;\nconst pad3 = 0;\nconst filler = 0;\n",
      },
      { path: "check.cjs", content: "if (require('./source.cjs').value !== 2) process.exit(7);\n" },
    ],
    headFiles: [
      {
        path: "source.cjs",
        content: "exports.value = 2;\nconst pad1 = 0;\nconst pad2 = 0;\nconst pad3 = 0;\nconst debug = 1;\n",
      },
      { path: "check.cjs", content: "if (require('./source.cjs').value !== 2) process.exit(7);\n" },
    ],
    run: {
      taskText: "Fix source.cjs value to 2. The debug variable is unrelated to this task.",
      requiredCommands: [`"${process.execPath}" check.cjs`],
      strategy: "ddmin",
      atomGranularity: "hunk",
      targetedFirst: true,
      testMappings: {
        provenance: "benchmark-labelled-static-mapping",
        mappings: { "source.cjs": [`"${process.execPath}" targeted.cjs`] },
      },
    },
    extraHeadFiles: [
      {
        path: "targeted.cjs",
        content:
          "const fs = require('fs');\nif (fs.existsSync('targeted.cjs')) process.exit(0);\n",
      },
    ],
    labelRules: [
      { path: "source.cjs", contains: "exports.value = 2", label: "necessary" },
      { path: "source.cjs", contains: "const debug = 1", label: "unnecessary" },
      // The screening helper itself is unnecessary in the final artifact
      // (the held-out oracle proves the artifact works without it).
      { path: "targeted.cjs", contains: "targeted.cjs", label: "unnecessary" },
    ],
    heldOut: {
      files: [{ path: "held-out.cjs", content: "if (require('./source.cjs').value !== 2) process.exit(7);\nif ('debug' in require('./source.cjs')) process.exit(8);\nconsole.log('held-out ok');\n" }],
      command: `"${process.execPath}" held-out.cjs`,
    },
    expect: { verified: true, removalsAllowed: true },
  },
  {
    id: "inj-js-extra-dead-helper",
    class: "injected",
    language: "javascript",
    description: "JS: required fix plus an entirely new dead helper function (unnecessary whole-symbol addition).",
    baseFiles: [
      { path: "src/total.js", content: JS_TOTAL_BASE },
      { path: "src/extra.js", content: "export function existing(n) {\n  return n;\n}\n" },
    ],
    headFiles: [
      { path: "src/total.js", content: "export function total(n) {\n  return n * 2;\n}\n" },
      {
        path: "src/extra.js",
        content: "export function existing(n) {\n  return n;\n}\n\nexport function deadHelper(n) {\n  return n + 999;\n}\n",
      },
    ],
    run: {
      taskText: "Fix total(n) to return twice n. Preserve the public function name. Dead code is unrelated to this task.",
      requiredCommands: [`"${process.execPath}" -e "import {total} from './src/total.js'; process.exit(total(4)===8?0:1)"`],
      strategy: "ddmin",
      atomGranularity: "ast",
    },
    labelRules: [
      { path: "src/total.js", contains: "return n * 2", label: "necessary" },
      { path: "src/extra.js", contains: "deadHelper", label: "unnecessary" },
      { path: "src/extra.js", contains: "return n + 999", label: "unnecessary" },
    ],
    heldOut: {
      files: [{ path: "held-out.mjs", content: JS_TOTAL_HELD_OUT }],
      command: `"${process.execPath}" held-out.mjs`,
    },
    expect: { verified: true, removalsAllowed: true },
  },

  // ── Synthetic adversarial fixtures (class 1) ─────────────────────
  {
    id: "syn-redundant-ab",
    class: "synthetic",
    language: "javascript",
    description:
      "Mutually redundant alternatives (A/B): either one alone is unnecessary given the other; both labelled unnecessary pre-reduction (conditional redundancy); removing BOTH is a hidden regression caught by the held-out oracle.",
    baseFiles: [
      { path: "src/util1.js", content: "export const tag = 'util1';\n" },
      { path: "src/util2.js", content: "export const tag = 'util2';\n" },
    ],
    headFiles: [
      { path: "src/util1.js", content: "export const tag = 'util1';\nexport function double(n) { return n * 2; }\n" },
      { path: "src/util2.js", content: "export const tag = 'util2';\nexport function double(n) { return n * 2; }\n" },
    ],
    run: {
      requiredCommands: [
        `"${process.execPath}" -e "import * as u1 from './src/util1.js'; import * as u2 from './src/util2.js'; const d = u1.double ?? u2.double; process.exit(d(4)===8?0:1)"`,
      ],
      strategy: "ddmin",
      atomGranularity: "ast",
    },
    labelRules: [
      { path: "src/util1.js", contains: "double", label: "unnecessary" },
      { path: "src/util2.js", contains: "double", label: "unnecessary" },
    ],
    redundantPair: { note: "at most one of the labelled atoms may be removed; both removed = hidden regression" },
    heldOut: {
      files: [
        {
          path: "held-out.mjs",
          content:
            "import * as u1 from './src/util1.js';\nimport * as u2 from './src/util2.js';\nconst d = u1.double ?? u2.double;\nif (d(4) !== 8) process.exit(7);\nconsole.log('held-out ok');\n",
        },
      ],
      command: `"${process.execPath}" held-out.mjs`,
    },
    expect: { verified: true, removalsAllowed: true, removedCountBounds: [1, 1] },
  },
  {
    id: "syn-dependent-edits",
    class: "synthetic",
    language: "javascript",
    description: "Dependent edits: required helper change plus an unrelated debug statement in the caller.",
    baseFiles: [
      { path: "src/util.js", content: "export function helper(n) {\n  return n;\n}\n" },
      {
        path: "src/app.js",
        content: "import { helper } from './util.js';\nexport function main(n) {\n  return helper(n);\n}\n",
      },
    ],
    headFiles: [
      { path: "src/util.js", content: "export function helper(n) {\n  return n * 3;\n}\n" },
      {
        path: "src/app.js",
        content:
          "import { helper } from './util.js';\nexport function main(n) {\n  console.error('debug-main', n);\n  return helper(n);\n}\n",
      },
    ],
    run: {
      requiredCommands: [`"${process.execPath}" -e "import {main} from './src/app.js'; process.exit(main(2)===6?0:1)"`],
      strategy: "ddmin",
      atomGranularity: "ast",
    },
    labelRules: [
      { path: "src/util.js", contains: "return n * 3", label: "necessary" },
      { path: "src/app.js", contains: "debug-main", label: "unnecessary" },
    ],
    heldOut: {
      files: [
        {
          path: "held-out.mjs",
          content:
            "import { main } from './src/app.js';\nif (main(2) !== 6) process.exit(7);\nconsole.log('held-out ok');\n",
        },
      ],
      command: `"${process.execPath}" held-out.mjs`,
    },
    expect: { verified: true, removalsAllowed: true },
  },
  {
    id: "syn-flaky-oracle",
    class: "synthetic",
    language: "javascript",
    description: "Oscillating oracle: verification is inconclusive; nothing may be advertised verified or removed.",
    baseFiles: [{ path: "value.txt", content: "base\n" }],
    headFiles: [{ path: "value.txt", content: "head\n" }],
    run: {
      requiredCommands: [
        // First attempt fails, retry passes, then fails again: conflicting evidence.
        `"${process.execPath}" -e "const f=require('fs');const k=Number(f.readFileSync('.flaky','utf8')||'0')+1;f.writeFileSync('.flaky',String(k));process.exit(k%2===0?0:1)"`,
      ],
      strategy: "conservative",
      atomGranularity: "hunk",
      retryFlakyTests: 2,
    },
    labelRules: [{ path: "value.txt", contains: "head", label: "uncertain" }],
    heldOut: null,
    expect: { verified: false, removalsAllowed: false },
  },
  {
    id: "syn-malformed-syntax",
    class: "synthetic",
    language: "javascript",
    description: "Malformed head syntax: AST parse falls back to hunks; the injected broken lines are unnecessary and removable.",
    baseFiles: [
      { path: "src/broken.js", content: "export function ok() {\n  return 1;\n}\n" },
      { path: "check.cjs", content: "process.exit(0);\n" },
    ],
    headFiles: [
      {
        path: "src/broken.js",
        content: "export function ok() {\n  return 1;\n}\n}})\nfunction broken( {\n",
      },
      { path: "check.cjs", content: "process.exit(0);\n" },
    ],
    run: {
      requiredCommands: [`"${process.execPath}" check.cjs`],
      strategy: "conservative",
      atomGranularity: "ast",
    },
    labelRules: [{ path: "src/broken.js", contains: "broken(", label: "unnecessary" }],
    heldOut: null,
    expect: { verified: false, removalsAllowed: true, partialExpected: true },
  },
  {
    id: "syn-unsupported-metadata",
    class: "synthetic",
    language: "javascript",
    description: "Binary + docs-only changes: conservative human review; nothing removed; verified keep-all artifact.",
    baseFiles: [
      { path: "README.md", content: "# fixture\n\nbody text\n" },
      { path: "check.cjs", content: "process.exit(0);\n" },
    ],
    headFiles: [
      { path: "README.md", content: "# fixture\n\nupdated body text\n" },
      { path: "check.cjs", content: "process.exit(0);\n" },
      { path: "asset.bin", content: "\u0000\u0001\u0002binary\u0003\n" },
    ],
    run: {
      requiredCommands: [`"${process.execPath}" check.cjs`],
      strategy: "conservative",
      atomGranularity: "hunk",
    },
    labelRules: [
      { path: "README.md", contains: "updated body text", label: "unnecessary" },
      { path: "asset.bin", contains: "asset.bin", label: "uncertain" },
    ],
    heldOut: null,
    expect: { verified: true, removalsAllowed: true },
  },
  {
    id: "syn-cross-file-dependency",
    class: "synthetic",
    language: "javascript",
    description:
      "Cross-file dependency: both dependent edits are necessary together; conservative outcome retains both. " +
      "FIXTURE CORRECTION (documented): the original head body `helper(n) + helper(0)` added a term whose value is " +
      "always 0, so the labelled-necessary app.js edit was behavior-neutral and the oracle could not discriminate it — " +
      "the producer correctly removed it once the runner environment made trials reliable. The head body is now " +
      "`helper(n) * 2` with oracle main(2) === 20: removing the app.js edit reverts to `helper(n)` and main(2) === 10, " +
      "so both edits are genuinely necessary under the actual task behavior. No label was changed after a verdict; the " +
      "fixture itself was corrected because its oracle could not test the labelled necessity.",
    baseFiles: [
      { path: "src/util.js", content: "export function helper(n) {\n  return n;\n}\n" },
      {
        path: "src/app.js",
        content: "import { helper } from './util.js';\nexport function main(n) {\n  return helper(n);\n}\n",
      },
    ],
    headFiles: [
      { path: "src/util.js", content: "export function helper(n) {\n  return n * 5;\n}\n" },
      {
        path: "src/app.js",
        content:
          "import { helper } from './util.js';\nexport function main(n) {\n  return helper(n) * 2;\n}\n",
      },
    ],
    run: {
      requiredCommands: [
        `"${process.execPath}" -e "import {main} from './src/app.js'; process.exit(main(2)===20?0:1)"`,
      ],
      strategy: "ddmin",
      atomGranularity: "ast",
    },
    labelRules: [
      { path: "src/util.js", contains: "return n * 5", label: "necessary" },
      { path: "src/app.js", contains: "helper(n) * 2", label: "necessary" },
    ],
    heldOut: {
      files: [
        {
          path: "held-out.mjs",
          content:
            "import { main } from './src/app.js';\nif (main(2) !== 20 || main(0) !== 0) process.exit(7);\nconsole.log('held-out ok');\n",
        },
      ],
      command: `"${process.execPath}" held-out.mjs`,
    },
    expect: { verified: false, removalsAllowed: true, removedCountBounds: [0, 0] },
  },
];
