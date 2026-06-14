/** Format a usage percentage for a Stream Deck key: "0%", "8%", "100%". */
export function formatPercent(pct: number): string {
	return `${Math.round(pct)}%`;
}

/**
 * Format the time remaining until a reset as a compact countdown for the key's
 * subtext: "now", "<1m", "42m", "5h 23m", "2d 4h".
 */
export function formatReset(resetsAt: number | null, now: number): string {
	if (resetsAt == null) return "—";

	const ms = resetsAt - now;
	if (ms <= 0) return "now";

	const totalMinutes = Math.floor(ms / 60_000);
	if (totalMinutes < 1) return "<1m";
	if (totalMinutes < 60) return `${totalMinutes}m`;

	const totalHours = Math.floor(totalMinutes / 60);
	if (totalHours < 24) {
		const minutes = totalMinutes % 60;
		return `${totalHours}h ${minutes}m`;
	}

	const days = Math.floor(totalHours / 24);
	const hours = totalHours % 24;
	return `${days}d ${hours}h`;
}
