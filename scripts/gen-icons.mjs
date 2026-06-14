// Generates the plugin's PNG icons. Run with: npm run gen:icons
//  - Plugin + category icon: a four-point "spark" mark (nods to the Claude glyph)
//  - Action icon + key default: the MDI "chart-bar" glyph (the usage bars)
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sdPlugin = `${root}/tphan.claudeusage.sdPlugin`;

const COLOR = "#FFFFFF"; // white — the default Stream Deck icon color

// MDI "chart-bar" (https://pictogrammers.com/library/mdi/icon/chart-bar/), 24x24 viewBox.
const CHART_PATH = "M22,21H2V3H4V19H6V10H10V19H12V6H16V19H18V14H22V21Z";
const chartSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 28 28"><path d="${CHART_PATH}" fill="${COLOR}"/></svg>`;

// A simple four-point spark (a single rounded star burst) as the plugin mark.
const SPARK_PATH =
	"M50 6 C54 30 70 46 94 50 C70 54 54 70 50 94 C46 70 30 54 6 50 C30 46 46 30 50 6 Z";
const sparkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${SPARK_PATH}" fill="${COLOR}"/></svg>`;

const toPng = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

function emit(svg, relPath, size) {
	const path = `${sdPlugin}/${relPath}`;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(`${path}.png`, toPng(svg, size)); // @1x
	writeFileSync(`${path}@2x.png`, toPng(svg, size * 2)); // @2x
}

emit(sparkSvg, "imgs/plugin/icon", 28);
emit(sparkSvg, "imgs/plugin/category-icon", 28);
emit(chartSvg, "imgs/actions/usage/icon", 20);
emit(chartSvg, "imgs/actions/usage/key", 72);

console.log("Generated icons under", sdPlugin.replace(`${root}/`, ""));
