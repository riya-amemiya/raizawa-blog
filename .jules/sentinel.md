## 2025-02-12 - Stored XSS in OGP Cards
**Vulnerability:** External OGP data (title, description, URL) was injected into HTML strings without escaping in `app/lib/ogp.ts`. This allowed Stored XSS via malicious external sites (Blind XSS) and `javascript:` protocol injection.
**Learning:** `generateOGPCard` constructed HTML manually using template literals without sanitization. Even though the source was "external URLs", the content of those URLs (OGP tags) is untrusted user input.
**Prevention:** Always escape HTML entities when interpolating strings into HTML. Use specific protocol validation (allowlist `http`/`https`) for URLs to prevent `javascript:` injection.
