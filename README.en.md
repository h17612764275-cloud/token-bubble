# Token Bubble

[简体中文](README.md) · **English**

Token Bubble is a local-first desktop widget for Codex quota and token usage. It brings quota status, token distribution, estimated cost, and recent usage into a lightweight panel that can be resized and pinned.

Token Bubble is derived from **Quota Float** and integrates **CodexScope** for local usage verification. The original projects retain their respective copyrights and licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Download

- [Download the latest installer](https://github.com/h17612764275-cloud/token-bubble/releases/latest)
- Current version: `v0.1.5`
- Windows users should download the `.exe` installer from the Release.

## Interface preview

### Two panel skins

Switch between the pink and blue skins. The panel and floating widget use the corresponding visual style.

| Pink skin | Blue skin |
| --- | --- |
| ![Token Bubble pink skin showing today's usage](docs/images/token-bubble-panel-pink-today.png) | ![Token Bubble blue skin showing today's usage](docs/images/token-bubble-panel-blue-today.png) |

### Today, last 7 days, and last 30 days

Switch the usage range between today, the last 7 days, and the last 30 days. The panel updates the token total, chart, token-type distribution, and estimated cost for the selected range.

| Today | Last 7 days | Last 30 days |
| --- | --- | --- |
| ![Token Bubble token usage for today](docs/images/token-bubble-panel-pink-today.png) | ![Token Bubble token usage for the last 7 days](docs/images/token-bubble-panel-pink-7d.png) | ![Token Bubble token usage for the last 30 days](docs/images/token-bubble-panel-pink-30d.png) |

### Floating widget

The floating widget has matching pink and blue styles. It can be resized, locked in place, and kept on top. Click it to open the full panel.

| Pink widget | Blue widget |
| --- | --- |
| ![Token Bubble pink floating widget](docs/images/token-bubble-orb-pink.png) | ![Token Bubble blue floating widget](docs/images/token-bubble-orb-blue.png) |

## Features

- Shows the remaining Codex quota, refresh time, and quota status.
- Switches token usage between today, the last 7 days, and the last 30 days.
- Breaks usage down into input, cached, output, and reasoning tokens.
- Estimates cost from locally observed token usage.
- Shows usage trends with a bar chart and a 90-day heatmap.
- Switches between pink and blue panel skins.
- Resizes the floating widget, locks its position, and keeps it on top.
- Stores a membership renewal date and shows the remaining days.
- Provides tray actions for refresh and panel/widget visibility.

## Usage

1. Install and start Token Bubble.
2. Make sure Codex Desktop is signed in on the same computer.
3. Select today, 7 days, or 30 days from the usage range.
4. Use the controls to switch skins, resize or lock the widget, and adjust the panel color.
5. Select the renewal date at the top of the panel to set your membership renewal.

## Data and privacy

Token Bubble reads the existing local Codex Desktop login state and queries quota in read-only mode. Token history, interface preferences, and the membership renewal date stay on the device.

- It does not upload prompts, chats, or local usage history.
- It includes no telemetry, analytics, or crash reporting.
- It does not redeem reset credits or change account settings.
- Local token totals support history and verification views; they do not replace service-provided quota values.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) for the complete boundary.

## Upstream projects and licenses

Token Bubble is an independent derivative project and is not an official release of Quota Float or CodexScope.

- **Quota Float** provided the base desktop-widget architecture and Codex quota display.
- **CodexScope** provided components used for local token-usage verification.
- **Token Bubble** adds the new panel, skins, time ranges, token distribution, estimated cost, widget controls, and membership renewal setting.

See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for license and attribution details.

## Development

Requires Node.js 20+, Rust stable, and the Tauri 2 system dependencies for your platform.

```bash
npm install
npm run test
npm run build
npm run tauri dev
```

Build installers with:

```bash
npm run tauri build
```

## Feedback

Use [GitHub Issues](https://github.com/h17612764275-cloud/token-bubble/issues) for bugs and feature requests. Remove tokens, account information, email addresses, and local paths before sharing screenshots or logs.
