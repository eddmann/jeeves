import { describe, test, expect, beforeEach, afterEach, setSystemTime } from "bun:test";
import { AuthStorage } from "../src/auth/storage";
import { createTempDir, cleanupTempDir } from "./helpers/temp-dir";
import { join } from "path";
import { readFileSync, statSync, writeFileSync } from "fs";
import type { OAuthTokens } from "../src/auth/oauth";

let tmpDir: string;
let savedKey: string | undefined;

beforeEach(() => {
  tmpDir = createTempDir();
  savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  else delete process.env.ANTHROPIC_API_KEY;
  cleanupTempDir(tmpDir);
  setSystemTime();
});

function authPath(): string {
  return join(tmpDir, "auth.json");
}

function stubRefresh(
  tokens?: Partial<OAuthTokens>,
): (refreshToken: string) => Promise<OAuthTokens> {
  return async () => ({
    accessToken: tokens?.accessToken ?? "new-access",
    refreshToken: tokens?.refreshToken ?? "new-refresh",
    expiresAt: tokens?.expiresAt ?? Date.now() + 3600_000,
  });
}

function failingRefresh(
  err: Error = new Error("refresh failed"),
): (refreshToken: string) => Promise<OAuthTokens> {
  return async () => {
    throw err;
  };
}

describe("AuthStorage", () => {
  test("no auth file returns null", async () => {
    const store = new AuthStorage(authPath());
    expect(await store.getCredential()).toBeNull();
  });

  test("corrupt JSON returns null", async () => {
    writeFileSync(authPath(), "not json{{{");
    const store = new AuthStorage(authPath());
    expect(await store.getCredential()).toBeNull();
  });

  test("saves and loads API key", async () => {
    const store = new AuthStorage(authPath());
    await store.saveApiKey("sk-test-123");
    const cred = await store.getCredential();
    expect(cred).toEqual({ type: "api_key", key: "sk-test-123" });
  });

  test("saves and loads OAuth tokens", async () => {
    const store = new AuthStorage(authPath(), stubRefresh());
    const future = Date.now() + 3600_000;
    await store.saveOAuth({
      accessToken: "access-tok",
      refreshToken: "refresh-tok",
      expiresAt: future,
    });
    const cred = await store.getCredential();
    expect(cred).toEqual({
      type: "oauth",
      accessToken: "access-tok",
      refreshToken: "refresh-tok",
      expiresAt: future,
    });
  });

  test("file permissions set to 0o600", async () => {
    const store = new AuthStorage(authPath());
    await store.saveApiKey("sk-secret");
    const mode = statSync(authPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("valid OAuth returned without refresh", async () => {
    let refreshCalled = false;
    const refresh = async () => {
      refreshCalled = true;
      return { accessToken: "x", refreshToken: "x", expiresAt: 0 };
    };
    const store = new AuthStorage(authPath(), refresh);
    await store.saveOAuth({
      accessToken: "valid",
      refreshToken: "rt",
      expiresAt: Date.now() + 3600_000,
    });
    const cred = await store.getCredential();
    expect(cred?.type).toBe("oauth");
    expect(refreshCalled).toBe(false);
  });

  test("expired OAuth triggers refresh", async () => {
    const store = new AuthStorage(authPath(), stubRefresh({ accessToken: "refreshed" }));
    await store.saveOAuth({
      accessToken: "expired",
      refreshToken: "rt",
      expiresAt: Date.now() + 1000,
    });
    // Advance time past expiry
    setSystemTime(new Date(Date.now() + 2000));
    const cred = await store.getCredential();
    expect(cred).toMatchObject({ type: "oauth", accessToken: "refreshed" });
  });

  test("refresh persists new tokens to disk", async () => {
    const store = new AuthStorage(
      authPath(),
      stubRefresh({ accessToken: "persisted", refreshToken: "new-rt", expiresAt: 9999999999999 }),
    );
    await store.saveOAuth({
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: Date.now() + 1000,
    });
    setSystemTime(new Date(Date.now() + 2000));
    await store.getCredential();
    const onDisk = JSON.parse(readFileSync(authPath(), "utf-8"));
    expect(onDisk.accessToken).toBe("persisted");
  });

  test("refresh failure returns null", async () => {
    const store = new AuthStorage(authPath(), failingRefresh());
    await store.saveOAuth({
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: Date.now() + 1000,
    });
    setSystemTime(new Date(Date.now() + 2000));
    const cred = await store.getCredential();
    expect(cred).toBeNull();
  });

  test("refresh failure re-reads file (another instance may have succeeded)", async () => {
    const path = authPath();
    const store = new AuthStorage(path, failingRefresh());
    await store.saveOAuth({
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: Date.now() + 1000,
    });
    setSystemTime(new Date(Date.now() + 2000));
    // Simulate another process writing a fresh token before our refresh fails
    writeFileSync(
      path,
      JSON.stringify({
        type: "oauth",
        accessToken: "from-other-process",
        refreshToken: "rt2",
        expiresAt: Date.now() + 3600_000,
      }),
    );
    const cred = await store.getCredential();
    // Should have re-read the file and found a valid token
    expect(cred).toMatchObject({ type: "oauth", accessToken: "from-other-process" });
  });

  test("falls back to ANTHROPIC_API_KEY env var", async () => {
    process.env.ANTHROPIC_API_KEY = "env-key-123";
    const store = new AuthStorage(authPath());
    const cred = await store.getCredential();
    expect(cred).toEqual({ type: "api_key", key: "env-key-123" });
  });

  test("returns null with no credential and no env", async () => {
    const store = new AuthStorage(authPath());
    expect(await store.getCredential()).toBeNull();
  });

  test("logout deletes file", async () => {
    const store = new AuthStorage(authPath());
    await store.saveApiKey("key");
    store.logout();
    const { existsSync } = require("fs");
    expect(existsSync(authPath())).toBe(false);
  });

  test("logout on missing file does not throw", () => {
    const store = new AuthStorage(authPath());
    expect(() => store.logout()).not.toThrow();
  });

  test("isOAuth returns correct boolean", async () => {
    const store = new AuthStorage(authPath());
    expect(store.isOAuth()).toBe(false);
    await store.saveApiKey("key");
    expect(store.isOAuth()).toBe(false);
    await store.saveOAuth({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 3600_000,
    });
    expect(store.isOAuth()).toBe(true);
  });

  test("hasAuth true with credential", async () => {
    const store = new AuthStorage(authPath());
    expect(store.hasAuth()).toBe(false);
    await store.saveApiKey("key");
    expect(store.hasAuth()).toBe(true);
  });

  test("hasAuth true with env var only", () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    const store = new AuthStorage(authPath());
    expect(store.hasAuth()).toBe(true);
  });
});
