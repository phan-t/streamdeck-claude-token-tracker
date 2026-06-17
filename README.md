# Claude Usage — Stream Deck plugin

Show your Claude usage on a single Stream Deck key as two stacked horizontal bar gauges:

- **Session** — the rolling 5‑hour limit: percentage used, with time‑to‑reset underneath.
- **Weekly** — the rolling 7‑day limit: percentage used, with time‑to‑reset underneath.

The layout (bars, fonts, sizes) mirrors [streamdeck-enphase](https://github.com/phan-t/streamdeck-enphase).

<sub>Not affiliated with Anthropic. Uses an undocumented endpoint that may change.</sub>

## How it works

- **No login.** The plugin reads the OAuth token that **Claude Code** already stores in your macOS Keychain (the `Claude Code-credentials` item), then calls Anthropic's usage endpoint (`GET https://api.anthropic.com/api/oauth/usage`) — the same data behind Claude Code's `/usage`.
- The first poll triggers a one‑time macOS Keychain access prompt — choose **Always Allow** so the plugin can read the token unattended. Claude Code keeps the token refreshed; the plugin just reads the latest value each cycle.
- **Configurable refresh** in the property inspector (default 300s). The usage endpoint is aggressively rate‑limited, so the minimum is 60s — and if it returns `429` the plugin automatically backs off (honouring `Retry-After`, else exponentially up to 30 min) and recovers on the next success.
- **Manual refresh:** press the key to fetch immediately.
- **Stays readable when offline.** If a poll fails or is rate‑limited, the last‑good reading stays on the key — dimmed to read as "not live" — instead of flipping to the setup screen. The setup screen only appears when there's no reading yet (first run / not signed in).
- The OAuth token is cached in memory until shortly before it expires, so steady polling doesn't shell out to the Keychain every cycle (it re‑reads on expiry or a `401`).

> macOS only — the credentials live in the macOS Keychain.

## Requirements

- macOS 12+, Stream Deck 6.5+
- Node.js 20+
- Signed in via Claude Code (so the Keychain item exists)

## Develop

```sh
npm install
npm run gen:icons        # generate the PNG icons
npm run build            # bundle src/ into the .sdPlugin/bin
npx streamdeck link tphan.claudeusage.sdPlugin   # install the dev plugin
npm run watch            # rebuild + restart on change
```

`npm run lint` type‑checks without emitting.

## Package for distribution

```sh
npm run build
npx streamdeck pack tphan.claudeusage.sdPlugin
```

This produces a `.streamDeckPlugin` installer.

## Project layout

```
src/
  plugin.ts                 entrypoint — registers the action
  render.ts                 SVG → data‑URI bar gauges (shared geometry)
  actions/
    usage.ts                the action: Session + Weekly rows
    polling-action.ts       shared timer, fetch‑once‑fan‑out, 429 backoff, stale/error fallback
  claude/
    client.ts               keychain token + usage API fetch
    format.ts               percent + reset‑countdown formatting
    types.ts                settings, API + reading types
scripts/gen-icons.mjs       generates plugin/action PNGs
tphan.claudeusage.sdPlugin/ the installed plugin package (manifest, ui, imgs, bin)
```
