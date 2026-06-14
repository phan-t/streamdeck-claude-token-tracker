import { action } from "@elgato/streamdeck";
import { formatReset } from "../claude/format";
import type { ActionSettings, ClaudeReadings } from "../claude/types";
import { barsImage } from "../render";
import { PollingAction } from "./polling-action";

// Claude brand-ish tones: warm clay for the session, soft blue for the week, so
// the two bars stay easy to tell apart at a glance.
const SESSION_COLOR = "#D97757";
const WEEKLY_COLOR = "#6C9BD1";

/** A single key showing both the current session (5h) and weekly (7d) Claude usage. */
@action({ UUID: "tphan.claudeusage.tracker" })
export class Usage extends PollingAction {
	protected override draw(readings: ClaudeReadings, _settings: ActionSettings, stale: boolean): string {
		const now = Date.now();
		return barsImage({
			stale,
			rows: [
				{
					label: "Session",
					percent: readings.sessionPct,
					color: SESSION_COLOR,
					subtext: formatReset(readings.sessionResetsAt, now),
				},
				{
					label: "Weekly",
					percent: readings.weeklyPct,
					color: WEEKLY_COLOR,
					subtext: formatReset(readings.weeklyResetsAt, now),
				},
			],
		});
	}
}
