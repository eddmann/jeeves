/**
 * Credential persistence and resolution.
 * Supports API key and OAuth credentials with file-locked token refresh.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";
import { refreshAnthropicToken, type OAuthTokens } from "./oauth";
import { log, formatError } from "../logger";

export type AuthCredential =
  | { type: "api_key"; key: string }
  | { type: "oauth"; accessToken: string; refreshToken: string; expiresAt: number };

export class AuthStorage {
  private credential: AuthCredential | null = null;

  constructor(
    private authPath: string = join(process.cwd(), "auth.json"),
    private _refreshToken: typeof refreshAnthropicToken = refreshAnthropicToken,
  ) {
    this.reload();
  }

  private reload(): void {
    if (!existsSync(this.authPath)) {
      this.credential = null;
      return;
    }
    try {
      this.credential = JSON.parse(readFileSync(this.authPath, "utf-8"));
    } catch {
      this.credential = null;
    }
  }

  private save(): void {
    const dir = dirname(this.authPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    writeFileSync(this.authPath, JSON.stringify(this.credential, null, 2), "utf-8");
    chmodSync(this.authPath, 0o600);
  }

  /**
   * Get the current credential, with auto-refresh for expired OAuth tokens.
   * Priority: 1) OAuth from auth.json (auto-refresh) -> 2) API key from auth.json -> 3) ANTHROPIC_API_KEY env
   */
  async getCredential(): Promise<AuthCredential | null> {
    // Check auth.json first
    if (this.credential) {
      if (this.credential.type === "api_key") {
        return this.credential;
      }
      if (this.credential.type === "oauth") {
        if (Date.now() < this.credential.expiresAt) {
          return this.credential;
        }
        // Token expired, try refresh with file lock
        return await this.refreshWithLock();
      }
    }

    // Fall back to environment variable
    const envKey = process.env.ANTHROPIC_API_KEY;
    if (envKey) {
      return { type: "api_key", key: envKey };
    }

    return null;
  }

  private async refreshWithLock(): Promise<AuthCredential | null> {
    // Ensure auth file exists for locking
    if (!existsSync(this.authPath)) {
      const dir = dirname(this.authPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      writeFileSync(this.authPath, "{}", "utf-8");
      chmodSync(this.authPath, 0o600);
    }

    let release: (() => Promise<void>) | undefined;

    try {
      release = await lockfile.lock(this.authPath, {
        retries: {
          retries: 10,
          factor: 2,
          minTimeout: 100,
          maxTimeout: 10000,
          randomize: true,
        },
        stale: 30000,
      });

      // Re-read after acquiring lock (another process may have refreshed)
      this.reload();

      if (!this.credential || this.credential.type !== "oauth") {
        return this.credential;
      }

      // Check if still expired
      if (Date.now() < this.credential.expiresAt) {
        return this.credential;
      }

      // Refresh the token
      const tokens = await this._refreshToken(this.credential.refreshToken);
      this.credential = {
        type: "oauth",
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      };
      this.save();
      return this.credential;
    } catch (err) {
      // Refresh failed — re-read to check if another instance succeeded
      this.reload();
      if (this.credential?.type === "oauth" && Date.now() < this.credential.expiresAt) {
        return this.credential;
      }
      log.error("auth", "OAuth token refresh failed", formatError(err));
      return null;
    } finally {
      if (release) {
        try {
          await release();
        } catch {
          // Ignore unlock errors
        }
      }
    }
  }

  async saveOAuth(tokens: OAuthTokens): Promise<void> {
    this.credential = {
      type: "oauth",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    };
    this.save();
  }

  async saveApiKey(key: string): Promise<void> {
    this.credential = { type: "api_key", key };
    this.save();
  }

  logout(): void {
    if (existsSync(this.authPath)) {
      const { unlinkSync } = require("fs");
      unlinkSync(this.authPath);
    }
    this.credential = null;
  }

  isOAuth(): boolean {
    return this.credential?.type === "oauth";
  }

  hasAuth(): boolean {
    return this.credential !== null || !!process.env.ANTHROPIC_API_KEY;
  }
}
