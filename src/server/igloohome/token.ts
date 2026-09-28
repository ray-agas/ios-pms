import "server-only";

import { ProviderError, toProviderError } from "./errors";
import { tokenResponseSchema } from "./schemas";

// Client-credentials token (H1). Held in memory only — never logged, never stored.

export interface TokenSettings {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  timeoutMs: number;
}

export interface GrantedToken {
  accessToken: string;
  expiresAt: number;
}

const MAX_REFRESH_MARGIN_MS = 60 * 60 * 1000; // vendor guidance: refresh ~1 h before expiry

export class TokenProvider {
  private cached?: GrantedToken;
  private inflight?: Promise<GrantedToken>;

  constructor(
    private readonly settings: TokenSettings,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    /** Plan F3 scope sync only: request WITHOUT `scope` (= every permission) to read the ceiling from server-health. */
    private readonly allScopes = false,
  ) {
    if (!allScopes && settings.scopes.length === 0) {
      // Omitting `scope` grants ALL permissions (docs), so we never send a token request without it.
      throw new ProviderError("forbidden_operation", "Refusing to request a token without explicit scopes");
    }
  }

  async getToken(): Promise<string> {
    if (this.cached && this.now() < this.cached.expiresAt) return this.cached.accessToken;
    this.inflight ??= this.fetchToken().finally(() => (this.inflight = undefined));
    this.cached = await this.inflight;
    return this.cached.accessToken;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  private async fetchToken(): Promise<GrantedToken> {
    const { tokenUrl, clientId, clientSecret, scopes, timeoutMs } = this.settings;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    let response: Response;
    try {
      response = await this.fetchImpl(tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams(this.allScopes ? { grant_type: "client_credentials" } : { grant_type: "client_credentials", scope: scopes.join(" ") }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new ProviderError("unavailable", `Token endpoint unreachable: ${(cause as Error).name}`);
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // OAuth errors come back as {"error":"invalid_client"} etc. — map invalid_client to an auth error.
      const oauthError = (body as { error?: string } | null)?.error;
      if (oauthError === "invalid_client" || response.status === 401) {
        throw new ProviderError("auth", `Token request rejected (${oauthError ?? response.status})`, {
          status: response.status,
        });
      }
      throw toProviderError(response.status, body);
    }

    const parsed = tokenResponseSchema.safeParse(body);
    if (!parsed.success) throw new ProviderError("contract", "Token response did not match the documented shape");

    const lifetimeMs = parsed.data.expires_in * 1000;
    const margin = Math.min(MAX_REFRESH_MARGIN_MS, lifetimeMs / 2);
    return { accessToken: parsed.data.access_token, expiresAt: this.now() + lifetimeMs - margin };
  }
}
