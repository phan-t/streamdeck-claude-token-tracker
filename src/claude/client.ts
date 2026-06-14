import { execFile } from "node:child_process";
import { request } from "node:https";
import { homedir, userInfo } from "node:os";
import { readFile } from "node:fs/promises";
import type { ClaudeReadings, UsageResponse, UsageWindow } from "./types";

/** How long a fetched reading is reused so multiple keys share one request. */
const CACHE_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;

const USAGE_HOST = "api.anthropic.com";
const USAGE_PATH = "/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";
// The endpoint hands non-Claude-Code clients an aggressively rate-limited bucket
// (persistent 429s). Identifying as claude-code lands us in the generous bucket.
const USER_AGENT = "claude-code/1.0.0 (streamdeck-claude-token-tracker)";

/** Name of the macOS Keychain item Claude Code stores its OAuth tokens under. */
const KEYCHAIN_SERVICE = "Claude Code-credentials";

/** Re-read the token this long before it actually expires, to avoid 401 churn. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;
/** Fallback in-memory token lifetime when the credentials carry no expiry. */
const TOKEN_FALLBACK_TTL_MS = 5 * 60_000;

/** Errors with a user-facing message safe to show on a key / log. */
export class ClaudeError extends Error {
	/** The credentials were rejected (HTTP 401/403) — the user must (re)sign in. */
	readonly unauthorized: boolean;
	/** The request was rate-limited (HTTP 429); back off before retrying. */
	readonly rateLimited: boolean;
	/** Server-advised wait before retrying, in millis (from a Retry-After header). */
	readonly retryAfterMs?: number;

	constructor(message: string, opts: { unauthorized?: boolean; rateLimited?: boolean; retryAfterMs?: number } = {}) {
		super(message);
		this.unauthorized = !!opts.unauthorized;
		this.rateLimited = !!opts.rateLimited;
		this.retryAfterMs = opts.retryAfterMs;
	}
}

let cache: { readings: ClaudeReadings } | undefined;
let inflight: Promise<ClaudeReadings> | undefined;
// Cache the OAuth token in memory so steady-state polls don't spawn `security`
// (or re-read the credentials file) every cycle — only near expiry or after a 401.
let tokenCache: { token: string; expiresAt: number } | undefined;

/** Read a raw secret from the macOS login Keychain via the `security` CLI. */
function readKeychainSecret(service: string): Promise<string | undefined> {
	return new Promise((resolve, reject) => {
		execFile(
			"security",
			["find-generic-password", "-s", service, "-a", userInfo().username, "-w"],
			{ timeout: REQUEST_TIMEOUT_MS },
			(err, stdout) => {
				if (err) {
					// Fall back to a service-only lookup (account name may differ).
					execFile(
						"security",
						["find-generic-password", "-s", service, "-w"],
						{ timeout: REQUEST_TIMEOUT_MS },
						(err2, stdout2) => {
							if (err2) return resolve(undefined);
							resolve(stdout2.trim() || undefined);
						},
					);
					return;
				}
				resolve(stdout.trim() || undefined);
			},
		);
	});
}

/**
 * Pull the OAuth access token Claude Code maintains for the signed-in user.
 *
 * The token is cached in memory until shortly before its expiry; pass
 * `force` (e.g. after a 401) to bypass the cache and re-read the source, picking
 * up a token Claude Code may have rotated in the background.
 */
