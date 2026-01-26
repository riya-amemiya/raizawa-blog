import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchOGP } from "./ogp";

// Mock global fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe("fetchOGP resource optimization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should skip non-HTML content", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Type": "image/png" }),
      body: new ReadableStream(),
    });

    const ogp = await fetchOGP("https://example.com/image.png");

    // Should return empty/default OGP because html was skipped (empty string returned)
    expect(ogp.title).toBe("");
    expect(ogp.description).toBe("");
  });

  it("should process HTML content", async () => {
    const html = '<html><head><meta property="og:title" content="Test Title"></head></html>';
    const encoder = new TextEncoder();

    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Type": "text/html; charset=utf-8" }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(html));
          controller.close();
        }
      }),
    });

    const ogp = await fetchOGP("https://example.com/page");

    expect(ogp.title).toBe("Test Title");
  });

  it("should stop reading stream when limit is reached", async () => {
    let cancelled = false;

    const stream = new ReadableStream({
      start(controller) {
          // Send 70KB in 7 chunks of 10KB
          for (let i = 0; i < 7; i++) {
              controller.enqueue(new Uint8Array(10 * 1024));
          }
          // We don't close, to verify cancel is called
      },
      cancel() {
        cancelled = true;
      }
    });

    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Type": "text/html" }),
      body: stream,
    });

    await fetchOGP("https://example.com/large-page");

    expect(cancelled).toBe(true);
  });
});
