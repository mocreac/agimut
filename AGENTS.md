# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What is Agimut

Agimut is a Chrome extension (Manifest V3) for adding design review annotations to any web page. Users hover over elements, click to add comments, and export annotations as markdown. No build step — the extension loads `content.js` and `content.css` directly as content scripts on all HTTP/HTTPS pages.

## Loading for development

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this directory

There is no build, bundler, or package manager. Edit files and reload the extension.

## Architecture

**Four files total:**
- `manifest.json` — MV3 config, injects content script + CSS on all pages
- `content.js` — single IIFE, all logic in vanilla JS (no frameworks/modules)
- `content.css` — all UI styles, scoped under `#pinpoint-root` to avoid host page conflicts
- `logo.svg` — extension logo

**Internal naming:** The DOM/CSS namespace is `pinpoint` / `pp-` (the original project name). The extension name facing users is "Agimut".

**content.js structure (single IIFE):**
- State variables at top (`active`, `commenting`, `annotations`, etc.)
- `TAG` map for friendly element names
- Phosphor icon SVG paths rendered inline via `ph()` helper
- DOM scaffolding: creates `#pinpoint-root` with overlay, tooltip, pin layer, toolbar, and toggle button
- Core flows: `activate()`/`deactivate()`, `startCommenting()`/`stopCommenting()`
- Annotation CRUD: `addAnnotation()`, `deleteAnnotation()`, `deleteAll()`, pins via `createPin()`/`positionPin()`
- Undo system: 5-second window after delete-all, triggered by Z key or clicking the undo button
- Popover: `showPopover()` for adding/editing comments, with auto-grow textarea
- Copy: `formatMarkdown()` exports as markdown; `copyAll()` (A key) and `copyAndClear()` (Shift+A)
- Persistence: `localStorage` keyed by `pinpoint:{origin}{pathname}`, auto-restores on load
- Selector builder: `buildSelector()` generates CSS selectors, filters out generated class names (CSS-in-JS)
- SPA support: monkey-patches `history.pushState`/`replaceState` and listens for `popstate`
- Keyboard shortcuts: C (toggle comment mode), A (copy), Shift+A (copy & clear), XXX (delete all), Z (undo), Esc (close)

**CSS isolation:** All styles use `#pinpoint-root` selector prefix. Max z-index (`2147483640`+) ensures UI stays above host page content.
