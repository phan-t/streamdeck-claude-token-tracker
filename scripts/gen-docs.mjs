// Generates the documentation SVGs under docs/ — static previews of what the key
// looks like, for the README. Run with: npm run gen:docs
//
// The gauge geometry here mirrors src/render.ts and the colors mirror
// src/actions/usage.ts; keep them in sync if either changes. (Kept self-contained
// — like scripts/gen-icons.mjs — so it runs without compiling the TS sources.)
//
// Unlike the live key (a plain black square; the hardware rounds the corners),
// these docs cards draw the rounded corners + a subtle border themselves so they
// read as physical keys on a page, and a framed keys.svg lines the states up.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const docs = `${root}/docs`;

// --- Geometry (mirrors src/render.ts) ---------------------------------------
const SIZE = 144;
const MARGIN = 10;
const BAR_X = 14;
const BAR_W = SIZE - BAR_X * 2;
const BAR_H = 14;
const RADIUS = BAR_H / 2;
const CONTENT_H = 56;
const GROUP_GAP = 10;
const FONT = "Helvetica, Arial, sans-serif";

// --- Colors (mirrors src/actions/usage.ts) ----------------------------------
const SESSION_COLOR = "#D97757"; // warm clay
const WEEKLY_COLOR = "#6C9BD1"; // soft blue

// --- Docs card presentation -------------------------------------------------
const CARD_RADIUS = 18;
const BORDER = "#2A2A2A";
const FRAME_BG = "#111315";
const FRAME_PAD = 28; // margin around / between cards in the showcase
// The key card stays full-bleed; only the gauges/text inside it are scaled to
// CONTENT_SCALE and re-centered, giving the contents a bit more internal padding.
const CONTENT_SCALE = 0.95; // inner content sits at 95% of the key, centered
const round = (n) => Math.round(n * 100) / 100;

/** Wrap drawn content in a group scaled about the center of a w×h area. */
const scaled = (inner, w, h) =>
	`<g transform="translate(${round((w * (1 - CONTENT_SCALE)) / 2)},${round((h * (1 - CONTENT_SCALE)) / 2)}) scale(${CONTENT_SCALE})">${inner}</g>`;

const escapeXml = (s) => s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

/** The stacked bar-gauge rows (mirrors render.ts's per-row markup). */
function barsBody(rows, stale) {
	const body = rows
		.map((row, i) => {
			const blockH = (SIZE - MARGIN * 2) / rows.length;
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
			return `<text x="${BAR_X}" y="${labelY}" text-anchor="start" font-family="${FONT}" font-size="17" font-weight="700" fill="${row.color}">${escapeXml(row.label)}</text><text x="${BAR_X + BAR_W}" y="${labelY}" text-anchor="end" font-family="${FONT}" font-size="17" font-weight="700" fill="${row.color}">${escapeXml(`${Math.round(row.percent)}%`)}</text><rect x="${BAR_X}" y="${barY}" width="${BAR_W}" height="${BAR_H}" rx="${RADIUS}" fill="#333333"/>${fill}<text x="${BAR_X}" y="${valueY}" text-anchor="start" font-family="${FONT}" font-size="18" font-weight="600" fill="#FFFFFF">${escapeXml(row.subtext)}</text>`;
		})
		.join("");
	return stale ? `<g opacity="0.5">${body}</g>` : body;
}

/** The setup / not-signed-in screen (mirrors render.ts's buildErrorImage). */
function errorBody(label, hint) {
	return `<text x="${SIZE / 2}" y="38" text-anchor="middle" font-family="${FONT}" font-size="24" font-weight="600" fill="#FFFFFF">${escapeXml(label)}</text><text x="${SIZE / 2}" y="86" text-anchor="middle" font-family="${FONT}" font-size="40" fill="#FFCC00">⚠</text><text x="${SIZE / 2}" y="120" text-anchor="middle" font-family="${FONT}" font-size="22" fill="#AAAAAA">${escapeXml(hint)}</text>`;
}

/** Wrap inner content in a rounded, clipped, bordered card. `id` must be unique per document. */
function card(inner, id) {
	return `<defs><clipPath id="${id}"><rect width="${SIZE}" height="${SIZE}" rx="${CARD_RADIUS}"/></clipPath></defs><rect width="${SIZE}" height="${SIZE}" rx="${CARD_RADIUS}" fill="#000000"/><g clip-path="url(#${id})">${scaled(inner, SIZE, SIZE)}</g><rect x="0.5" y="0.5" width="${SIZE - 1}" height="${SIZE - 1}" rx="${CARD_RADIUS}" fill="none" stroke="${BORDER}" stroke-width="1"/>`;
}

const keySvg = (inner) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${card(inner, "k")}</svg>\n`;

/** Lay the cards out side by side on a dark rounded frame. */
function framed(inners) {
	const width = FRAME_PAD * (inners.length + 1) + SIZE * inners.length;
	const height = FRAME_PAD * 2 + SIZE;
	const cards = inners
		.map((inner, i) => {
			const x = FRAME_PAD + i * (SIZE + FRAME_PAD);
			return `<g transform="translate(${x},${FRAME_PAD})">${card(inner, `c${x}`)}</g>`;
		})
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" rx="24" fill="${FRAME_BG}"/>${cards}</svg>\n`;
}

// --- Sample readings (illustrative) -----------------------------------------
const ROWS = [
	{ label: "Session", percent: 42, color: SESSION_COLOR, subtext: "3h 12m" },
	{ label: "Weekly", percent: 68, color: WEEKLY_COLOR, subtext: "4d 6h" },
];

const live = barsBody(ROWS, false);
const stale = barsBody(ROWS, true);
const setup = errorBody("Claude", "sign in");

mkdirSync(docs, { recursive: true });
writeFileSync(`${docs}/key.svg`, keySvg(live));
writeFileSync(`${docs}/key-stale.svg`, keySvg(stale));
writeFileSync(`${docs}/key-setup.svg`, keySvg(setup));
writeFileSync(`${docs}/keys.svg`, framed([live, stale, setup]));

console.log("Generated docs SVGs under docs/");
