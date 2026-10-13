# LLM Assisted Mode

PatchDiet does not call an LLM by default.

`intelligence.mode: llm-assisted` remains reserved for future semantic ranking. The isolated development candidate adds a separate advisory-only `patchdiet intent-extract` command. It does not alter the reducer, scope eligibility, verification commands or cleanup patch.

Local extraction uses `patchdiet intent-extract --sources path/to/sources.json`. The file must be repository-local JSON containing an array of the existing `IntentSourceDocument` objects. For a cloud request, specify `--provider-url https://... --model ... --upload-consent` together and set `PATCHDIET_INTENT_API_TOKEN` in the environment. The command uploads only the named source documents, to the explicitly configured HTTPS endpoint; the request is capped at 16 KiB. It never reads hidden conventional files, follows HTTP redirects or uses the ZCode account credentials. Without all explicit cloud options, the command stays local or rejects an incomplete request.

The provider must return strict `patchdiet-cloud-intent/1` JSON with `goal`, up to 50 statements (`kind`, `sourceId`, byte `startByte`/`endByte`, verbatim `text`) and up to 25 contradiction index pairs. The adapter checks each UTF-8 span against the exact uploaded source bytes and rejects unknown response fields, invalid references and oversized responses. Timeout, malformed output or provider failure produces a local fallback with a diagnostic. The local normalized intent is never overwritten, and cloud suggestions cannot authorize removal.

Before promoting this adapter into a production LLM workflow, an implementation must additionally provide:

- a user-facing preview of the exact data sent and path redaction or exclusions
- provider retention terms and a product disclosure of the chosen model
- prompt-injection review and hosted transport integration tests
- explicit assessment of privacy and customer consent

LLM output may rank or explain candidates. It must not be treated as verification.
