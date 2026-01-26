import { describe, expect, it, vi, beforeEach } from "vitest";
import renderMarkdown from "./markdown";
import { fetchOGP, generateOGPCard } from "./ogp";

vi.mock("./ogp", () => ({
  fetchOGP: vi.fn(),
  generateOGPCard: vi.fn(),
}));

describe("markdown ogp replacement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should replace standalone URLs with OGP cards", async () => {
    const url = "https://example.com";
    const ogpData = {
        title: "Example",
        description: "Desc",
        image: "",
        siteName: "Site",
        url
    };
    const cardHtml = '<div class="ogp-card">Card</div>';

    vi.mocked(fetchOGP).mockResolvedValue(ogpData);
    vi.mocked(generateOGPCard).mockReturnValue(cardHtml);

    const markdown = `Here is a link:\n\n${url}\n\nEnd`;
    const html = await renderMarkdown(markdown);

    expect(fetchOGP).toHaveBeenCalledWith(url);
    expect(generateOGPCard).toHaveBeenCalledWith(ogpData);
    expect(html).toContain(cardHtml);
    // MarkdownIt wraps text in paragraphs usually, but if replaced by block level element it might be different.
    // OGP card is likely block level (div/a with display block).
    // But since it's just string replacement before markdown render, it becomes part of the markdown source.
    // If it's HTML, MarkdownIt with {html: true} will render it as is.
  });

  it("should replace autolink URLs with OGP cards", async () => {
    const url = "https://example.com";
    const ogpData = {
        title: "Example",
        description: "Desc",
        image: "",
        siteName: "Site",
        url
    };
    const cardHtml = '<div class="ogp-card">Card</div>';

    vi.mocked(fetchOGP).mockResolvedValue(ogpData);
    vi.mocked(generateOGPCard).mockReturnValue(cardHtml);

    const markdown = `Here is a link:\n\n<${url}>\n\nEnd`;
    const html = await renderMarkdown(markdown);

    expect(fetchOGP).toHaveBeenCalledWith(url);
    expect(html).toContain(cardHtml);
  });

  it("should NOT replace inline URLs", async () => {
    const url = "https://example.com";
    const markdown = `Check ${url} inside text`;

    // We expect fetchOGP NOT to be called because the regex requires start/end of line

    const html = await renderMarkdown(markdown);

    expect(fetchOGP).not.toHaveBeenCalled();
    expect(html).toContain(url);
  });

  it("should handle multiple URLs", async () => {
      const url1 = "https://example.com/1";
      const url2 = "https://example.com/2";

      const ogpData1 = { title: "1", description: "", image: "", siteName: "", url: url1 };
      const ogpData2 = { title: "2", description: "", image: "", siteName: "", url: url2 };

      vi.mocked(fetchOGP).mockImplementation(async (u) => {
          if (u === url1) return ogpData1;
          if (u === url2) return ogpData2;
          throw new Error("Unexpected URL");
      });

      vi.mocked(generateOGPCard).mockImplementation((data) => `<div>${data.title}</div>`);

      const markdown = `${url1}\n\n${url2}`;
      const html = await renderMarkdown(markdown);

      expect(html).toContain("<div>1</div>");
      expect(html).toContain("<div>2</div>");
  });
});
