import { describe, expect, it } from "bun:test";
import { computeFingerprint, computePreviewToken, topicKeyFromTitle } from "./hashing.ts";

describe("computePreviewToken", () => {
  it("is stable regardless of object key order", () => {
    // given
    const first = { outer: { b: 2, a: 1 }, z: true };
    const second = { z: true, outer: { a: 1, b: 2 } };

    // when
    const firstToken = computePreviewToken(first);
    const secondToken = computePreviewToken(second);

    // then
    expect(firstToken).toBe(secondToken);
  });

  it("produces a 64-char hex sha256 digest", () => {
    // given // when
    const token = computePreviewToken({ a: 1 });

    // then
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs for different payloads", () => {
    // given // when // then
    expect(computePreviewToken({ a: 1 })).not.toBe(computePreviewToken({ a: 2 }));
  });

  it("is order-stable for arrays of primitives", () => {
    // given
    const a = { list: [1, 2, 3] };
    const b = { list: [1, 2, 3] };

    // when // then
    expect(computePreviewToken(a)).toBe(computePreviewToken(b));
  });

  it("distinguishes a null property from an omitted property", () => {
    // given
    const withNull = { a: null };
    const withOmitted = { a: undefined };

    // when // then
    expect(computePreviewToken(withNull)).not.toBe(computePreviewToken(withOmitted));
  });
});

describe("computeFingerprint", () => {
  const source = { title: "Source", url: "https://example.test/a", accessedAt: "2026-08-16T00:00:00Z" };

  it("produces a 64-char hex sha256 digest", () => {
    // given // when
    const fingerprint = computeFingerprint(source, "Excerpt");

    // then
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is stable for the same source and excerpt", () => {
    // given // when // then
    expect(computeFingerprint(source, "Excerpt")).toBe(computeFingerprint(source, "Excerpt"));
  });

  it("differs when the excerpt differs", () => {
    // given // when // then
    expect(computeFingerprint(source, "A")).not.toBe(computeFingerprint(source, "B"));
  });

  it("differs when the source identity differs", () => {
    // given
    const other = { title: "Source", url: "https://example.test/b", accessedAt: "2026-08-16T00:00:00Z" };

    // when // then
    expect(computeFingerprint(source)).not.toBe(computeFingerprint(other));
  });
});

describe("topicKeyFromTitle", () => {
  it("slugifies a simple title", () => {
    // given // when // then
    expect(topicKeyFromTitle("Hello, World!")).toBe("hello-world");
  });

  it("de-accents Latin unicode and keeps CJK letters", () => {
    // given // when // then
    expect(topicKeyFromTitle("Café 漢字")).toBe("cafe-漢字");
  });

  it("caps the slug at 64 characters", () => {
    // given
    const longTitle = "a".repeat(80);

    // when
    const slug = topicKeyFromTitle(longTitle);

    // then
    expect(slug).toHaveLength(64);
    expect(slug).toBe("a".repeat(64));
  });

  it("caps a mixed title at 64 chars without a trailing hyphen", () => {
    // given
    const title = "word ".repeat(40).trim();

    // when
    const slug = topicKeyFromTitle(title);

    // then
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("falls back to untitled for an empty title", () => {
    // given // when // then
    expect(topicKeyFromTitle("")).toBe("untitled");
  });

  it("falls back to untitled for a punctuation-only title", () => {
    // given // when // then
    expect(topicKeyFromTitle("  !!!  ")).toBe("untitled");
  });

  it("lowercases the result", () => {
    // given // when // then
    expect(topicKeyFromTitle("HELLO WORLD")).toBe("hello-world");
  });
});
