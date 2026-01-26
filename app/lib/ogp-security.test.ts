import { describe, expect, it } from "vitest";
import { type OGPData, generateOGPCard } from "./ogp";

describe("OGP card security", () => {
  it("should escape XSS payload in title", () => {
    const maliciousOgp: OGPData = {
      description: "Description",
      image: "https://example.com/image.png",
      siteName: "Site Name",
      title: "<script>alert('XSS')</script>",
      url: "https://example.com",
    };

    const html = generateOGPCard(maliciousOgp);

    // Should NOT contain raw script tag
    expect(html).not.toContain("<script>alert('XSS')</script>");
    // Should contain escaped version
    expect(html).toContain("&lt;script&gt;alert(&#039;XSS&#039;)&lt;/script&gt;");
  });

  it("should escape XSS payload in description", () => {
    const maliciousOgp: OGPData = {
      description: "\"><img src=x onerror=alert(1)>",
      image: "https://example.com/image.png",
      siteName: "Site Name",
      title: "Title",
      url: "https://example.com",
    };

    const html = generateOGPCard(maliciousOgp);

    expect(html).not.toContain("\"><img src=x onerror=alert(1)>");
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  });

  it("should escape XSS payload in siteName", () => {
    const maliciousOgp: OGPData = {
      description: "Description",
      image: "https://example.com/image.png",
      siteName: "<b>Bold</b>",
      title: "Title",
      url: "https://example.com",
    };

    const html = generateOGPCard(maliciousOgp);

    expect(html).not.toContain("<b>Bold</b>");
    expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt;");
  });

  it("should escape XSS payload in URL (href)", () => {
    const maliciousOgp: OGPData = {
      description: "Description",
      image: "https://example.com/image.png",
      siteName: "Site Name",
      title: "Title",
      url: 'https://example.com" onclick="alert(1)',
    };

    const html = generateOGPCard(maliciousOgp);

    expect(html).not.toContain('href="https://example.com" onclick="alert(1)"');
    // isSafeUrl rejects this malformed URL, so it becomes empty
    expect(html).toContain('href=""');
  });

  it("should escape XSS payload in image URL", () => {
    const maliciousOgp: OGPData = {
      description: "Description",
      image: 'https://example.com/image.png" onload="alert(1)',
      siteName: "Site Name",
      title: "Title",
      url: "https://example.com",
    };

    const html = generateOGPCard(maliciousOgp);

    expect(html).not.toContain('src="https://example.com/image.png" onload="alert(1)"');
    expect(html).toContain('src="https://example.com/image.png&quot; onload=&quot;alert(1)"');
  });

  it("should block javascript: protocol in URL (href)", () => {
    const maliciousOgp: OGPData = {
      description: "Description",
      image: "https://example.com/image.png",
      siteName: "Site Name",
      title: "Title",
      url: "javascript:alert(1)",
    };

    const html = generateOGPCard(maliciousOgp);

    // Should NOT contain the malicious URL
    expect(html).not.toContain('href="javascript:alert(1)"');
    // Should be empty or filtered
    expect(html).toContain('href=""');
  });

  it("should block javascript: protocol in image URL", () => {
    const maliciousOgp: OGPData = {
      description: "Description",
      image: "javascript:alert(1)",
      siteName: "Site Name",
      title: "Title",
      url: "https://example.com",
    };

    const html = generateOGPCard(maliciousOgp);

    // Should render NO IMAGE placeholder
    expect(html).toContain("NO IMAGE");
    expect(html).not.toContain('src="javascript:alert(1)"');
  });
});
