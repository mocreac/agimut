# Feedpin

![Feedpin](banner.png)

Annotate any live web page. Copy the output. Paste it into Claude Code, Codex, or whatever agent you use. It knows exactly what to fix.

Feedpin is a Chrome extension that lets you pin comments on UI elements and export them as structured text with CSS selectors, HTML tags, and page context. Built for teams that use AI coding agents in their review workflow.

## Install

Chrome Web Store listing coming soon.

**Manual install:**

1. Clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the repo directory

## How it works

1. Click the Feedpin icon to activate
2. Hover over any element to see it highlighted with its element type
3. Click to pin a comment
4. Hit **A** to copy all annotations
5. Paste into your agent, ticket, or chat

Each annotation captures the CSS selector, the element's opening HTML tag (with all classes and attributes), and a text preview. An AI agent reading the export can see exactly which element you're referring to and map it back to your source code.

## Export format

```
Design Review - Page Title
URL: https://example.com/page

1. Element: nav.main-nav > ul > li:nth-of-type(3) (list item)
   HTML: <li class="flex items-center gap-6 px-4 py-2 text-sm">
   Text: "Products"
   Comment: Spacing between nav items is inconsistent, should be 16px

2. Element: #hero-heading (heading 1)
   HTML: <h1 class="text-5xl font-light text-gray-700">
   Text: "Welcome to Our Platform"
   Comment: Font weight looks lighter than the design spec
```

The HTML tag line is what makes this work across any framework. Tailwind, CSS modules, BEM, styled-components - the agent sees the actual classes on the rendered element and can grep your codebase for them.

## Keyboard shortcuts

| Key | Action |
|---|---|
| **C** | Toggle comment mode |
| **A** | Copy all annotations |
| **Shift+A** | Copy all & clear |
| **XXX** | Delete all annotations |
| **Z** | Undo delete (5s window) |
| **Esc** | Exit comment mode / close |

## Extension menu

Right-click the Feedpin icon or click it to open the popup:

- **Enabled** toggle to disable Feedpin on the current site
- **Dev only** mode to restrict Feedpin to localhost, 127.0.0.1, and .local domains

## Works everywhere

- Any HTTP/HTTPS page, any codebase
- Single-page apps (detects client-side navigation)
- Annotations persist per page in localStorage
- CSS selector builder filters out generated class names (CSS-in-JS, Tailwind hashes, etc.)

## License

MIT
