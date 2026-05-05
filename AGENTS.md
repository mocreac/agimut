# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What is Agimut

Agimut is a Chrome extension (Manifest V3) for adding design review annotations to web pages and local HTML files. Users hover elements or select text, add comments, optionally reference nearby elements, and export structured markdown for agent-assisted fixes. There is no build step. The extension loads `content.js` and `content.css` directly as content scripts.

## Loading for development

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this directory
4. Optional: enable "Allow access to file URLs" to test local HTML files

There is no build, bundler, or package manager. Edit files and reload the extension.

## Architecture

**Core files:**
- `manifest.json` - MV3 config, popup entry, icons, permissions, and content script matches
- `content.js` - single IIFE with the in-page annotation UI and persistence logic
- `content.css` - in-page annotation UI styles, scoped under `#pinpoint-root`
- `popup.html`, `popup.js`, `popup.css` - extension popup controls for enablement, dev-only mode, theme, and toolbar position
- `logo.svg`, `logo.png`, `banner.png`, `icons/` - extension and README assets

**Internal naming:** The DOM/CSS namespace is `pinpoint` / `pp-` (the original project name). The extension name facing users is "Agimut".

**content.js structure (single IIFE):**
- State variables at top (`active`, `commenting`, `annotations`, etc.)
- `TAG` map for friendly element names
- Phosphor icon SVG paths rendered inline via `ph()` helper
- Storage helpers wrapping `chrome.storage.local`, with legacy `localStorage` fallback/migration
- DOM scaffolding: creates `#pinpoint-root` with overlay, text highlight layer, pin layer, toolbar, menu, toast, navigator, and toggle button
- Core flows: `activate()`/`deactivate()`, `startCommenting()`/`stopCommenting()`
- Targeting: element hover, text selections, keyboard navigation, and inline reference picking
- Annotation CRUD: `addAnnotation()`, `deleteAnnotation()`, `deleteAll()`, renumbering, orphan handling, pins via `createPin()`/`positionPin()`
- Undo system: 5-second window after delete-all, triggered by Z key or clicking the undo button
- Popover: `showPopover()` for adding/editing comments, multiple notes per target, contenteditable comment editor, and inline reference chips
- Copy: `formatMarkdown()` exports as markdown; `copyAll()` (A key) and `copyAndClear()` (Shift+A)
- Persistence: `chrome.storage.local` keyed by `pinpoint:{origin}{pathname}{search}`, with localStorage fallback and LRU pruning
- Selector builder: `buildSelector()` generates CSS selectors, filters out generated class names (CSS-in-JS)
- SPA support: monkey-patches `history.pushState`/`replaceState`, watches popstate/hash/pageshow/visibility changes, and polls for route changes
- Keyboard shortcuts: C (toggle comment mode), A (copy), Shift+A (copy & clear), XXX (delete all), Z (undo), Esc (close), arrows/Tab/Enter for keyboard targeting

**CSS isolation:** All styles use `#pinpoint-root` selector prefix. Max z-index (`2147483640`+) ensures UI stays above host page content.
