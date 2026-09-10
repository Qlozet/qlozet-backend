import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as http from 'http';

// ─── Workload Identity Federation (keyless Anthropic auth on Fly) ───
//
// On Fly, machines mint a 15-minute OIDC JWT from the local API socket and
// exchange it at Anthropic's /v1/oauth/token for a short-lived access token —
// no ANTHROPIC_API_KEY secret needed. Local dev has no /.fly/api socket, so
// it falls back to the API key. Full setup lives in the "Fly Workload
// Identity Runbook" artifact.
//
// The IDs below are grant coordinates, not secrets — the Fly-issued JWT is
// the credential. Env vars override them so a console-side rotation doesn't
// need a code change.

const FLY_API_SOCKET = '/.fly/api';
const OIDC_AUDIENCE = 'https://api.anthropic.com';
const EXCHANGE_URL = 'https://api.anthropic.com/v1/oauth/token';

const WIF_DEFAULTS = {
  federation_rule_id: 'fdrl_01TaYecwS1Y7993SyFs6bEan',
  organization_id: '00c95ec9-393d-423b-b733-2b856b67f657',
  service_account_id: 'svac_01MrpvQD3g1DyWnSErDViLa5',
  workspace_id: 'wrkspc_018JT7r8Jgf8zKPsH85FxaXL',
};

@Injectable()
export class AnthropicAuthService {
  private readonly logger = new Logger(AnthropicAuthService.name);

  private cached: { token: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  private get wifAvailable(): boolean {
    try {
      return fs.existsSync(FLY_API_SOCKET);
    } catch {
      return false;
    }
  }

  /** True when SOME way of authenticating exists (WIF socket or API key). */
  isConfigured(): boolean {
    return this.wifAvailable || !!this.config.get<string>('ANTHROPIC_API_KEY');
  }

  /**
   * Auth headers for an Anthropic API request. Prefers workload identity
   * (Bearer token); falls back to the ANTHROPIC_API_KEY x-api-key header —
   * including when a WIF exchange fails, so a console misconfiguration
   * degrades to the old behavior instead of an outage.
   */
  async headers(): Promise<Record<string, string>> {
    if (this.wifAvailable) {
      try {
        const token = await this.getAccessToken();
        return { authorization: `Bearer ${token}` };
      } catch (err: any) {
        this.logger.error(
          `Workload identity exchange failed, falling back to API key: ${err?.message}`,
        );
      }
    }
    const key = this.config.get<string>('ANTHROPIC_API_KEY');
    if (key) return { 'x-api-key': key };
    throw new ServiceUnavailableException(
      'The assistant is not configured (no workload identity and no ANTHROPIC_API_KEY).',
    );
  }

  private async getAccessToken(): Promise<string> {
    // 60s safety margin so a token never expires mid-request.
    if (this.cached && this.cached.expiresAt - 60_000 > Date.now()) {
      return this.cached.token;
    }
    // Single-flight: concurrent callers share one exchange (also keeps JTI
    // single-use enforcement happy — each exchange uses a fresh JWT).
    if (!this.inflight) {
      this.inflight = this.exchange().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** Mint a fresh OIDC JWT from Fly's machine-local API socket. */
  private fetchFlyJwt(): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath: FLY_API_SOCKET,
          path: '/v1/tokens/oidc',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          timeout: 10_000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            const jwt = data.trim().replace(/^"|"$/g, '');
            if (res.statusCode === 200 && jwt.split('.').length === 3) {
              resolve(jwt);
            } else {
              reject(
                new Error(
                  `Fly OIDC token request failed (${res.statusCode}): ${data.slice(0, 200)}`,
                ),
              );
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Fly OIDC request timed out')));
      req.end(JSON.stringify({ aud: OIDC_AUDIENCE }));
    });
  }

  private async exchange(): Promise<string> {
    const jwt = await this.fetchFlyJwt();
    const res = await fetch(EXCHANGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
        federation_rule_id:
          this.config.get<string>('ANTHROPIC_WIF_FEDERATION_RULE_ID') ||
          WIF_DEFAULTS.federation_rule_id,
        organization_id:
          this.config.get<string>('ANTHROPIC_WIF_ORGANIZATION_ID') ||
          WIF_DEFAULTS.organization_id,
        service_account_id:
          this.config.get<string>('ANTHROPIC_WIF_SERVICE_ACCOUNT_ID') ||
          WIF_DEFAULTS.service_account_id,
        workspace_id:
          this.config.get<string>('ANTHROPIC_WIF_WORKSPACE_ID') ||
          WIF_DEFAULTS.workspace_id,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`token exchange failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const body: any = await res.json();
    const token = body?.access_token;
    if (!token) throw new Error('token exchange returned no access_token');

    const ttlMs =
      Number(body?.expires_in) > 0
        ? Number(body.expires_in) * 1000
        : 10 * 60_000; // conservative default if the response omits expires_in
    this.cached = { token, expiresAt: Date.now() + ttlMs };
    this.logger.log(
      `Workload identity token acquired (ttl ~${Math.round(ttlMs / 60_000)}m).`,
    );
    return token;
  }
}
