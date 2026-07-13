# Fast Video

English | [简体中文](README.md)

Fast Video is a video speed controller for Edge and other Chromium-based browsers. It fixes a common problem with speed-control extensions: once a speed is selected, the extension keeps forcing that value and prevents the website's own controls from working.

On Bilibili, Fast Video adds higher speeds and a custom-speed input directly to the player's playback-speed menu.

## Features

- Adds common playback speeds from `0.5×` to `16×` to Bilibili's player menu.
- Accepts custom speeds from `0.25×` to `16×`, with up to two decimal places.
- Works with regular videos, bangumi, films, and courses, including fullscreen playback.
- Keeps the selected speed when switching parts, pausing, or resuming the current video.
- Resets to `1×` when a new video is opened or the page is refreshed.
- Never locks Bilibili's player to a fixed speed—the player menu remains in control.
- On other websites, speed changes are applied once by default. Continuous enforcement is enabled only when you explicitly lock the site.

> Live streams are not supported. Their players generally try to stay close to real time, so high-speed playback is unreliable.

## Installation

Fast Video is not currently published in a browser extension store. Install it as an unpacked extension:

1. Download this repository using **Code → Download ZIP**.
2. Extract the ZIP archive.
3. Open `edge://extensions` in Microsoft Edge.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the project folder that contains `manifest.json`.
7. Refresh any video pages that were already open.

Disable other playback-speed extensions before using Fast Video. Running multiple extensions that modify playback speed may cause conflicts.

## Usage

### Bilibili

Open a regular video, bangumi episode, film, or course and hover over the player's playback-speed button. The expanded menu includes these presets:

```text
0.5×  0.75×  1×  1.25×  1.5×  2×
2.5×  3×     4×  5×     8×    16×
```

Select any preset to change the speed. For another value, enter it in the **Custom** field at the bottom of the menu, then press Enter or click **Apply**.

### Other video websites

1. Click the Fast Video icon in the browser toolbar.
2. Choose a preset, or enter a custom speed and click **Apply**.
3. The speed is applied once, so the website's own controls remain available.
4. To keep a site at a fixed speed, click **Lock current speed**. Click it again to unlock the site.

## Updating a local installation

After replacing or pulling project files:

1. Open `edge://extensions`.
2. Find **倍速播放控制器・B站改良版**.
3. Click **Reload**.
4. Refresh the video page.

## Troubleshooting

### Clicking a speed has no effect

- Make sure any older playback-speed extension is disabled.
- Reload Fast Video from `edge://extensions`.
- Refresh the video page and try again.
- Confirm that you loaded the directory containing `manifest.json`, not its parent directory.

### The extension stopped working after the project folder was moved

Edge remembers the original path of an unpacked extension. Remove the broken extension entry, then load it again from the new directory.

### Why does the extension request access to all websites?

Fast Video needs to find media elements and set their playback speed on pages that contain video. Site-specific speed settings are stored through the browser's extension storage. The project contains no analytics, advertising, or code that uploads your data to an external server.

## Development and testing

Node.js and Playwright are required:

```bash
npm install
npx playwright install chromium
npm test
```

The test suite covers Bilibili presets, custom speeds, player write-back behavior, native speed controls, and explicit speed locking on other websites.

## Project structure

```text
manifest.json      Extension manifest
content.js         Media controls and Bilibili menu integration
background.js      Cross-frame synchronization and toolbar badge
popup.html/css/js  Toolbar popup
icons/             Extension icons
tests/             Browser behavior tests
```

## Repository

[user-A100/Fast-Video](https://github.com/user-A100/Fast-Video)
