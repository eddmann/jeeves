/**
 * OAuth PKCE flow against OpenAI's endpoints.
 * Allows login via ChatGPT Plus/Pro subscription.
 */

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPES = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlDecode(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64urlEncode(verifierBytes);

  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const challenge = base64urlEncode(new Uint8Array(hashBuffer));

  return { verifier, challenge };
}

/**
 * Extract the ChatGPT account ID from a JWT access token.
 */
function extractAccountId(accessToken: string): string {
  const parts = accessToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT shape");
  }
  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
  const accountId = payload[JWT_CLAIM_PATH]?.chatgpt_account_id;
  if (typeof accountId !== "string" || !accountId) {
    throw new Error("Missing chatgpt_account_id in access token");
  }
  return accountId;
}

function tokensFromResponse(data: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}): OAuthTokens {
  const accountId = extractAccountId(data.access_token);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    accountId,
  };
}

/**
 * Run the OAuth PKCE login flow.
 * @param onAuthUrl - Called with the URL the user should open in their browser
 * @param onPromptCode - Called to get the authorization code from the user
 */
export async function loginOpenAI(
  onAuthUrl: (url: string) => void,
  onPromptCode: () => Promise<string>,
): Promise<OAuthTokens> {
  const { verifier, challenge } = await generatePKCE();
  const state = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));

  const authParams = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "agent",
  });

  const authUrl = `${AUTHORIZE_URL}?${authParams.toString()}`;
  onAuthUrl(authUrl);

  const raw = await onPromptCode();

  // Parse code from redirect URL, code#state, or raw code
  let code: string;
  try {
    const url = new URL(raw.trim());
    const params = new URLSearchParams(url.search);
    code = params.get("code") ?? "";
  } catch {
    // Not a URL — try code#state format
    const parts = raw.trim().split("#");
    code = parts[0];
  }

  if (!code) {
    throw new Error("Missing authorization code");
  }

  // Token exchange uses form-encoded POST
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return tokensFromResponse(tokenData);
}

/**
 * Refresh an expired OAuth token.
 */
export async function refreshOpenAIToken(refreshToken: string): Promise<OAuthTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return tokensFromResponse(data);
}
