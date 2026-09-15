import { describe, expect, it } from "bun:test";
import { SECRET_PATTERNS, containsSecret } from "./secrets.ts";

describe("containsSecret", () => {
  it("detects an OpenAI-style key (sk- prefix)", () => {
    // given
    const text = `export const KEY = "sk-${"a".repeat(20)}"`;

    // when // then
    expect(containsSecret(text)).toBe(true);
  });

  it("detects an AWS access key (AKIA prefix)", () => {
    // given
    const text = "AKIA0123456789ABCDEF";

    // when // then
    expect(containsSecret(text)).toBe(true);
  });

  it("detects a GitHub personal access token (ghp_ prefix)", () => {
    // given
    const text = `ghp_${"a".repeat(36)}`;

    // when // then
    expect(containsSecret(text)).toBe(true);
  });

  it("detects a Slack token (xox[baprs]- prefix)", () => {
    // given
    const text = "xoxb-1234567890-abcdef";

    // when // then
    expect(containsSecret(text)).toBe(true);
  });

  it("detects a PEM private key block", () => {
    // given
    const text = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...";

    // when // then
    expect(containsSecret(text)).toBe(true);
  });

  it("detects an EC private key block", () => {
    // given
    const text = "-----BEGIN EC PRIVATE KEY-----\nMHQCAQEE...";

    // when // then
    expect(containsSecret(text)).toBe(true);
  });

  it("detects a bare private key block", () => {
    // given
    const text = "-----BEGIN PRIVATE KEY-----\nMIIB...";

    // when // then
    expect(containsSecret(text)).toBe(true);
  });

  it("does not flag benign prose", () => {
    // given
    const text = "The access key identifier is redacted in the published transcript.";

    // when // then
    expect(containsSecret(text)).toBe(false);
  });

  it("does not flag a short sk- string below the length threshold", () => {
    // given
    const text = "sk-short";

    // when // then
    expect(containsSecret(text)).toBe(false);
  });

  it("exposes the pattern list", () => {
    // given // when // then
    expect(SECRET_PATTERNS.length).toBeGreaterThanOrEqual(5);
  });
});