async function getAccessToken(force = false): Promise<string> {
	if (!force && tokenCache && Date.now() < tokenCache.expiresAt - TOKEN_EXPIRY_SKEW_MS) {
		return tokenCache.token;
	}

	// Primary source on macOS: the Keychain item Claude Code writes/refreshes.
	const raw =
		process.platform === "darwin"
			? await readKeychainSecret(KEYCHAIN_SERVICE)
			: // Other platforms keep the same JSON in a file under ~/.claude.
				await readFile(`${homedir()}/.claude/.credentials.json`, "utf8").catch(() => undefined);

	if (!raw) {
		throw new ClaudeError("Sign in with Claude Code first.", { unauthorized: true });
	}

	let oauth: { accessToken?: string; expiresAt?: number } | undefined;
	try {
		oauth = JSON.parse(raw)?.claudeAiOauth;
	} catch {
		throw new ClaudeError("Couldn't read Claude credentials.");
	}

	const token = oauth?.accessToken;
	if (!token) {
		throw new ClaudeError("Sign in with Claude Code first.", { unauthorized: true });
	}

	// `expiresAt` is epoch millis when present; otherwise cache briefly so a rotated
	// token is still picked up reasonably soon.
	const expiresAt =
		typeof oauth?.expiresAt === "number" && oauth.expiresAt > Date.now()
			? oauth.expiresAt
			: Date.now() + TOKEN_FALLBACK_TTL_MS;
	tokenCache = { token, expiresAt };
	return token;
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) to millis, if usable. */
function parseRetryAfter(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
	const when = Date.parse(value);
	return Number.isFinite(when) ? Math.max(0, when - Date.now()) : undefined;
}

/** GET the OAuth usage report as JSON. */
function fetchUsage(token: string): Promise<UsageResponse> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: USAGE_HOST,
				path: USAGE_PATH,
				method: "GET",
				timeout: REQUEST_TIMEOUT_MS,
				headers: {
					Authorization: `Bearer ${token}`,
					"anthropic-beta": OAUTH_BETA,
					"User-Agent": USER_AGENT,
					Accept: "application/json",
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					const status = res.statusCode ?? 0;
					if (status === 401 || status === 403) {
						return reject(new ClaudeError("Sign in with Claude Code first.", { unauthorized: true }));
					}
					if (status === 429) {
						const retryAfterMs = parseRetryAfter(res.headers["retry-after"]);
						return reject(new ClaudeError("Rate limited — backing off.", { rateLimited: true, retryAfterMs }));
					}
					if (status < 200 || status >= 300) {
						return reject(new ClaudeError(`Usage API returned HTTP ${status}.`));
					}
					try {
						resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as UsageResponse);
					} catch {
						reject(new ClaudeError("Usage API returned invalid JSON."));
					}
				});
			},
		);
		req.on("timeout", () => req.destroy(new ClaudeError("Usage request timed out.")));
		req.on("error", (err) => reject(err instanceof ClaudeError ? err : new ClaudeError(err.message)));
		req.end();
	});
}

/** Clamp a window's utilization to 0–100 and parse its reset timestamp to millis. */
function window(w: UsageWindow | null | undefined): { pct: number; resetsAt: number | null } {
	const pct = Math.min(100, Math.max(0, w?.utilization ?? 0));
	const resetsAt = w?.resets_at ? Date.parse(w.resets_at) : NaN;
	return { pct, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null };
}

function normalize(data: UsageResponse, fetchedAt: number): ClaudeReadings {
	const session = window(data.five_hour);
	const weekly = window(data.seven_day);
	return {
		sessionPct: session.pct,
		sessionResetsAt: session.resetsAt,
		weeklyPct: weekly.pct,
		weeklyResetsAt: weekly.resetsAt,
		fetchedAt,
	};
}

/**
 * Get current usage, reusing a recent fetch (and de-duplicating concurrent calls)
 * so a Stream Deck full of keys hits the API once per cycle.
 */
export async function getUsage(force = false): Promise<ClaudeReadings> {
	if (!force && cache && Date.now() - cache.readings.fetchedAt < CACHE_TTL_MS) {
		return cache.readings;
	}
	if (inflight) return inflight;

	inflight = (async () => {
		try {
			let data: UsageResponse;
			try {
				data = await fetchUsage(await getAccessToken());
			} catch (err) {
				// A 401 likely means the cached token was rotated/expired — re-read the
				// source once and retry before surfacing a sign-in error.
				if (err instanceof ClaudeError && err.unauthorized) {
					data = await fetchUsage(await getAccessToken(true));
				} else {
					throw err;
				}
			}
			const readings = normalize(data, Date.now());
			cache = { readings };
			return readings;
		} finally {
			inflight = undefined;
		}
	})();
	return inflight;
}
