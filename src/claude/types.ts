// Settings are `type` aliases (not interfaces) so they satisfy the SDK's
// JsonObject generic constraint via TypeScript's implicit index signatures.

/** Per-action settings. */
export type ActionSettings = {
	/** Polling interval in seconds (clamped to a sensible minimum). */
	refreshSeconds?: number;
};

/** One usage window as returned by the OAuth usage endpoint. */
export interface UsageWindow {
	/** Percentage of the limit consumed, 0–100. */
	utilization: number;
	/** ISO 8601 timestamp of when this window resets, or null if unknown. */
	resets_at: string | null;
}

/**
 * Shape of the (undocumented) `GET /api/oauth/usage` response — the same endpoint
 * Claude Code uses to power `/usage`. Only the fields we render are typed; the
 * response carries several other nullable windows we ignore.
 */
export interface UsageResponse {
	/** Current session (rolling 5-hour) window. */
	five_hour?: UsageWindow | null;
	/** Weekly (rolling 7-day) window across all models. */
	seven_day?: UsageWindow | null;
}

/** Normalized readings the action renders. */
export interface ClaudeReadings {
	/** Current session usage, percent (0–100). */
	sessionPct: number;
	/** Epoch millis when the session window resets, or null if unknown. */
	sessionResetsAt: number | null;
	/** Weekly usage, percent (0–100). */
	weeklyPct: number;
	/** Epoch millis when the weekly window resets, or null if unknown. */
	weeklyResetsAt: number | null;
	/** Epoch millis when these readings were fetched. */
	fetchedAt: number;
}
