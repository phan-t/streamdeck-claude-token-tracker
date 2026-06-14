const escapeXml = (s: string): string =>
	s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

const toDataUri = (svg: string): string => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// Key canvas is rendered at 144x144 (the @2x size); Stream Deck scales it down.
const SIZE = 144;
const MARGIN = 10;
const BAR_X = 14;
const BAR_W = SIZE - BAR_X * 2;
const BAR_H = 14;
const RADIUS = BAR_H / 2;
// Height of one row's stacked content (label + bar + value), used to center each
// row within its share of the key so the whole layout sits evenly top-to-bottom.
const CONTENT_H = 56;
// Extra vertical separation pushed between adjacent rows (first row up, last down).
const GROUP_GAP = 10;

const FONT = "Helvetica, Arial, sans-serif";

export type BarRow = {
	label: string;
	/** Fill level for this row, 0–100. */
	percent: number;
	color: string;
	/** Small caption shown beneath the bar (e.g. the reset countdown). */
	subtext: string;
};

/**
 * Stacked horizontal bar gauges on one key — one row per reading. The bar fills
 * to `percent` (0–100); the percentage is printed by the label and the reset
 * countdown sits beneath the bar as subtext.
 *
 * When `stale` is set (the last fetch failed / was rate-limited) the gauges are
 * dimmed and a small amber dot is shown so the last-good reading stays on screen
 * but visibly reads as "not live".
 */
export function barsImage({ rows, stale = false }: { rows: BarRow[]; stale?: boolean }): string {
	const blockH = (SIZE - MARGIN * 2) / rows.length;

	const body = rows
		.map((row, i) => {
			const top =
				MARGIN + i * blockH + Math.max(0, (blockH - CONTENT_H) / 2) + (i - (rows.length - 1) / 2) * GROUP_GAP;
			const labelY = top + 15;
			const barY = top + 22;
			const valueY = top + 56;
			const fraction = Math.min(1, Math.max(0, row.percent / 100));
			const fillW = Math.round(BAR_W * fraction);
			const fill =
				fillW > 0
					? `<rect x="${BAR_X}" y="${barY}" width="${fillW}" height="${BAR_H}" rx="${RADIUS}" fill="${row.color}"/>`
					: "";

			// Three stacked lines per row: label (with % on the right), thin bar, then
			// the reset countdown beneath it.
			return `<text x="${BAR_X}" y="${labelY}" text-anchor="start" font-family="${FONT}" font-size="17" font-weight="700" fill="${row.color}">${escapeXml(row.label)}</text>
	<text x="${BAR_X + BAR_W}" y="${labelY}" text-anchor="end" font-family="${FONT}" font-size="17" font-weight="700" fill="${row.color}">${escapeXml(`${Math.round(row.percent)}%`)}</text>
	<rect x="${BAR_X}" y="${barY}" width="${BAR_W}" height="${BAR_H}" rx="${RADIUS}" fill="#333333"/>
	${fill}
	<text x="${BAR_X}" y="${valueY}" text-anchor="start" font-family="${FONT}" font-size="18" font-weight="600" fill="#FFFFFF">${escapeXml(row.subtext)}</text>`;
		})
		.join("\n\t");

	// Dim the gauges when stale; keep the status dot bright (outside the group).
	const content = stale ? `<g opacity="0.5">\n\t${body}\n\t</g>` : body;
	const staleDot = stale ? `\n\t<circle cx="${SIZE - 9}" cy="9" r="4" fill="#FFCC00"/>` : "";

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
	<rect width="${SIZE}" height="${SIZE}" fill="#000000"/>
	${content}${staleDot}
</svg>`;

	return toDataUri(svg);
}

function buildErrorImage(label: string): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
	<rect width="${SIZE}" height="${SIZE}" fill="#000000"/>
	<text x="${SIZE / 2}" y="38" text-anchor="middle" font-family="${FONT}" font-size="24" font-weight="600" fill="#FFFFFF">${escapeXml(label)}</text>
	<text x="${SIZE / 2}" y="86" text-anchor="middle" font-family="${FONT}" font-size="40" fill="#FFCC00">⚠</text>
	<text x="${SIZE / 2}" y="120" text-anchor="middle" font-family="${FONT}" font-size="22" fill="#AAAAAA">setup</text>
</svg>`;

	return toDataUri(svg);
}

let cachedDefaultError: string | undefined;

/** Fallback image shown when usage can't be read / the user isn't signed in. */
export function errorImage(label = "Claude"): string {
	// The default-label image is a constant rendered on every failing poll — cache it.
	if (label === "Claude") return (cachedDefaultError ??= buildErrorImage(label));
	return buildErrorImage(label);
}
