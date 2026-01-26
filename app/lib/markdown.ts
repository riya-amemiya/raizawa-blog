import { fetchOGP, generateOGPCard } from "./ogp";
import { SHIKI_THEME, getHighlighter, shikiTransformers } from "./shiki";
import MarkdownIt from "markdown-it";

// Initialize markdown-it
const md = MarkdownIt({ breaks: true, html: true });

// Regex constants for URL detection
// Group 1: Full match for <URL>
// Group 2: The URL inside <URL>
// Group 3: Full match for standalone URL
// Group 4: The URL itself
const COMBINED_URL_REGEX = /(^<(https?:\/\/[^\s>]+)>$)|(^(https?:\/\/[^\s]+)$)/gm;
const GROUP_INDEX_AUTOLINK_URL = 2;
const GROUP_INDEX_STANDALONE_URL = 4;

// Shiki plugin (initialized lazily)
let shikiInitialized = false;

const getLangFromTokenInfo = (info: string): string => {
  const [langPart] = info.split(/\s+/);
  if (langPart !== undefined && langPart !== "") {
    return langPart;
  }
  return "text";
};

const resolveLang = (lang: string, loadedLangs: string[]): string => {
  if (loadedLangs.includes(lang)) {
    return lang;
  }
  return "text";
};

const initShiki = async () => {
  if (shikiInitialized) {
    return;
  }

  const highlighter = await getHighlighter();

  // Custom fence renderer using Shiki
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    if (token === undefined) {
      return "";
    }
    const code = token.content;
    const lang = getLangFromTokenInfo(token.info);
    const meta = token.info.slice(lang.length).trim();
    const langToUse = resolveLang(lang, highlighter.getLoadedLanguages());

    return highlighter.codeToHtml(code, {
      lang: langToUse,
      meta: { __raw: meta },
      theme: SHIKI_THEME,
      transformers: shikiTransformers,
    });
  };

  shikiInitialized = true;
};

// Detect standalone URLs (on their own line only)
const detectStandaloneURLs = (markdown: string): string[] => {
  const urls: string[] = [];
  for (const match of markdown.matchAll(COMBINED_URL_REGEX)) {
    const url = match[GROUP_INDEX_AUTOLINK_URL] ?? match[GROUP_INDEX_STANDALONE_URL];
    if (url !== undefined && url !== "") {
      urls.push(url);
    }
  }
  // Remove duplicates
  return [...new Set(urls)];
};

const renderMarkdown = async (markdown: string): Promise<string> => {
  await initShiki();

  // Detect all standalone URLs
  const urls = detectStandaloneURLs(markdown);

  // Fetch OGP data for all URLs in parallel
  const ogpResults = await Promise.all(
    urls.map(async (url) => ({
      ogp: await fetchOGP(url),
      url,
    })),
  );

  const ogpMap = new Map(ogpResults.map(({ url, ogp }) => [url, generateOGPCard(ogp)]));

  // Replace standalone URLs with OGP cards in a single pass
  const processedMarkdown = markdown.replace(
    COMBINED_URL_REGEX,
    (match, _p1, url1, _p3, url2) => {
      const url = url1 ?? url2;
      const card = ogpMap.get(url);
      return card ?? match;
    },
  );

  return md.render(processedMarkdown);
};

export default renderMarkdown;
