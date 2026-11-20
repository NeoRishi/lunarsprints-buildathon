import { describe, it, expect, vi, afterEach } from "vitest";
import {
  failure,
  jsonBody,
  limitedBody,
  redactSensitive,
  sameOrigin,
  requestOrigin,
} from "../src/lib/http";
import { AppError } from "../src/features/lunarsprints/domain";
afterEach(() => vi.unstubAllEnvs());
describe("HTTP boundaries", () => {
  it("keeps PKCE confirmation and redirects on the browser's actual host", () => {
    expect(
      new URL(
        "/auth/callback",
        requestOrigin(
          new Request("http://localhost:3000/api/auth", {
            headers: { host: "127.0.0.1:3000" },
          }),
        ),
      ).origin,
    ).toBe("http://127.0.0.1:3000");
  });
  it("pins redirect and mutation origins when deployed behind a proxy", () => {
    vi.stubEnv("APP_ORIGIN", "https://sprints.example");
    const request = new Request("http://internal:3000/api/auth", {
      headers: { host: "internal:3000", origin: "https://sprints.example" },
    });
    expect(requestOrigin(request)).toBe("https://sprints.example");
    expect(() => sameOrigin(request)).not.toThrow();
  });
  it("accepts the real browser origin when Next normalizes localhost internally", () => {
    expect(() =>
      sameOrigin(
        new Request("http://localhost:3000/api/sprints", {
          method: "POST",
          headers: { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" },
        }),
      ),
    ).not.toThrow();
  });
  it("rejects a different origin and null origins", () => {
    for (const origin of ["https://untrusted.example", "null"])
      expect(() =>
        sameOrigin(
          new Request("http://localhost:3000/api/sprints", {
            method: "POST",
            headers: { Host: "127.0.0.1:3000", Origin: origin },
          }),
        ),
      ).toThrow("Cross-origin");
  });
  it("rejects writes without an Origin unless the browser marks them same-origin", () => {
    const post = (headers: Record<string, string>) =>
      new Request("http://localhost:3000/api/sprints", {
        method: "POST",
        headers: { Host: "127.0.0.1:3000", ...headers },
      });
    expect(() => sameOrigin(post({}))).toThrow("Cross-origin");
    expect(() => sameOrigin(post({ "Sec-Fetch-Site": "cross-site" }))).toThrow(
      "Cross-origin",
    );
    expect(() =>
      sameOrigin(post({ "Sec-Fetch-Site": "same-origin" })),
    ).not.toThrow();
  });
  it("never trusts the Host header in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "");
    const request = new Request("http://internal/api/auth", {
      headers: { host: "attacker.example" },
    });
    expect(() => requestOrigin(request)).toThrow("public address");
    vi.stubEnv("APP_ORIGIN", "https://sprints.neorishi.io");
    expect(requestOrigin(request)).toBe("https://sprints.neorishi.io");
  });
  it("limits streamed bodies even when Content-Length is absent", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("123456789"));
        controller.close();
      },
    });
    const request = new Request("http://localhost/api", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    await expect(limitedBody(request, 8)).rejects.toThrow("too large");
  });
  it("returns a recoverable input error for malformed JSON", async () => {
    await expect(
      jsonBody(
        new Request("http://localhost/api", {
          method: "POST",
          body: "{broken",
        }),
      ),
    ).rejects.toThrow("valid JSON");
  });
  it("redacts bearer tokens, API keys, JWTs, and cookies from error responses", async () => {
    const raw =
      "Failed with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.sig and key sk-proj-1234567890abcdef and cookie: sb-token=secret123";
    const scrubbed = redactSensitive(raw);
    expect(scrubbed).not.toContain("sk-proj-1234567890abcdef");
    expect(scrubbed).not.toContain("secret123");
    expect(scrubbed).toContain("[REDACTED]");
    const res = failure(new AppError("provider_unavailable", raw, 502));
    const payload = await res.json();
    expect(payload.error.message).not.toContain("sk-proj-1234567890abcdef");
    expect(payload.error.message).not.toContain("secret123");
  });
  it("redacts every cookie in a header rather than only the first cookie", () => {
    const result = redactSensitive(
      "Cookie: first=alpha; second=bravo\nAuthorization: Basic charlie",
    );
    for (const value of ["alpha", "bravo", "charlie"])
      expect(result).not.toContain(value);
  });
});
