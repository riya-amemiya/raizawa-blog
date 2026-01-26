## 2026-01-26 - OGP Fetch Optimization & Regex Refactoring
**Learning:** `fetch` response bodies should be consumed as streams when only a partial read is needed (e.g. `<head>` parsing) to save bandwidth and memory. Standard `replace` with a callback is O(N) vs O(N*M) for repeated replacements.
**Action:** Always check `Content-Type` and limit download size when fetching external resources for metadata extraction. Use single-pass regex replacement for multiple patterns.
