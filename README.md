# Feedpin

Annotate any live web page. Copy the markdown. Paste it into Claude Code, Codex, or whatever agent you use. It knows exactly what to fix.

Feedpin is a Chrome extension that lets you pin comments on UI elements and export them as structured markdown — complete with CSS selectors, element types, and page context. No screenshots, no context loss.

## Install

1. Clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the repo directory

No build step. No dependencies. Just load and go.

## How it works

1. Click the Feedpin icon to activate
2. Hover over any element — it highlights and shows the element type
3. Click to pin a comment
4. Hit **A** to copy all annotations as markdown
5. Paste into your agent, ticket, or chat

The exported markdown includes the page URL, each element's CSS selector and type, and your comments. An AI agent or developer reading it knows exactly which element you're talking about.

## Keyboard shortcuts

| Key | Action |
|---|---|
| **C** | Toggle comment mode |
| **A** | Copy all annotations |
| **Shift+A** | Copy all & clear |
| **XXX** | Delete all annotations |
| **Z** | Undo delete (5s window) |
| **Esc** | Exit comment mode / close |

## Works everywhere

- Any HTTP/HTTPS page
- Single-page apps (detects client-side navigation)
- Annotations persist per page in localStorage
- CSS selector builder filters out generated class names (CSS-in-JS, Tailwind hashes, etc.)

## Export format

```markdown
# Design Review — Page Title
**URL:** https://example.com/page

## 1
**Element:** `nav.main-nav > ul > li:nth-of-type(3)` (list item)
Spacing between nav items is inconsistent — should be 16px

---

## 2
**Element:** `#hero-heading` (heading 1)
Font weight looks lighter than the design spec
```

## License

MIT
