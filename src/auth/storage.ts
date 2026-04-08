/**
 * Credential persistence and resolution.
 * Supports OAuth credentials with file-locked token refresh.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";
import { refreshOpenAIToken, type OAuthTokens } from "./oauth";
import { log, formatError } from "../logger";

export class AuthStorage {
  private credential: OAuthTokens | null = null;

  constructor(
    private authPath: string = join(process.cwd(), "auth.json"),
    private _refreshToken: typeof refreshOpenAIToken = refreshOpenAIToken,
  ) {
    this.reload();
  }

  private reload(): void {
    if (!existsSync(this.authPath)) {
      this.credential = null;
      return;
    }
    try {
      const data = JSON.parse(readFileSync(this.authPath, "utf-8"));
      if (data?.accessToken && data.accountId) {
        this.credential = data;
      } else {
        this.credential = null;
      }
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

  /** Get the current credential, with auto-refresh for expired tokens. */
  async getCredential(): Promise<OAuthTokens | null> {
    if (this.credential) {
      if (Date.now() < this.credential.expiresAt) {
        return this.credential;
      }
      return await this.refreshWithLock();
    }
    return null;
  }

  private async refreshWithLock(): Promise<OAuthTokens | null> {
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

      if (!this.credential) {
        return this.credential;
      }

      // Check if still expired
      if (Date.now() < this.credential.expiresAt) {
        return this.credential;
      }

      // Refresh the token
      this.credential = await this._refreshToken(this.credential.refreshToken);
      this.save();
      return this.credential;
    } catch (err) {
      // Refresh failed — re-read to check if another instance succeeded
      this.reload();
      if (this.credential && Date.now() < this.credential.expiresAt) {
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
    this.credential = tokens;
    this.save();
  }

  logout(): void {
    if (existsSync(this.authPath)) {
      unlinkSync(this.authPath);
    }
    this.credential = null;
  }

  hasAuth(): boolean {
    return this.credential !== null;
  }
}
