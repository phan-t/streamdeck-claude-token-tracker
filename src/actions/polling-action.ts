import streamDeck, {
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import { ClaudeError, getUsage } from "../claude/client";
import type { ActionSettings, ClaudeReadings } from "../claude/types";
import { errorImage } from "../render";

/** The concrete action instance type for keypad keys. */
type ActionInstance = WillAppearEvent<ActionSettings>["action"];

const DEFAULT_REFRESH_SECONDS = 300;
// The usage endpoint rate-limits aggressively; don't let users poll faster than this.
const MIN_REFRESH_SECONDS = 60;
// Ceiling for exponential backoff while the endpoint keeps returning 429.
const MAX_BACKOFF_MS = 30 * 60_000;

/** What each key is currently showing, used to fire a single alert per transition. */
type DisplayState = "ok" | "stale" | "no-data";

/** One visible key (action context) the plugin is currently driving. */
type KeyEntry = {
	action: ActionInstance;
	settings: ActionSettings;
	/** Last image pushed to this key, so we can skip redundant setImage calls. */
	lastImage?: string;
};

/**
 * Base class for keys that periodically fetch usage and redraw an image.
 *
 * All visible keys share **one** timer and **one** fetch cycle: each cycle fetches
 * once (via {@link getUsage}) and fans the result out to every key, rendered with
 * that key's own settings. The display state is global because every key reads the
 * same account, so failures are logged once — not once per key.
 *
 * The cycle self-schedules with `setTimeout` (not a fixed interval) so it can back
 * off when the endpoint rate-limits us: each 429 lengthens the next delay
 * (honouring a `Retry-After` header when present, else exponentially up to
 * {@link MAX_BACKOFF_MS}), snapping back to the configured interval on success.
 *
 * Cache softening: once we have a good reading, a failed/rate-limited poll keeps
 * that reading on screen marked **stale** (dimmed + amber dot) rather than
 * flipping to the setup error. The setup error appears only when there is no good
 * reading yet (first run / not signed in).
 */
export abstract class PollingAction extends SingletonAction<ActionSettings> {
	private readonly keys = new Map<string, KeyEntry>();

	private timer?: ReturnType<typeof setTimeout>;
	private polling = false;

	private lastReadings?: ClaudeReadings;
	/** True when the most recent poll failed but we still have a last-good reading. */
	private stale = false;
	/** Last state we alerted on, so we alert once per transition (not every poll). */
	private alertedState?: DisplayState;
	/** Consecutive rate-limited polls; drives the exponential backoff delay. */
	private backoffStep = 0;
	/** Server-advised wait from the most recent 429's Retry-After, if any. */
	private retryAfterMs?: number;

	/** Subclasses turn readings + settings into a key image (data URI). */
	protected abstract draw(readings: ClaudeReadings, settings: ActionSettings, stale: boolean): string;

	override async onWillAppear(ev: WillAppearEvent<ActionSettings>): Promise<void> {
		void ev.action.setTitle(""); // labels are baked into the image
		this.keys.set(ev.action.id, { action: ev.action, settings: ev.payload.settings });
		await this.renderKey(this.keys.get(ev.action.id)); // paint immediately from current state
		await this.poll();
		this.reschedule();
	}

	override onWillDisappear(ev: WillDisappearEvent<ActionSettings>): void {
		this.keys.delete(ev.action.id);
		this.reschedule(); // stops the shared timer once no keys remain
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ActionSettings>): Promise<void> {
		const entry = this.keys.get(ev.action.id) ?? { action: ev.action, settings: ev.payload.settings };
		entry.settings = ev.payload.settings;
		entry.lastImage = undefined; // force a repaint so a new refresh interval takes effect
		this.keys.set(ev.action.id, entry);
		await this.renderKey(entry);
		await this.poll();
		this.reschedule();
	}

	/** Pressing any key forces an immediate refresh for all keys. */
	override async onKeyDown(_ev: KeyDownEvent<ActionSettings>): Promise<void> {
		await this.poll(true);
		this.reschedule();
	}

	/** The configured base interval (shortest any key wants), or 0 if no keys. */
	private computePeriodMs(): number {
		let min = Number.POSITIVE_INFINITY;
		for (const { settings } of this.keys.values()) {
			const requested = settings.refreshSeconds;
			const seconds = Math.max(
				MIN_REFRESH_SECONDS,
				Number.isFinite(requested) ? (requested as number) : DEFAULT_REFRESH_SECONDS,
			);
			if (seconds < min) min = seconds;
		}
		return Number.isFinite(min) ? min * 1_000 : 0;
	}

	/** Delay until the next poll: the base interval, stretched while rate-limited. */
	private computeNextDelayMs(): number {
		const base = this.computePeriodMs();
		if (base === 0 || this.backoffStep === 0) return base;
		// Honour the server's Retry-After when given (never poll faster than base),
		// otherwise grow exponentially up to the cap.
		const backoff =
			this.retryAfterMs !== undefined
				? Math.max(base, this.retryAfterMs)
				: Math.min(base * 2 ** this.backoffStep, MAX_BACKOFF_MS);
		return backoff;
	}

	/** Arm the single shared timer for the next poll (or stop it when no keys remain). */
	private reschedule(): void {
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		const delay = this.computeNextDelayMs();
		if (delay === 0) return; // no visible keys
		this.timer = setTimeout(() => {
			void (async () => {
				await this.poll();
				this.reschedule();
			})();
		}, delay);
	}

	/** The state every key is currently displaying, derived from the global state. */
	private displayState(): DisplayState {
		if (!this.lastReadings) return "no-data";
		return this.stale ? "stale" : "ok";
	}

	/** Fetch once and fan the result (or error) out to every visible key. */
	private async poll(force = false): Promise<void> {
		if (this.keys.size === 0 || this.polling) return;
		this.polling = true;
		try {
			const wasStale = this.stale;
			try {
				this.lastReadings = await getUsage(force);
				this.stale = false;
				this.backoffStep = 0;
				this.retryAfterMs = undefined;
				if (wasStale) streamDeck.logger.info("Claude usage poll recovered.");
			} catch (err) {
				// Cache softening: keep the last good reading on screen, just marked stale.
				// With no good reading yet, fall through to the setup error image.
				this.stale = !!this.lastReadings;
				if (err instanceof ClaudeError && err.rateLimited) {
					this.backoffStep = Math.min(this.backoffStep + 1, 8);
					this.retryAfterMs = err.retryAfterMs;
				} else {
					this.backoffStep = 0;
					this.retryAfterMs = undefined;
				}
				if (!wasStale || !this.lastReadings) {
					const message = err instanceof ClaudeError ? err.message : String(err);
					streamDeck.logger.warn(`Claude usage poll failing: ${message}`);
				}
			}

			// Render once per distinct (settings, state) and reuse the image across keys.
			const memo = new Map<string, string>();
			await Promise.all([...this.keys.values()].map((entry) => this.renderKey(entry, memo)));

			// Alert each key once per transition into a degraded state (stale / no-data).
			const state = this.displayState();
			if (state !== "ok" && state !== this.alertedState) {
				await Promise.all([...this.keys.values()].map((entry) => entry.action.showAlert()));
			}
			this.alertedState = state;
		} finally {
			this.polling = false;
		}
	}

	/** Render one key from the current global state, painting only if it changed. */
	private renderKey(entry?: KeyEntry, memo?: Map<string, string>): Promise<void> {
		if (entry === undefined) return Promise.resolve();
		const image = this.imageFor(entry.settings, memo);
		if (entry.lastImage === image) return Promise.resolve();
		entry.lastImage = image;
		return entry.action.setImage(image);
	}

	/** Build (or reuse, via `memo`) the key image for the current global state. */
	private imageFor(settings: ActionSettings, memo?: Map<string, string>): string {
		if (!this.lastReadings) return errorImage();
		// Keys with identical settings render the same image this cycle — build once.
		const sig = `${this.stale ? 1 : 0}|${JSON.stringify(settings)}`;
		const cached = memo?.get(sig);
		if (cached !== undefined) return cached;
		const image = this.draw(this.lastReadings, settings, this.stale);
		memo?.set(sig, image);
		return image;
	}
}
