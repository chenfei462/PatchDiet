# LLM Assisted Mode

PatchDiet does not call an LLM by default.

`intelligence.mode: llm-assisted` is reserved for future semantic ranking. It must not silently upload source or override test-verified cleanup decisions.

Before enabling any LLM path, an implementation must provide:

- explicit opt-in config
- data sent preview
- redaction and exclude paths
- provider and model disclosure
- retention policy
- prompt-injection handling
- local-only fallback

LLM output may rank or explain candidates. It must not be treated as verification.
