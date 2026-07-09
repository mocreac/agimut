(function () {
  'use strict';

  /* ── state ─────────────────────────────────────────────── */
  var active = false;
  var commenting = false;
  var annotations = [];
  var nextId = 1;
  var hovered = null;
  var popover = null;
  var popoverTarget = null;
  var popoverResizeObserver = null;
  var editingAnn = null;
  var morphTimer = null;
  var uiTheme = 'dark';
  var toolbarPosition = 'bottom-left';
  var referencePicking = false;
  var referenceEditor = null;

  /* ── transient selection state ─────────────────────────── */
  var highlightNodes = [];
  var selectionPointerDown = false;
  var suppressClickOnce = false;

  /* ── undo state ────────────────────────────────────────── */
  var undoData = null;   // { items: [...], nextId }
  var undoTimer = null;

  /* ── keyboard navigation state ──────────────────────────── */
  var keyNavEnabled = true;
  // Controls whether the Copy toolbar button + `A` shortcut also wipes
  // annotations after copying (mirrors what Shift+A already does).
  var clearAfterCopy = false;

  /* ── multi-target commenting state ──────────────────────── */
  // Element targets pending commit (filled by Shift+click / Shift+Enter).
  // When non-empty the popover renders in multi-mode and Submit creates one
  // annotation per target with the same comment text + cloned references.
  // Text targets are intentionally excluded — shift+drag stays the browser's
  // native text-selection-extend gesture.
  var multiTargets = [];
  // targetKey -> HTMLDivElement, one sticky highlight per selected target
  // parented to highlightLayer. Disposed when the target is toggled off or
  // when clearMultiSelect() runs.
  var multiHighlightNodes = new Map();
  // Whether the live popover is rendering in multi-mode. When true,
  // positionPop reads the union anchor from multiTargets instead of a single
  // target rect, and refreshAll keeps the popover anchored as the selection
  // grows / shrinks.
  var popoverIsMulti = false;

  /* ── flash timer tracking (issue #9) ───────────────────── */
  var flashTimers = new Map();

  /* ── scroll/resize throttle ────────────────────────────── */
  var rafPending = false;

  /* ── keyboard nav element cache ────────────────────────── */
  var navElemsCache = null;
  var navElemsDirty = true;

  /* ── persistence key ───────────────────────────────────── */
  function getStoreKey() {
    return 'pinpoint:' + location.origin + location.pathname + location.search;
  }

  function getDraftKey() {
    return 'pinpoint:draft:' + location.origin + location.pathname + location.search;
  }

  var STORE_KEY = getStoreKey();
  var DRAFT_KEY = getDraftKey();

  // Drafts older than this are ignored on restore. The goal is to recover
  // from dev-server auto-reloads (Vite HMR, Webpack devServer, etc.) and the
  // odd accidental refresh — not to resurrect comments from yesterday's
  // session.
  var DRAFT_MAX_AGE_MS = 30 * 60 * 1000;

  function safeStorageGet(keys, done) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        if (done) done({});
        return;
      }
      chrome.storage.local.get(keys, function (result) {
        try {
          if (chrome.runtime && chrome.runtime.lastError) {
            if (done) done({});
            return;
          }
          if (done) done(result || {});
        } catch (e) {
          if (done) done({});
        }
      });
    } catch (e) {
      if (done) done({});
    }
  }

  function safeStorageSet(payload) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.set(payload, function () {
        try {
          if (chrome.runtime && chrome.runtime.lastError) return;
        } catch (e) { /* extension context can be invalidated on reload */ }
      });
    } catch (e) { /* extension context can be invalidated on reload */ }
  }

  function safeStorageRemove(keys) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.remove(keys, function () {
        try {
          if (chrome.runtime && chrome.runtime.lastError) return;
        } catch (e) { /* extension context can be invalidated on reload */ }
      });
    } catch (e) { /* extension context can be invalidated on reload */ }
  }

  /* ── popover draft (Vite HMR / auto-refresh recovery) ─── */
  // Drafts capture the popover's in-progress editor content so a dev-server
  // auto-refresh (Vite HMR, Next.js fast refresh, etc.) doesn't wipe what the
  // user was typing. Stored per-URL under DRAFT_KEY; cleared on commit, Esc,
  // and stopCommenting — i.e., any explicit "I'm done" path.
  function saveDraft(draft) {
    if (!draft) return;
    draft.savedAt = Date.now();
    var payload = {};
    payload[DRAFT_KEY] = draft;
    safeStorageSet(payload);
  }

  function loadDraft(done) {
    safeStorageGet([DRAFT_KEY], function (result) {
      if (done) done(result[DRAFT_KEY] || null);
    });
  }

  function clearDraft() {
    safeStorageRemove([DRAFT_KEY]);
  }

  // Persist enough about a target to re-query its element after the page
  // reloads. Skips el/range — those are recomputed on restore via the
  // selector + offsets.
  function serializeTargetForDraft(target) {
    if (!target) return null;
    var out = {
      kind: target.kind,
      selector: target.selector,
      type: target.type,
    };
    if (target.kind === 'text') {
      out.quote = target.quote || '';
      out.textStart = target.textStart;
      out.textEnd = target.textEnd;
    }
    return out;
  }

  // Re-query the DOM and rebuild a live target object from the persisted
  // shape. Returns null when the element is missing or (for text targets)
  // the saved offsets no longer line up — caller treats null as "draft
  // can't be restored, drop it".
  function resolveTargetFromDraft(data) {
    if (!data || !data.selector) return null;
    var el = null;
    try { el = document.querySelector(data.selector); } catch (e) { el = null; }
    if (!el) return null;
    if (data.kind === 'text') {
      var range = restoreRangeFromOffsets(el, data.textStart, data.textEnd, data.quote);
      if (!range) return null;
      return prepareTarget({
        kind: 'text',
        el: el,
        selector: data.selector,
        type: data.type || 'text',
        quote: data.quote || '',
        textStart: data.textStart,
        textEnd: data.textEnd,
        range: range,
      });
    }
    return prepareTarget({
      kind: 'element',
      el: el,
      selector: data.selector,
      type: data.type || typeName(el),
    });
  }

  function safeRuntimeOnMessage(handler) {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;
      chrome.runtime.onMessage.addListener(handler);
    } catch (e) { /* extension context can be invalidated on reload */ }
  }

  /* ── friendly tag names ────────────────────────────────── */
  var TAG = {
    A: 'link', P: 'paragraph', LI: 'list item', UL: 'unordered list',
    OL: 'ordered list', H1: 'heading 1', H2: 'heading 2', H3: 'heading 3',
    H4: 'heading 4', H5: 'heading 5', H6: 'heading 6', IMG: 'image',
    BUTTON: 'button', INPUT: 'input', TEXTAREA: 'textarea', SELECT: 'select',
    NAV: 'navigation', HEADER: 'header', FOOTER: 'footer', MAIN: 'main',
    SECTION: 'section', ARTICLE: 'article', ASIDE: 'aside', FORM: 'form',
    TABLE: 'table', TR: 'table row', TD: 'table cell', TH: 'table header',
    VIDEO: 'video', AUDIO: 'audio', LABEL: 'label', SPAN: 'span', DIV: 'div',
    FIGCAPTION: 'caption', FIGURE: 'figure', BLOCKQUOTE: 'blockquote',
    CODE: 'code', PRE: 'preformatted',
  };

  /* ── Phosphor icons (regular, 256x256, fill) ───────────── */
  function ph(d, s) {
    s = s || 18;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 256 256" fill="currentColor"><path d="' + d + '"/></svg>';
  }

  var P = {
    chatCircle:  'M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-6.54-.67L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Z',
    copy:        'M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z',
    paperPlane:  'M227.32,28.68a16,16,0,0,0-15.66-4.08l-.15,0L19.57,82.84a16,16,0,0,0-2.49,29.8L102,154l41.3,84.87A15.86,15.86,0,0,0,157.74,248q.69,0,1.38-.06a15.88,15.88,0,0,0,14-11.51l58.2-191.94c0-.05,0-.1,0-.15A16,16,0,0,0,227.32,28.68ZM157.83,231.85l-.05.14,0-.07-40.06-82.3,48-48a8,8,0,0,0-11.31-11.31l-48,48L24.08,98.25l-.07,0,.14,0L216,40Z',
    trash:       'M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z',
    x:           'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z',
    pushPin:     'M235.32,81.37,174.63,20.69a16,16,0,0,0-22.63,0L98.37,74.49c-10.66-3.34-35-7.37-60.4,13.14a16,16,0,0,0-1.29,23.78L85,159.71,42.34,202.34a8,8,0,0,0,11.32,11.32L96.29,171l48.29,48.29A16,16,0,0,0,155.9,224c.38,0,.75,0,1.13,0a15.93,15.93,0,0,0,11.64-6.33c19.64-26.1,17.75-47.32,13.19-60L235.33,104A16,16,0,0,0,235.32,81.37ZM224,92.69h0l-57.27,57.46a8,8,0,0,0-1.49,9.22c9.46,18.93-1.8,38.59-9.34,48.62L48,100.08c12.08-9.74,23.64-12.31,32.48-12.31A40.13,40.13,0,0,1,96.81,91a8,8,0,0,0,9.25-1.51L163.32,32,224,92.68Z',
    arrowUp:     'M205.66,117.66a8,8,0,0,1-11.32,0L136,59.31V216a8,8,0,0,1-16,0V59.31L61.66,117.66a8,8,0,0,1-11.32-11.32l72-72a8,8,0,0,1,11.32,0l72,72A8,8,0,0,1,205.66,117.66Z',
    check:       'M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z',
    undo:        'M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L44.59,96H72a8,8,0,0,1,0,16H24a8,8,0,0,1-8-8V56a8,8,0,0,1,16,0V85.8L60.25,60A96,96,0,0,1,224,128Z',
    sliders:     'M64,105V40a8,8,0,0,0-16,0v65a32,32,0,0,0,0,62v49a8,8,0,0,0,16,0V167a32,32,0,0,0,0-62Zm-8,47a16,16,0,1,1,16-16A16,16,0,0,1,56,152Zm80-95V40a8,8,0,0,0-16,0V57a32,32,0,0,0,0,62v97a8,8,0,0,0,16,0V119a32,32,0,0,0,0-62Zm-8,47a16,16,0,1,1,16-16A16,16,0,0,1,128,104Zm104,64a32.06,32.06,0,0,0-24-31V40a8,8,0,0,0-16,0v97a32,32,0,0,0,0,62v17a8,8,0,0,0,16,0V199A32.06,32.06,0,0,0,232,168Zm-32,16a16,16,0,1,1,16-16A16,16,0,0,1,200,184Z',
    eyedropper:  'M224,67.3a35.79,35.79,0,0,0-11.26-25.66c-14-13.28-36.72-12.78-50.62,1.13L142.8,62.2a24,24,0,0,0-33.14.77l-9,9a16,16,0,0,0,0,22.64l2,2.06-51,51a39.75,39.75,0,0,0-10.53,38l-8,18.41A13.68,13.68,0,0,0,36,219.3a15.92,15.92,0,0,0,17.71,3.35L71.23,215a39.89,39.89,0,0,0,37.06-10.75l51-51,2.06,2.06a16,16,0,0,0,22.62,0l9-9a24,24,0,0,0,.74-33.18l19.75-19.87A35.75,35.75,0,0,0,224,67.3ZM97,193a24,24,0,0,1-24,6,8,8,0,0,0-5.55.31l-18.1,7.91L57,189.41a8,8,0,0,0,.25-5.75A23.88,23.88,0,0,1,63,159l51-51,33.94,34ZM202.13,82l-25.37,25.52a8,8,0,0,0,0,11.3l4.89,4.89a8,8,0,0,1,0,11.32l-9,9L112,83.26l9-9a8,8,0,0,1,11.31,0l4.89,4.89a8,8,0,0,0,11.33,0l24.94-25.09c7.81-7.82,20.5-8.18,28.29-.81a20,20,0,0,1,.39,28.7Z',
    pencilSimple:'M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z',
  };

  var ico = {
    chat:     ph(P.chatCircle),
    copy:     ph(P.copy),
    send:     ph(P.paperPlane),
    trash:    ph(P.trash),
    close:    ph(P.x),
    pin:      ph(P.pushPin, 20),
    arrowUp:  ph(P.arrowUp, 16),
    trashSm:  ph(P.trash, 15),
    check:    ph(P.check),
    undo:     ph(P.undo),
    sliders:  ph(P.sliders),
    // Phosphor "EyedropperSample" (regular, stroke-based): the canonical
    // color-picker glyph for the reference-element button. Rendered inline
    // rather than via ph() because ph() only emits fill paths.
    eyedropper:
      '<svg width="18" height="18" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M182.43,113.17l4.88,4.89a16,16,0,0,1,0,22.63l-9,9a8,8,0,0,1-11.31,0L106.34,89a8,8,0,0,1,0-11.31l9-9a16,16,0,0,1,22.63,0l4.89,4.88,25-25.1c10.79-10.79,28.37-11.45,39.44-1a28,28,0,0,1,.57,40.15Z"/>' +
        '<path d="M159.31,141.94l-56.68,56.69a32,32,0,0,1-32.06,8h0l-20,8.74a8,8,0,0,1-8.86-1.67h0a5.74,5.74,0,0,1-1.2-6.36l9.19-21.06h0a32,32,0,0,1,7.7-32.87l56.69-56.68"/>' +
        '<line x1="52.28" y1="160" x2="141.25" y2="160"/>' +
      '</svg>',
    pencilPin: ph(P.pencilSimple, 14),
  };

  var logoSvg = '<svg width="22" height="17" viewBox="83 68 378 289" fill="none" stroke="currentColor" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"><path d="M113.279 198.073L225.785 327.192V98.2M225.785 327.192L331.751 122.192H430.911"/></svg>';

  /* ── DOM scaffolding ───────────────────────────────────── */
  var root = document.createElement('div');
  root.id = 'pinpoint-root';
  document.documentElement.appendChild(root);

  var overlay = document.createElement('div');
  overlay.className = 'pp-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  root.appendChild(overlay);

  var highlightLayer = document.createElement('div');
  highlightLayer.className = 'pp-highlight-layer';
  root.appendChild(highlightLayer);

  var tip = document.createElement('div');
  tip.className = 'pp-tip';
  root.appendChild(tip);

  var pinLayer = document.createElement('div');
  pinLayer.className = 'pp-pin-layer';
  root.appendChild(pinLayer);

  // toolbar
  var bar = document.createElement('div');
  bar.className = 'pp-bar pp-hidden';
  bar.innerHTML =
    '<button class="pp-bar-btn pp-btn-comment" data-tip="Comment" data-keys="C" aria-label="Comment">' + ico.chat + '</button>' +
    '<span class="pp-count pp-hidden"></span>' +
    '<div class="pp-bar-sep"></div>' +
    '<button class="pp-bar-btn pp-btn-copy" data-tip="Copy all" data-keys="A" aria-label="Copy all">' + ico.copy + '</button>' +
    '<button class="pp-bar-btn pp-btn-delete" data-tip="Delete all" data-keys="X,X,X" aria-label="Delete all">' + ico.trash + '</button>' +
    '<div class="pp-bar-sep"></div>' +
    '<button class="pp-bar-btn pp-btn-shortcuts" data-tip="Settings" aria-label="Settings">' + ico.sliders + '</button>' +
    '<button class="pp-bar-btn pp-btn-close" data-tip="Close" data-keys="Esc" aria-label="Close">' + ico.close + '</button>';
  root.appendChild(bar);

  var barTip = document.createElement('div');
  barTip.className = 'pp-bar-tip';
  root.appendChild(barTip);

  // Floating tooltip for pin hover — shows a preview of the annotation
  // comment so users can scan annotations without clicking each pin open.
  var pinTip = document.createElement('div');
  pinTip.className = 'pp-pin-tip';
  pinTip.setAttribute('role', 'tooltip');
  root.appendChild(pinTip);

  var toast = document.createElement('div');
  toast.className = 'pp-toast pp-hidden';
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('role', 'status');
  root.appendChild(toast);

  var toastTimer = null;

  /* ── floating annotation navigator ────────────────────── */
  var navPill = document.createElement('div');
  navPill.className = 'pp-nav-pill pp-hidden';
  navPill.setAttribute('aria-label', 'Annotation navigator');
  navPill.innerHTML =
    '<button class="pp-nav-btn pp-nav-prev" aria-label="Previous annotation">' + ph(P.arrowUp, 14) + '</button>' +
    '<span class="pp-nav-label"></span>' +
    '<button class="pp-nav-btn pp-nav-next" aria-label="Next annotation">' + ph(P.arrowUp, 14) + '</button>';
  root.appendChild(navPill);

  var navPrev = navPill.querySelector('.pp-nav-prev');
  var navNext = navPill.querySelector('.pp-nav-next');
  var navLabel = navPill.querySelector('.pp-nav-label');
  var navPillActive = false;
  var navCurrentId = null;
  var navHideTimer = null;

  var toggle = document.createElement('button');
  toggle.className = 'pp-toggle';
  toggle.setAttribute('data-tip', 'Agimut');
  toggle.setAttribute('aria-label', 'Open Agimut');
  toggle.innerHTML = logoSvg;
  var toggleBadge = document.createElement('span');
  toggleBadge.className = 'pp-toggle-badge pp-hidden';
  toggle.appendChild(toggleBadge);
  root.appendChild(toggle);

  /* ── menu panel (settings + shortcuts) ─────────────────── */
  var menuPanel = document.createElement('div');
  menuPanel.className = 'pp-menu pp-hidden';
  menuPanel.setAttribute('role', 'region');
  menuPanel.setAttribute('aria-label', 'Menu');
  menuPanel.innerHTML =
    '<div class="pp-menu-section">' +
      '<div class="pp-sc-title">Settings</div>' +
      '<div class="pp-menu-row">' +
        '<span class="pp-menu-label">Keyboard navigation</span>' +
        '<label class="pp-switch-label">' +
          '<input type="checkbox" class="pp-switch-input pp-keynav-toggle">' +
          '<span class="pp-switch-track"></span>' +
        '</label>' +
      '</div>' +
      '<div class="pp-menu-row">' +
        '<span class="pp-menu-label">Clear after copy</span>' +
        '<label class="pp-switch-label">' +
          '<input type="checkbox" class="pp-switch-input pp-clearcopy-toggle">' +
          '<span class="pp-switch-track"></span>' +
        '</label>' +
      '</div>' +
    '</div>' +
    '<div class="pp-menu-divider"></div>' +
    '<div class="pp-menu-section">' +
      '<div class="pp-sc-title">Shortcuts</div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Comment mode</span><div class="pp-sc-keys"><kbd class="pp-key">C</kbd></div></div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Copy annotations</span><div class="pp-sc-keys"><kbd class="pp-key">A</kbd></div></div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Copy & clear</span><div class="pp-sc-keys"><kbd class="pp-key">Shift</kbd><kbd class="pp-key">A</kbd></div></div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Delete all</span><div class="pp-sc-keys"><kbd class="pp-key">X</kbd><kbd class="pp-key">X</kbd><kbd class="pp-key">X</kbd></div></div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Undo delete</span><div class="pp-sc-keys"><kbd class="pp-key">Z</kbd></div></div>' +
    '</div>' +
    '<div class="pp-menu-divider"></div>' +
    '<div class="pp-menu-section">' +
      '<div class="pp-sc-title">Navigation</div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Move selection</span><div class="pp-sc-keys"><kbd class="pp-key">\u2190</kbd><kbd class="pp-key">\u2191</kbd><kbd class="pp-key">\u2193</kbd><kbd class="pp-key">\u2192</kbd></div></div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Parent / child</span><div class="pp-sc-keys"><kbd class="pp-key">Shift</kbd><kbd class="pp-key">\u2191</kbd><kbd class="pp-key">\u2193</kbd></div></div>' +
    '</div>';
  root.appendChild(menuPanel);

  /* ── button refs ───────────────────────────────────────── */
  var btnComment = bar.querySelector('.pp-btn-comment');
  var btnCopy    = bar.querySelector('.pp-btn-copy');
  var btnDelete  = bar.querySelector('.pp-btn-delete');
  var btnClose      = bar.querySelector('.pp-btn-close');
  var btnShortcuts  = bar.querySelector('.pp-btn-shortcuts');
  var countEl       = bar.querySelector('.pp-count');

  function applyTheme(theme) {
    uiTheme = theme === 'light' ? 'light' : 'dark';
    root.setAttribute('data-theme', uiTheme);
  }

  function normalizeToolbarPosition(position) {
    if (position === 'top-left' || position === 'top-right' ||
        position === 'bottom-left' || position === 'bottom-right') {
      return position;
    }
    if (position === 'top-center') return 'top-left';
    if (position === 'bottom-center') return 'bottom-left';
    return 'bottom-left';
  }

  /* Spacing constants for the fixed UI stack (toolbar → nav pill → toast).
     Everything below is computed so gaps stay equal even if one element's
     height changes. Anchor is the bar at MAIN_OFFSET from the screen edge,
     then each stacked element sits STACK_GAP below the previous one. */
  var MAIN_OFFSET = 20;       // distance from screen edge to bar
  var STACK_GAP = 4;          // even gap between stacked elements
  var TOOLBAR_HEIGHT = 52;    // matches --pp-toolbar-size (38 + 6*2 + 2)
  var NAV_PILL_HEIGHT = 40;   // 30 (nav-btn) + 4*2 (padding) + 2 (border)

  function stackOffsetPx() {
    return MAIN_OFFSET + TOOLBAR_HEIGHT + STACK_GAP;
  }

  function toastOffsetPx() {
    var base = stackOffsetPx();
    if (!navPillActive) return base;
    // Prefer actual measured height; fall back to constant if hidden.
    var h = navPill.offsetHeight || NAV_PILL_HEIGHT;
    return base + h + STACK_GAP;
  }

  function applyToolbarPosition(position) {
    var pos = normalizeToolbarPosition(position);
    var isTop = pos.indexOf('top-') === 0;
    var isRight = pos.indexOf('-right') !== -1;

    toolbarPosition = pos;

    [bar, toggle, menuPanel, toast, navPill].forEach(function (el) {
      el.style.top = '';
      el.style.bottom = '';
      el.style.left = '';
      el.style.right = '';
      el.style.transform = '';
    });

    var mainOffset = MAIN_OFFSET + 'px';
    var stackOffset = stackOffsetPx() + 'px';
    var toastOffset = toastOffsetPx() + 'px';

    if (isTop) {
      bar.style.top = mainOffset;
      toggle.style.top = mainOffset;
      menuPanel.style.top = stackOffset;
      toast.style.top = toastOffset;
      navPill.style.top = stackOffset;
    } else {
      bar.style.bottom = mainOffset;
      toggle.style.bottom = mainOffset;
      menuPanel.style.bottom = stackOffset;
      toast.style.bottom = toastOffset;
      navPill.style.bottom = stackOffset;
    }

    if (isRight) {
      [bar, toggle, menuPanel, toast, navPill].forEach(function (el) {
        el.style.right = '20px';
      });
    } else {
      [bar, toggle, menuPanel, toast, navPill].forEach(function (el) {
        el.style.left = '20px';
      });
    }
  }

  /* ── activate / deactivate ─────────────────────────────── */
  function activate() {
    active = true;
    clearTimeout(morphTimer);
    toggle.classList.add('pp-hidden');

    // Measure natural bar width
    bar.style.visibility = 'hidden';
    bar.style.transition = 'none';
    bar.style.width = '';
    bar.style.borderRadius = '';
    bar.style.overflow = '';
    bar.classList.remove('pp-hidden');
    var fullWidth = bar.offsetWidth;
    var collapsedSize = bar.offsetHeight;
    var collapsedRadius = window.getComputedStyle(toggle).borderRadius || '18px';

    // Snap to the blurred + collapsed source state with no transitions, so
    // the blur reads as a punctuation at the START of the open. The
    // follow-up transition then de-blurs while the bar expands — by the
    // time the geometric animation finishes the bar is crisp again,
    // mirroring how deactivate() collapses clean.
    bar.style.width = collapsedSize + 'px';
    bar.style.borderRadius = collapsedRadius;
    bar.style.overflow = 'hidden';
    bar.style.filter = 'blur(2px)';
    void bar.offsetWidth;
    bar.style.visibility = '';

    // Animate expansion + un-blur
    bar.style.transition = 'width 140ms cubic-bezier(0.2, 0, 0, 1), border-radius 140ms cubic-bezier(0.2, 0, 0, 1), filter 80ms cubic-bezier(0.2, 0, 0, 1)';
    bar.style.width = fullWidth + 'px';
    bar.style.borderRadius = '';
    bar.style.filter = 'blur(0)';

    morphTimer = setTimeout(function () {
      bar.style.transition = '';
      bar.style.width = '';
      bar.style.borderRadius = '';
      bar.style.overflow = '';
      bar.style.filter = '';
    }, 160);

    pinLayer.classList.remove('pp-hidden');
    startCommenting();
  }

  // `disableSite` = the user explicitly turned Agimut off for this domain
  // (the toolbar's close button), not just a transient collapse. When true we
  // persist the domain into disabledHosts so a refresh keeps it off, and leave
  // the toggle hidden instead of restoring it. Re-enable is via the popup.
  function deactivate(disableSite) {
    active = false;
    if (disableSite) persistSiteDisabled();
    stopCommenting();
    hidePopover();
    hideTargetHighlight();
    hideOverlay();
    hideMenu();
    hideBarTip();
    hidePinTip();
    clearUndoState();
    clearBrowserSelection();
    selectionPointerDown = false;

    // Cancel all pending flash animations
    flashTimers.forEach(function (timers, btn) {
      timers.forEach(clearTimeout);
      btn.classList.remove('pp-flash-out', 'pp-flash-in');
    });
    flashTimers.clear();

    clearTimeout(toastTimer);
    toast.classList.add('pp-hidden');
    toast.classList.remove('pp-toast-in', 'pp-toast-out');

    // Force-clear nav pill (hidePopover calls hideNavPill but timer may linger)
    clearTimeout(navHideTimer);
    navPill.classList.add('pp-hidden');
    navPill.classList.remove('pp-pill-in', 'pp-pill-out');
    navPillActive = false;
    navCurrentId = null;

    clearTimeout(morphTimer);

    // Capture width, collapse to toggle size
    var curWidth = bar.offsetWidth;
    var collapsedSize = bar.offsetHeight;
    var collapsedRadius = window.getComputedStyle(toggle).borderRadius || '18px';
    // Snap to the blurred state instantly (no filter transition) so the
    // blur reads as a punctuation at the START of the close, not a smear
    // that's still happening at the end. The follow-up transition then
    // fades the blur back to 0 while the bar continues collapsing — the
    // collapse finishes clean, mirroring how activate() opens.
    bar.style.transition = 'none';
    bar.style.width = curWidth + 'px';
    bar.style.overflow = 'hidden';
    bar.style.filter = 'blur(2px)';
    void bar.offsetWidth;

    bar.style.transition = 'width 140ms cubic-bezier(0.2, 0, 0, 1), border-radius 140ms cubic-bezier(0.2, 0, 0, 1), filter 80ms cubic-bezier(0.2, 0, 0, 1)';
    bar.style.width = collapsedSize + 'px';
    bar.style.borderRadius = collapsedRadius;
    bar.style.filter = 'blur(0)';

    morphTimer = setTimeout(function () {
      bar.style.transition = '';
      bar.style.width = '';
      bar.style.borderRadius = '';
      bar.style.overflow = '';
      bar.style.filter = '';
      bar.classList.add('pp-hidden');
      // Keep the toggle hidden when the user disabled the whole site; only a
      // transient collapse restores the re-open button.
      if (disableSite) toggle.classList.add('pp-hidden');
      else toggle.classList.remove('pp-hidden');
    }, 160);

    pinLayer.classList.add('pp-hidden');
  }

  /* ── comment mode ──────────────────────────────────────── */
  function startCommenting() {
    commenting = true;
    btnComment.classList.add('pp-active-btn');
    document.documentElement.classList.add('pp-commenting');
  }

  function stopCommenting() {
    commenting = false;
    btnComment.classList.remove('pp-active-btn');
    document.documentElement.classList.remove('pp-commenting');
    hideOverlay();
    // Leaving comment mode drops any pending multi-select batch — the locked
    // highlights would otherwise sit on the page with no way to commit them.
    // Close the multi popover too; its chip count would be stale once the
    // batch is cleared.
    if (popoverIsMulti) hidePopover();
    clearMultiSelect();
    // Toggling comment mode off is an explicit "I'm done" signal — the
    // popover is gone, so a draft can't be resumed without re-entering
    // comment mode anyway. Drop it.
    clearDraft();
  }

  /* ── annotation count badge (#6) ───────────────────────── */
  function updateCount() {
    // Count unique annotations (targets), not raw note entries.
    var n = getUniqueAnnotations().length;
    if (n > 0) {
      countEl.textContent = n;
      countEl.classList.remove('pp-hidden');
      toggleBadge.textContent = n;
      toggleBadge.classList.remove('pp-hidden');
      toggleBadge.classList.remove('pp-badge-pop');
      void toggleBadge.offsetWidth;
      toggleBadge.classList.add('pp-badge-pop');
    } else {
      countEl.classList.add('pp-hidden');
      toggleBadge.classList.add('pp-hidden');
      toggleBadge.classList.remove('pp-badge-pop');
    }
  }

  /* ── toast notification ───────────────────────────────── */
  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.style.top = '';
    toast.style.bottom = '';
    var offset = toastOffsetPx() + 'px';
    if (toolbarPosition.indexOf('top-') === 0) {
      toast.style.top = offset;
    } else {
      toast.style.bottom = offset;
    }
    toast.classList.remove('pp-hidden', 'pp-toast-out');
    void toast.offsetWidth;
    toast.classList.add('pp-toast-in');
    toastTimer = setTimeout(function () {
      toast.classList.remove('pp-toast-in');
      toast.classList.add('pp-toast-out');
      toastTimer = setTimeout(function () {
        toast.classList.add('pp-hidden');
        toast.classList.remove('pp-toast-out');
        toast.style.top = '';
        toast.style.bottom = '';
        applyToolbarPosition(toolbarPosition);
      }, 160);
    }, 2500);
  }

  /* ── hover overlay ─────────────────────────────────────── */
  function showOverlay(el, mode) {
    var r = el.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    // Clamp overlay to visible viewport portion (handles elements larger than screen)
    var visTop = Math.max(0, r.top);
    var visLeft = Math.max(0, r.left);
    var visBottom = Math.min(vh, r.bottom);
    var visRight = Math.min(vw, r.right);
    var visW = Math.max(0, visRight - visLeft);
    var visH = Math.max(0, visBottom - visTop);

    overlay.style.top = visTop + 'px';
    overlay.style.left = visLeft + 'px';
    overlay.style.width = visW + 'px';
    overlay.style.height = visH + 'px';
    overlay.classList.toggle('pp-ref-on', mode === 'reference');
    overlay.classList.add('pp-on');

    var name = typeName(el);
    var text = (el.textContent || '').trim();
    var preview = text.length > 35 ? text.slice(0, 35) + '\u2026' : text;
    tip.textContent = (mode === 'reference' ? 'Reference ' : '') + name + (preview ? ': ' + preview : '');

    // Clamp tooltip to viewport (#8)
    var tipLeft = visLeft;
    var tipRight = tipLeft + 280;
    if (tipRight > vw - 8) {
      tipLeft = Math.max(8, vw - 288);
    }
    tip.style.left = Math.max(8, tipLeft) + 'px';
    tip.style.top = (visTop > 30 ? visTop - 26 : visBottom + 4) + 'px';
    tip.classList.add('pp-on');
  }

  function hideOverlay() {
    overlay.classList.remove('pp-on');
    overlay.classList.remove('pp-ref-on');
    tip.classList.remove('pp-on');
    hovered = null;
  }

  function clampRect(rect) {
    var left = Math.max(0, rect.left);
    var top = Math.max(0, rect.top);
    var right = Math.min(window.innerWidth, rect.right);
    var bottom = Math.min(window.innerHeight, rect.bottom);
    return {
      left: left,
      top: top,
      right: right,
      bottom: bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function clearHighlights() {
    highlightNodes.forEach(function (node) { node.remove(); });
    highlightNodes = [];
  }

  function showHighlightRects(rects, className) {
    clearHighlights();
    rects.forEach(function (rect) {
      if (!rect || rect.width < 1 || rect.height < 1) return;
      var node = document.createElement('div');
      node.className = 'pp-target-highlight' + (className ? ' ' + className : '');
      node.style.top = rect.top + 'px';
      node.style.left = rect.left + 'px';
      node.style.width = rect.width + 'px';
      node.style.height = rect.height + 'px';
      highlightLayer.appendChild(node);
      highlightNodes.push(node);
    });
  }

  function getVisibleElementRects(elements) {
    var rects = [];
    elements.forEach(function (element) {
      if (!element || !element.isConnected) return;
      var rect = clampRect(element.getBoundingClientRect());
      if (rect.width > 0 && rect.height > 0) rects.push(rect);
    });
    return rects;
  }

  function getRangeRects(range) {
    if (!range) return [];
    return Array.from(range.getClientRects()).map(clampRect).filter(function (rect) {
      return rect.width > 0 && rect.height > 0;
    });
  }

  function getUnionRect(rects) {
    if (!rects.length) return null;
    var left = rects[0].left;
    var top = rects[0].top;
    var right = rects[0].right;
    var bottom = rects[0].bottom;

    for (var i = 1; i < rects.length; i++) {
      left = Math.min(left, rects[i].left);
      top = Math.min(top, rects[i].top);
      right = Math.max(right, rects[i].right);
      bottom = Math.max(bottom, rects[i].bottom);
    }

    return {
      left: left,
      top: top,
      right: right,
      bottom: bottom,
      width: right - left,
      height: bottom - top,
    };
  }

  function normalizeQuote(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function getRangeOffsets(container, range) {
    if (!container || !range) return null;
    try {
      var startRange = document.createRange();
      startRange.selectNodeContents(container);
      startRange.setEnd(range.startContainer, range.startOffset);

      var endRange = document.createRange();
      endRange.selectNodeContents(container);
      endRange.setEnd(range.endContainer, range.endOffset);

      return {
        start: startRange.toString().length,
        end: endRange.toString().length,
      };
    } catch (e) {
      return null;
    }
  }

  function restoreRangeFromOffsets(container, start, end, quote) {
    if (!container) return null;

    var textContent = container.textContent || '';
    if (quote && (!textContent || end > textContent.length)) {
      var idx = textContent.indexOf(quote);
      if (idx !== -1) {
        start = idx;
        end = idx + quote.length;
      }
    }

    if (start < 0 || end <= start) return null;

    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    var currentIndex = 0;
    var startNode = null;
    var endNode = null;
    var startOffset = 0;
    var endOffset = 0;

    while (walker.nextNode()) {
      var node = walker.currentNode;
      var nextIndex = currentIndex + node.nodeValue.length;
      if (!startNode && start >= currentIndex && start <= nextIndex) {
        startNode = node;
        startOffset = start - currentIndex;
      }
      if (!endNode && end >= currentIndex && end <= nextIndex) {
        endNode = node;
        endOffset = end - currentIndex;
        break;
      }
      currentIndex = nextIndex;
    }

    if (!startNode || !endNode) return null;

    var range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }

  function getTargetKey(target) {
    if (!target) return '';
    if (target.kind === 'text') {
      return 'text:' + target.selector + ':' + target.textStart + ':' + target.textEnd;
    }
    return 'element:' + target.selector;
  }

  function getTargetDescription(target) {
    if (!target) return '';
    if (target.kind === 'text') return target.quote || 'Selected text';
    return target.selector;
  }

  function getTargetRects(target) {
    if (!target) return [];
    if (target.kind === 'text') {
      var rangeRects = getRangeRects(target.range);
      if (rangeRects.length) return rangeRects;
      return getVisibleElementRects(target.el ? [target.el] : []);
    }
    return getVisibleElementRects(target.el ? [target.el] : []);
  }

  function getTargetAnchorRect(target) {
    return getUnionRect(getTargetRects(target));
  }

  function showTargetHighlight(target) {
    if (!target) return;
    if (target.kind === 'element') {
      clearHighlights();
      showOverlay(target.el);
      return;
    }
    hideOverlay();
    showHighlightRects(getTargetRects(target), 'pp-target-highlight-text');
  }

  function hideTargetHighlight() {
    clearHighlights();
  }

  function getSelectionContainer(range) {
    if (!range) return null;
    var node = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    while (node && !isSkippable(node)) {
      var rect = node.getBoundingClientRect();
      if (rect.width > 8 && rect.height > 8) return node;
      node = node.parentElement;
    }
    return null;
  }

  function getTextSelectionTarget() {
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    var range = selection.getRangeAt(0);
    var quote = normalizeQuote(selection.toString());
    if (!quote || root.contains(range.commonAncestorContainer)) return null;

    var container = getSelectionContainer(range);
    if (!container) return null;

    var offsets = getRangeOffsets(container, range);
    if (!offsets || offsets.end <= offsets.start) return null;

    return {
      kind: 'text',
      el: container,
      selector: buildSelector(container),
      type: 'text',
      quote: quote,
      textStart: offsets.start,
      textEnd: offsets.end,
      range: range.cloneRange(),
      key: '',
    };
  }

  function clearBrowserSelection() {
    var selection = window.getSelection();
    if (selection && selection.rangeCount > 0) selection.removeAllRanges();
  }

  function makeElementTarget(el) {
    return {
      kind: 'element',
      el: el,
      selector: buildSelector(el),
      type: typeName(el),
      key: '',
    };
  }

  function prepareTarget(target) {
    if (!target) return null;
    target.key = getTargetKey(target);
    return target;
  }

  /* ── multi-target selection helpers ─────────────────────── */
  function isInMultiSelect(target) {
    if (!target) return false;
    var key = target.key || getTargetKey(target);
    for (var i = 0; i < multiTargets.length; i++) {
      if (multiTargets[i].key === key) return true;
    }
    return false;
  }

  function positionMultiHighlight(target, node) {
    var rect = getTargetAnchorRect(target);
    if (!rect || rect.width < 1 || rect.height < 1) {
      node.style.display = 'none';
      return;
    }
    node.style.display = '';
    node.style.top = rect.top + 'px';
    node.style.left = rect.left + 'px';
    node.style.width = rect.width + 'px';
    node.style.height = rect.height + 'px';
  }

  function addToMultiSelect(target) {
    if (!target) return;
    target = prepareTarget(target);
    if (target.kind !== 'element') return; // elements only for v1
    if (isInMultiSelect(target)) return;
    multiTargets.push(target);
    var node = document.createElement('div');
    node.className = 'pp-target-highlight pp-target-highlight-locked';
    highlightLayer.appendChild(node);
    multiHighlightNodes.set(target.key, node);
    positionMultiHighlight(target, node);
  }

  function removeFromMultiSelect(target) {
    if (!target) return;
    var key = target.key || getTargetKey(target);
    var idx = -1;
    for (var i = 0; i < multiTargets.length; i++) {
      if (multiTargets[i].key === key) { idx = i; break; }
    }
    if (idx === -1) return;
    multiTargets.splice(idx, 1);
    var node = multiHighlightNodes.get(key);
    if (node) {
      node.remove();
      multiHighlightNodes.delete(key);
    }
  }

  function clearMultiSelect() {
    if (multiTargets.length === 0 && multiHighlightNodes.size === 0) return;
    multiTargets = [];
    multiHighlightNodes.forEach(function (node) { node.remove(); });
    multiHighlightNodes.clear();
  }

  // Read the current multi popover's editor (if any) so the next rebuild
  // can re-render the in-progress comment text and reference chips. Returns
  // null when no multi popover is open, signalling "fresh editor".
  function captureMultiEditorState() {
    if (!popoverIsMulti || !popover) return null;
    var editor = popover.querySelector('.pp-pop-editor');
    if (!editor) return null;
    return serializeEditor(editor);
  }

  function refreshMultiHighlights() {
    multiTargets.forEach(function (target) {
      var node = multiHighlightNodes.get(target.key);
      if (node) positionMultiHighlight(target, node);
    });
  }

  // Union bounding box of all selected targets. Used as the synthetic anchor
  // for positionPop when the popover is rendering in multi-mode.
  function getMultiAnchorRect(list) {
    list = list || multiTargets;
    if (!list.length) return null;
    var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (var i = 0; i < list.length; i++) {
      var r = getTargetAnchorRect(list[i]);
      if (!r) continue;
      if (r.left < left) left = r.left;
      if (r.top < top) top = r.top;
      if (r.right > right) right = r.right;
      if (r.bottom > bottom) bottom = r.bottom;
    }
    if (!isFinite(left) || !isFinite(top)) return null;
    return {
      left: left, top: top, right: right, bottom: bottom,
      width: right - left, height: bottom - top,
    };
  }

  function getAnnotationsForTarget(target) {
    var key = target ? target.key || getTargetKey(target) : '';
    return annotations.filter(function (ann) { return ann.key === key; });
  }

  // One entry per unique target — multiple notes can share a key (and id).
  // Used wherever the UI counts/navigates "annotations" rather than "notes":
  // toolbar badge, nav pill, popover.
  function getUniqueAnnotations() {
    var seen = {};
    return annotations.filter(function (a) {
      if (seen[a.key]) return false;
      seen[a.key] = true;
      return true;
    });
  }

  function getTargetFromAnnotation(ann) {
    if (!ann || ann.orphaned) return null;
    if (ann.kind === 'text') {
      var range = ann.range || restoreRangeFromOffsets(ann.el, ann.textStart, ann.textEnd, ann.quote);
      if (!range) {
        markAnnotationOrphaned(ann);
        return null;
      }
      ann.range = range;
      return prepareTarget({
        kind: 'text',
        el: ann.el,
        selector: ann.selector,
        type: 'text',
        quote: ann.quote,
        textStart: ann.textStart,
        textEnd: ann.textEnd,
        range: range,
      });
    }
    return prepareTarget({
      kind: 'element',
      el: ann.el,
      selector: ann.selector,
      type: ann.type,
    });
  }

  function scrollAnnotationIntoView(ann, done) {
    if (!ann) {
      if (done) done(false);
      return;
    }
    var targetEl = ann.el;
    if (!targetEl || !targetEl.isConnected) {
      if (done) done(false);
      return;
    }

    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var settled = 0;
    var lastY = targetEl.getBoundingClientRect().top;
    var frameCount = 0;

    function finish(success) {
      if (!done) return;
      var cb = done;
      done = null;
      cb(success);
    }

    function waitForScroll() {
      frameCount++;
      if (!targetEl.isConnected || frameCount > 60) {
        finish(false);
        return;
      }
      var curY = targetEl.getBoundingClientRect().top;
      if (Math.abs(curY - lastY) < 1) {
        settled++;
        if (settled >= 3) {
          finish(true);
          return;
        }
      } else {
        settled = 0;
      }
      lastY = curY;
      requestAnimationFrame(waitForScroll);
    }

    requestAnimationFrame(waitForScroll);
  }

  /* ── popover ───────────────────────────────────────────── */
  function makeReferenceId() {
    return 'ref-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function makeReferenceFromElement(el) {
    var label = typeName(el);
    var text = getTextPreview(el);
    return {
      id: makeReferenceId(),
      selector: buildSelector(el),
      type: label,
      label: label + (text ? ': ' + text : ''),
      html: getCleanTag(el),
      text: text,
      context: getAncestorTrail(el),
    };
  }

  function resolveReference(ref) {
    if (!ref || !ref.selector) return null;
    var el = null;
    try { el = document.querySelector(ref.selector); } catch (e) { el = null; }
    if (!el || isSkippable(el)) return null;
    ref.type = typeName(el);
    ref.label = ref.type + (getTextPreview(el) ? ': ' + getTextPreview(el) : '');
    ref.html = getCleanTag(el);
    ref.text = getTextPreview(el);
    ref.context = getAncestorTrail(el);
    return el;
  }

  function sanitizeReferences(refs) {
    if (!Array.isArray(refs) || !refs.length) return [];
    var kept = [];
    refs.forEach(function (ref) {
      if (resolveReference(ref)) kept.push(ref);
    });
    return kept;
  }

  function pruneMissingReferences() {
    var dirty = false;
    annotations.forEach(function (ann) {
      if (!ann.references || !ann.references.length) return;
      var nextRefs = sanitizeReferences(ann.references);
      if (nextRefs.length === ann.references.length) return;
      var ids = nextRefs.map(function (ref) { return ref.id; });
      ann.references = nextRefs;
      if (ann.parts) {
        ann.parts = ann.parts.filter(function (part) {
          return part.type !== 'ref' || ids.indexOf(part.id) !== -1;
        });
      }
      dirty = true;
    });
    if (dirty) persist();
  }

  function stopReferencePicking() {
    var wasPicking = referencePicking || referenceEditor;
    referencePicking = false;
    if (referenceEditor && referenceEditor.button) referenceEditor.button.classList.remove('pp-ref-active');
    referenceEditor = null;
    if (wasPicking) hideOverlay();
  }

  function getEditorRange(editor) {
    if (editor._savedRange &&
        editor.contains(editor._savedRange.startContainer) &&
        editor.contains(editor._savedRange.endContainer)) {
      return editor._savedRange.cloneRange();
    }
    var sel = window.getSelection();
    if (sel && sel.rangeCount) {
      var range = sel.getRangeAt(0);
      if (editor.contains(range.startContainer) && editor.contains(range.endContainer)) return range;
    }
    var end = document.createRange();
    end.selectNodeContents(editor);
    end.collapse(false);
    return end;
  }

  function saveEditorRange(editor) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
      editor._savedRange = range.cloneRange();
    }
  }

  function placeCaretAfter(node) {
    var range = document.createRange();
    var sel = window.getSelection();
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function createReferenceChip(ref, onRemove) {
    var chip = document.createElement('span');
    chip.className = 'pp-ref-chip';
    chip.contentEditable = 'false';
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.dataset.refId = ref.id;
    chip.title = ref.selector;

    var label = document.createElement('span');
    label.className = 'pp-ref-chip-label';
    label.textContent = ref.type || ref.label || 'element';
    chip.appendChild(label);

    function removeChip(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      var prev = chip.previousSibling;
      var next = chip.nextSibling;
      chip.remove();
      if (prev && prev.nodeType === Node.TEXT_NODE && next && next.nodeType === Node.TEXT_NODE) {
        prev.nodeValue += next.nodeValue;
        next.remove();
      }
      if (onRemove) onRemove();
    }

    chip.addEventListener('mouseenter', function () {
      var el = resolveReference(ref);
      if (el) showOverlay(el, 'reference');
    });
    chip.addEventListener('mouseleave', hideOverlay);
    chip.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' || e.key === 'Delete') removeChip(e);
    });

    return chip;
  }

  function insertReferenceChip(editor, ref) {
    editor.focus();
    editor._refs = editor._refs || [];
    editor._refs.push(ref);
    var chip = createReferenceChip(ref, function () {
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    var range = getEditorRange(editor);
    range.deleteContents();
    var after = document.createTextNode(' ');
    range.insertNode(after);
    range.insertNode(chip);
    placeCaretAfter(after);
    editor._savedRange = null;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function serializeEditor(editor) {
    var refs = [];
    var parts = [];
    var comment = '';

    function pushText(text) {
      if (!text) return;
      parts.push({ type: 'text', text: text });
      comment += text;
    }

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        pushText(node.nodeValue);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.classList && node.classList.contains('pp-ref-chip')) {
        var id = node.dataset.refId;
        var ref = (editor._refs || []).find(function (item) { return item.id === id; });
        if (ref && resolveReference(ref)) {
          refs.push(ref);
          parts.push({ type: 'ref', id: ref.id });
          comment += '[Referenced ' + (ref.type || 'element') + ']';
        }
        return;
      }
      if (node.tagName === 'BR') {
        pushText('\n');
        return;
      }
      Array.from(node.childNodes).forEach(walk);
      if (node.tagName === 'DIV' || node.tagName === 'P') pushText('\n');
    }

    Array.from(editor.childNodes).forEach(walk);
    return {
      comment: normalizeQuote(comment),
      refs: refs,
      parts: parts,
    };
  }

  function renderEditor(editor, comment, refs, parts, onChange) {
    editor.innerHTML = '';
    editor._refs = sanitizeReferences((refs || []).slice());

    function appendText(text) {
      editor.appendChild(document.createTextNode(text));
    }

    if (parts && parts.length) {
      parts.forEach(function (part) {
        if (part.type === 'ref') {
          var ref = editor._refs.find(function (item) { return item.id === part.id; });
          if (ref) editor.appendChild(createReferenceChip(ref, onChange));
        } else {
          appendText(part.text || '');
        }
      });
    } else if (comment) {
      appendText(comment);
    }
  }

  function createCommentEditor(options) {
    var editor = document.createElement('div');
    editor.className = 'pp-pop-editor';
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    editor.setAttribute('aria-label', options.label);
    editor.dataset.placeholder = options.placeholder;
    renderEditor(editor, options.comment || '', options.references || [], options.parts || [], options.onChange);
    return editor;
  }

  function buildCommentCard(ann, showBadge) {
    ann.references = sanitizeReferences(ann.references || []);
    var card = document.createElement('div');
    card.className = 'pp-comment-card';
    // Secondary cards reveal their copy/delete actions on hover only so the
    // popover stays calm when there are many notes; the first card keeps its
    // actions visible as the "primary" entry point for the annotation.
    if (showBadge === false) card.classList.add('pp-comment-card-secondary');

    var shell = document.createElement('div');
    shell.className = 'pp-input-shell pp-comment-shell';

    var badgeWrap = document.createElement('div');
    badgeWrap.className = 'pp-comment-badge-wrap';
    var editorRow = document.createElement('div');
    editorRow.className = 'pp-comment-editor-row';

    var badge = document.createElement('span');
    badge.className = 'pp-comment-badge';
    badge.textContent = ann.id;
    // Hidden via visibility (not display:none) so the header actions stay
    // right-aligned with the rest of the cards.
    if (showBadge === false) badge.classList.add('pp-comment-badge-invisible');
    badgeWrap.appendChild(badge);

    var headerActions = document.createElement('div');
    headerActions.className = 'pp-comment-header-actions';

    var copy = document.createElement('button');
    copy.className = 'pp-pop-btn pp-pop-copy';
    copy.title = 'Copy annotation';
    copy.setAttribute('aria-label', 'Copy annotation');
    copy.innerHTML = ico.copy;
    copy.addEventListener('click', function (e) {
      e.stopPropagation();
      // Copy every note attached to this target so the export reads as one
      // annotation with all of its feedback — not just the clicked card.
      var notes = annotations.filter(function (a) { return a.key === ann.key; });
      navigator.clipboard.writeText(formatMarkdown(notes.length ? notes : [ann])).then(
        function () {
          flashBtn(copy, ico.copy);
          showToast('Annotation ' + ann.id + ' copied');
        },
        function () { shakeBtn(copy); }
      );
    });
    headerActions.appendChild(copy);

    var del = document.createElement('button');
    del.className = 'pp-pop-btn pp-pop-delete';
    del.title = 'Delete';
    del.setAttribute('aria-label', 'Delete');
    del.innerHTML = ico.trashSm;
    del.addEventListener('click', function (e) {
      e.stopPropagation();
      deleteAnnotationAndContinue();
    });
    headerActions.appendChild(del);

    badgeWrap.appendChild(headerActions);
    card.appendChild(badgeWrap);

    var actions = document.createElement('div');
    actions.className = 'pp-comment-actions';

    var save = document.createElement('button');
    save.className = 'pp-pop-btn pp-pop-save pp-pop-submit';
    save.title = 'Save';
    save.setAttribute('aria-label', 'Save');
    save.innerHTML = ico.check;
    save.disabled = true;
    save.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      commitAnnotationEdit();
    });

    var input = createCommentEditor({
      label: 'Annotation ' + ann.id,
      placeholder: 'Describe what should change',
      comment: ann.comment,
      references: ann.references,
      parts: ann.parts,
      onChange: updateSaveState,
    });
    editorRow.appendChild(input);
    shell.appendChild(editorRow);

    var controlRow = document.createElement('div');
    controlRow.className = 'pp-comment-control-row';
    controlRow.appendChild(actions);
    controlRow.appendChild(save);
    shell.appendChild(controlRow);
    card.appendChild(shell);

    var savedSnapshot = snapshotEditorData(getCurrentEditorData());

    function snapshotEditorData(data) {
      return JSON.stringify({
        comment: data.comment || '',
        refs: (data.refs || []).map(function (ref) {
          return {
            id: ref.id,
            selector: ref.selector,
            type: ref.type,
            text: ref.text || '',
            context: ref.context || '',
          };
        }),
        parts: data.parts || [],
      });
    }

    function getCurrentEditorData() {
      return serializeEditor(input);
    }

    function setSaveDirty(isDirty) {
      save.classList.toggle('pp-submit-on', isDirty);
      shell.classList.toggle('pp-comment-dirty', isDirty);
      save.disabled = !isDirty;
    }

    function updateSaveState() {
      setSaveDirty(snapshotEditorData(getCurrentEditorData()) !== savedSnapshot);
    }

    function commitAnnotationEdit() {
      var data = getCurrentEditorData();
      if (!data.comment && data.refs.length === 0) {
        deleteAnnotationAndContinue();
        return;
      }
      ann.comment = data.comment;
      ann.references = data.refs;
      ann.parts = data.parts;
      persist();
      savedSnapshot = snapshotEditorData(data);
      setSaveDirty(false);
      flashBtn(save, ico.check);
      showToast('Annotation ' + ann.id + ' saved');
    }

    function deleteAnnotationAndContinue() {
      var target = popoverTarget || getTargetFromAnnotation(ann);
      deleteAnnotation(ann);
      var remaining = annotations.filter(function (item) { return item.key === ann.key; });
      if (remaining.length > 0) {
        // Other notes for this target are still around — re-open the popover
        // so the user sees the remaining notes plus a fresh new-comment row.
        if (target) {
          showTargetHighlight(target);
          showPopover(target, remaining[0]);
        }
        return;
      }
      if (target) {
        showTargetHighlight(target);
        showPopover(target);
        return;
      }
      hidePopover();
      hideTargetHighlight();
      hideOverlay();
    }

    input.addEventListener('input', function () {
      updateSaveState();
      saveEditorRange(input);
    });
    input.addEventListener('keyup', function () { saveEditorRange(input); });
    input.addEventListener('mouseup', function () { saveEditorRange(input); });
    input.addEventListener('click', function () { saveEditorRange(input); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        hidePopover();
        hideTargetHighlight();
        hideOverlay();
        if (commenting) stopCommenting();
        return;
      }
      saveEditorRange(input);
      e.stopPropagation();
    });

    var ref = document.createElement('button');
    ref.className = 'pp-pop-btn pp-pop-ref pp-ref-picker';
    ref.title = 'Reference element';
    ref.setAttribute('aria-label', 'Reference element');
    ref.innerHTML = ico.eyedropper;
    ref.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      saveEditorRange(input);
    });
    ref.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      referencePicking = !referencePicking;
      if (referencePicking) {
        saveEditorRange(input);
        referenceEditor = { editor: input, button: ref };
        ref.classList.add('pp-ref-active');
        input.focus();
        hideTargetHighlight();
        hideOverlay();
      } else {
        stopReferencePicking();
      }
    });
    actions.insertBefore(ref, actions.firstChild);

    return card;
  }

  function showPopover(target, ann, draft) {
    hidePopover();
    hidePinTip();
    target = prepareTarget(target);
    editingAnn = ann || null;
    popoverTarget = target;

    var targetAnns = getAnnotationsForTarget(target);
    var isEdit = targetAnns.length > 0;
    var quoteTextNode = null;
    var quoteBlockNode = null;

    var pop = document.createElement('div');
    pop.className = 'pp-popover';

    if (isEdit) {
      targetAnns.forEach(function (a, i) {
        // All notes for this target share an id; only the first card needs to
        // display the badge — repeating it on every card is visual noise.
        pop.appendChild(buildCommentCard(a, i === 0));
      });
    }

    var newSection = document.createElement('div');
    newSection.className = 'pp-new-comment';

    if (target.kind === 'text') {
      var quote = document.createElement('div');
      quote.className = 'pp-pop-quote';
      quote.title = getTargetDescription(target);

      var quoteRail = document.createElement('div');
      quoteRail.className = 'pp-pop-quote-rail';
      quote.appendChild(quoteRail);

      var quoteText = document.createElement('div');
      quoteText.className = 'pp-pop-quote-text';
      quoteText.textContent = getTargetDescription(target);
      quote.appendChild(quoteText);
      quoteTextNode = quoteText;
      quoteBlockNode = quote;

      var quoteMark = document.createElement('div');
      quoteMark.className = 'pp-pop-quote-mark';
      quoteMark.innerHTML = '&rdquo;';
      quote.appendChild(quoteMark);

      newSection.appendChild(quote);
    }

    var newRow = document.createElement('div');
    newRow.className = 'pp-new-comment-row';

    var newBadgeWrap = document.createElement('div');
    newBadgeWrap.className = 'pp-comment-badge-wrap pp-new-comment-badge-wrap';
    var newBadge = document.createElement('span');
    newBadge.className = 'pp-comment-badge';
    // When the target already has notes, the cards above already show the
    // number — repeating it next to "Add another note" is noise. Hide the
    // badge in that case; fresh targets still show the reserved id.
    if (isEdit && targetAnns.length > 0) {
      newBadgeWrap.classList.add('pp-comment-badge-wrap-hidden');
    } else {
      newBadge.textContent = nextId;
    }
    newBadgeWrap.appendChild(newBadge);
    newRow.appendChild(newBadgeWrap);

    var shell = document.createElement('div');
    shell.className = 'pp-input-shell pp-comment-shell pp-input-shell-new';

    var editorRow = document.createElement('div');
    editorRow.className = 'pp-comment-editor-row pp-new-comment-editor-row';

    var input = createCommentEditor({
      label: 'New comment',
      placeholder: isEdit ? 'Add another note' : 'Describe what should change',
      onChange: sync,
      comment: draft ? draft.comment || '' : '',
      references: draft ? draft.references || [] : [],
      parts: draft ? draft.parts || [] : [],
    });
    editorRow.appendChild(input);
    shell.appendChild(editorRow);

    var btnRow = document.createElement('div');
    btnRow.className = 'pp-pop-btns';

    var refBtn = document.createElement('button');
    refBtn.className = 'pp-pop-btn pp-ref-picker';
    refBtn.title = 'Reference element';
    refBtn.setAttribute('aria-label', 'Reference element');
    refBtn.innerHTML = ico.eyedropper;
    refBtn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      saveEditorRange(input);
    });
    refBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      referencePicking = !referencePicking;
      if (referencePicking) {
        saveEditorRange(input);
        referenceEditor = { editor: input, button: refBtn };
        refBtn.classList.add('pp-ref-active');
        input.focus();
        hideTargetHighlight();
        hideOverlay();
      } else {
        stopReferencePicking();
      }
    });
    btnRow.appendChild(refBtn);

    var submit = document.createElement('button');
    submit.className = 'pp-pop-btn pp-pop-submit';
    submit.title = 'Add';
    submit.setAttribute('aria-label', 'Add');
    submit.innerHTML = ico.arrowUp;
    submit.disabled = true;

    function sync() {
      var data = serializeEditor(input);
      var on = data.comment.trim().length > 0 || data.refs.length > 0;
      submit.classList.toggle('pp-submit-on', on);
      submit.disabled = !on;
    }
    // Snapshot the editor to chrome.storage.local so a dev-server refresh
    // (Vite HMR, etc.) can rebuild this popover with the in-progress text.
    // Empty editor → wipe any existing draft instead of writing blank data.
    function snapshotDraft() {
      var data = serializeEditor(input);
      if (!data.comment.trim() && data.refs.length === 0) {
        clearDraft();
        return;
      }
      saveDraft({
        mode: 'single',
        target: serializeTargetForDraft(target),
        comment: data.comment,
        parts: data.parts,
        references: data.refs,
      });
    }
    sync();
    input.addEventListener('input', function () {
      sync();
      saveEditorRange(input);
      snapshotDraft();
    });
    input.addEventListener('keyup', function () { saveEditorRange(input); });
    input.addEventListener('mouseup', function () { saveEditorRange(input); });
    input.addEventListener('click', function () { saveEditorRange(input); });

    submit.addEventListener('click', function (e) {
      e.stopPropagation();
      commit();
    });
    btnRow.appendChild(submit);
    shell.appendChild(btnRow);
    newRow.appendChild(shell);
    newSection.appendChild(newRow);

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        clearDraft();
        hidePopover();
        hideTargetHighlight();
        hideOverlay();
        if (commenting) stopCommenting();
        return;
      }
      saveEditorRange(input);
      e.stopPropagation();
    });

    pop.appendChild(newSection);

    function commit() {
      var data = serializeEditor(input);
      if (!data.comment && data.refs.length === 0) return;
      addAnnotation(target, data.comment, data.refs, data.parts);
      clearDraft();
      hidePopover();
      hideTargetHighlight();
      hideOverlay();
    }

    root.appendChild(pop);
    popover = pop;
    positionPop(target, pop);
    // Re-position on the next frame too, in case the initial measurement
    // was made before fonts/layout had settled and dimensions changed.
    requestAnimationFrame(function () {
      if (popover === pop && popoverTarget === target) positionPop(target, pop);
    });
    observePopoverSize(pop, target);
    requestAnimationFrame(function () {
      if (quoteTextNode && quoteBlockNode) {
        var lineHeight = parseFloat(getComputedStyle(quoteTextNode).lineHeight) || 18;
        var isSingleLine = quoteTextNode.scrollHeight <= lineHeight * 1.5;
        quoteBlockNode.classList.toggle('pp-pop-quote-single', isSingleLine);
      }
      // Focus after layout so the caret is ready as soon as the box appears.
      input.focus();
    });
    if (ann) showNavPill(ann);
  }

  function observePopoverSize(pop, target) {
    if (popoverResizeObserver) {
      popoverResizeObserver.disconnect();
      popoverResizeObserver = null;
    }
    if (typeof ResizeObserver === 'undefined') return;
    popoverResizeObserver = new ResizeObserver(function () {
      if (popover === pop && popoverTarget === target) positionPop(target, pop);
    });
    popoverResizeObserver.observe(pop);
  }

  function hidePopover() {
    stopReferencePicking();
    if (popoverResizeObserver) {
      popoverResizeObserver.disconnect();
      popoverResizeObserver = null;
    }
    if (popover) {
      popover.remove();
      popover = null;
      popoverTarget = null;
      editingAnn = null;
    }
    // Reset the multi-mode flag — multiTargets themselves are preserved here
    // because showMultiPopover() re-opens via hidePopover()+rebuild on every
    // shift+click toggle. Callers that genuinely want to abandon the batch
    // (Esc, stopCommenting, SPA routes) call clearMultiSelect() themselves.
    popoverIsMulti = false;
    hideNavPill();
  }

  // Multi-target popover — opens when there's at least one element in
   // multiTargets. Every shift+click rebuilds this via hidePopover()+show.
   // Submit deep-clones the editor state into N independent annotations.
   //
   // `carried` is the previous editor's serializeEditor() output, captured
   // before this rebuild was triggered (chip add/remove). Re-using it
   // keeps in-progress text + reference chips alive across rebuilds —
   // without it, every shift+click would wipe the comment field. It's also
   // how a Vite-HMR draft restore re-enters multi-mode.
  function showMultiPopover(carried) {
    hidePopover();
    hidePinTip();
    if (multiTargets.length === 0) return;

    editingAnn = null;
    popoverTarget = null;
    popoverIsMulti = true;

    var pop = document.createElement('div');
    pop.className = 'pp-popover pp-popover-multi';

    var header = document.createElement('div');
    header.className = 'pp-pop-multi-header';

    var title = document.createElement('div');
    title.className = 'pp-pop-multi-title';
    title.textContent = 'Comment on ' + multiTargets.length +
      (multiTargets.length === 1 ? ' item' : ' items');
    header.appendChild(title);

    var chipsWrap = document.createElement('div');
    chipsWrap.className = 'pp-pop-multi-chips';

    multiTargets.forEach(function (target) {
      var chip = document.createElement('span');
      chip.className = 'pp-multi-chip';
      chip.title = getTargetDescription(target);

      // Single label matches the eyedropper reference-chip pattern: "type"
      // alone when the element has no visible text, "type: snippet" when it
      // does (snippet ellipsized to keep chips compact across many rows).
      var labelSpan = document.createElement('span');
      labelSpan.className = 'pp-multi-chip-label';
      var typeText = target.type || 'element';
      var raw = (target.el && (target.el.innerText || target.el.textContent) || '').trim();
      var snippet = raw && raw.length > 24 ? raw.slice(0, 24) + '…' : raw;
      labelSpan.textContent = snippet ? typeText + ': ' + snippet : typeText;
      chip.appendChild(labelSpan);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'pp-multi-chip-remove';
      remove.title = 'Remove from selection';
      remove.setAttribute('aria-label', 'Remove from selection');
      remove.innerHTML = '&times;';
      remove.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
      remove.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        // Snapshot the editor before the rebuild so chip removal doesn't
        // wipe the comment text. The new popover replays parts/refs via
        // its createCommentEditor call.
        var nextCarried = serializeEditor(input);
        removeFromMultiSelect(target);
        if (multiTargets.length === 0) {
          clearDraft();
          hidePopover();
          hideTargetHighlight();
          hideOverlay();
        } else {
          showMultiPopover(nextCarried);
        }
      });
      chip.appendChild(remove);

      chipsWrap.appendChild(chip);
    });

    header.appendChild(chipsWrap);
    pop.appendChild(header);

    var newRow = document.createElement('div');
    newRow.className = 'pp-new-comment-row';

    var newBadgeWrap = document.createElement('div');
    newBadgeWrap.className = 'pp-comment-badge-wrap pp-new-comment-badge-wrap pp-comment-badge-wrap-hidden';
    var newBadge = document.createElement('span');
    newBadge.className = 'pp-comment-badge';
    newBadgeWrap.appendChild(newBadge);
    newRow.appendChild(newBadgeWrap);

    var shell = document.createElement('div');
    shell.className = 'pp-input-shell pp-comment-shell pp-input-shell-new';

    var editorRow = document.createElement('div');
    editorRow.className = 'pp-comment-editor-row pp-new-comment-editor-row';

    var input = createCommentEditor({
      label: 'New comment',
      placeholder: 'Describe what should change on all selected items',
      onChange: sync,
      comment: carried ? carried.comment || '' : '',
      references: carried ? carried.refs || [] : [],
      parts: carried ? carried.parts || [] : [],
    });
    editorRow.appendChild(input);
    shell.appendChild(editorRow);

    var btnRow = document.createElement('div');
    btnRow.className = 'pp-pop-btns';

    var refBtn = document.createElement('button');
    refBtn.className = 'pp-pop-btn pp-ref-picker';
    refBtn.title = 'Reference element';
    refBtn.setAttribute('aria-label', 'Reference element');
    refBtn.innerHTML = ico.eyedropper;
    refBtn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      saveEditorRange(input);
    });
    refBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      referencePicking = !referencePicking;
      if (referencePicking) {
        saveEditorRange(input);
        referenceEditor = { editor: input, button: refBtn };
        refBtn.classList.add('pp-ref-active');
        input.focus();
        hideTargetHighlight();
        hideOverlay();
      } else {
        stopReferencePicking();
      }
    });
    btnRow.appendChild(refBtn);

    var submit = document.createElement('button');
    submit.className = 'pp-pop-btn pp-pop-submit';
    submit.title = 'Add to all selected';
    submit.setAttribute('aria-label', 'Add to all selected');
    submit.innerHTML = ico.arrowUp;
    submit.disabled = true;

    function sync() {
      var data = serializeEditor(input);
      var on = data.comment.trim().length > 0 || data.refs.length > 0;
      submit.classList.toggle('pp-submit-on', on);
      submit.disabled = !on;
    }
    // Persist a multi-mode draft on every keystroke. The targets list is
    // serialized via their selectors so a page reload can re-query the
    // elements and rebuild the popover.
    function snapshotDraft() {
      var data = serializeEditor(input);
      if (!data.comment.trim() && data.refs.length === 0) {
        clearDraft();
        return;
      }
      saveDraft({
        mode: 'multi',
        targets: multiTargets.map(serializeTargetForDraft).filter(Boolean),
        comment: data.comment,
        parts: data.parts,
        references: data.refs,
      });
    }
    sync();
    // Carried content from a previous render or a draft restore should
    // produce one immediate snapshot so the saved draft reflects the
    // freshly-rebuilt state (e.g. new chip count after a removal).
    if (carried) snapshotDraft();
    input.addEventListener('input', function () {
      sync();
      saveEditorRange(input);
      snapshotDraft();
    });
    input.addEventListener('keyup', function () { saveEditorRange(input); });
    input.addEventListener('mouseup', function () { saveEditorRange(input); });
    input.addEventListener('click', function () { saveEditorRange(input); });

    submit.addEventListener('click', function (e) {
      e.stopPropagation();
      commit();
    });
    btnRow.appendChild(submit);
    shell.appendChild(btnRow);
    newRow.appendChild(shell);
    pop.appendChild(newRow);

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        clearDraft();
        clearMultiSelect();
        hidePopover();
        hideTargetHighlight();
        hideOverlay();
        if (commenting) stopCommenting();
        return;
      }
      saveEditorRange(input);
      e.stopPropagation();
    });

    function commit() {
      var data = serializeEditor(input);
      if (!data.comment && data.refs.length === 0) return;
      // Each annotation gets its own copy of refs/parts with freshly-stamped
      // reference ids — without that, markdown export's <ref:N> resolver
      // would cross-link references between sibling annotations.
      var targets = multiTargets.slice();
      targets.forEach(function (target) {
        var refs = data.refs.map(function (r) {
          return {
            id: makeReferenceId(),
            selector: r.selector,
            type: r.type,
            label: r.label,
            html: r.html,
            text: r.text,
            context: r.context,
          };
        });
        var parts = data.parts.map(function (p) {
          if (p.type === 'ref') {
            var idx = data.refs.findIndex(function (r) { return r.id === p.id; });
            return { type: 'ref', id: idx >= 0 ? refs[idx].id : p.id };
          }
          return { type: 'text', text: p.text };
        });
        addAnnotation(target, data.comment, refs, parts);
      });
      clearDraft();
      clearMultiSelect();
      hidePopover();
      hideTargetHighlight();
      hideOverlay();
    }

    root.appendChild(pop);
    popover = pop;
    positionPop(null, pop);
    requestAnimationFrame(function () {
      if (popover === pop && popoverIsMulti) positionPop(null, pop);
    });
    observePopoverSize(pop, null);
    requestAnimationFrame(function () { input.focus(); });
  }

  function showOrphanPopover(ann) {
    hidePopover();
    popoverTarget = null;
    editingAnn = ann;

    var pop = document.createElement('div');
    pop.className = 'pp-popover pp-popover-orphan';

    var header = document.createElement('div');
    header.className = 'pp-orphan-header';

    var badge = document.createElement('span');
    badge.className = 'pp-comment-badge pp-badge-orphan';
    badge.textContent = ann.id;
    header.appendChild(badge);

    var label = document.createElement('span');
    label.className = 'pp-orphan-label';
    label.textContent = 'Element not found';
    header.appendChild(label);

    var del = document.createElement('button');
    del.className = 'pp-pop-btn pp-pop-delete';
    del.title = 'Delete';
    del.setAttribute('aria-label', 'Delete');
    del.innerHTML = ico.trashSm;
    del.addEventListener('click', function (e) {
      e.stopPropagation();
      // Remove every note sharing this orphaned element together — they were
      // all attached to the same DOM target.
      var siblings = annotations.filter(function (a) { return a.key === ann.key; });
      siblings.forEach(function (s) { deleteAnnotation(s); });
      hidePopover();
    });
    header.appendChild(del);
    pop.appendChild(header);

    // Multi-note orphans show every comment so the user can recover context
    // before deleting.
    var orphanNotes = annotations.filter(function (a) { return a.key === ann.key && a.comment; });
    if (orphanNotes.length === 0 && ann.comment) orphanNotes = [ann];
    orphanNotes.forEach(function (n) {
      var commentEl = document.createElement('p');
      commentEl.className = 'pp-orphan-comment';
      commentEl.textContent = n.comment;
      pop.appendChild(commentEl);
    });

    var selectorEl = document.createElement('div');
    selectorEl.className = 'pp-orphan-selector';
    selectorEl.textContent = ann.selector;
    pop.appendChild(selectorEl);

    root.appendChild(pop);
    popover = pop;

    // Position near the orphan pin
    var pinR = ann.pinEl.getBoundingClientRect();
    pop.style.top = Math.min(pinR.bottom + 8, window.innerHeight - 120) + 'px';
    pop.style.left = Math.max(8, pinR.left) + 'px';
    showNavPill(ann);
  }

  /* ── floating annotation navigator ────────────────────── */
  function showNavPill(ann) {
    if (getUniqueAnnotations().length <= 1) { hideNavPill(); return; }
    clearTimeout(navHideTimer);
    navPill.classList.remove('pp-pill-out', 'pp-hidden');
    navCurrentId = ann.id;
    updateNavPillLabel();
    void navPill.offsetWidth;
    navPill.classList.add('pp-pill-in');
    navPillActive = true;
  }

  function hideNavPill() {
    if (!navPillActive) return;
    navPill.classList.remove('pp-pill-in');
    navPill.classList.add('pp-pill-out');
    navHideTimer = setTimeout(function () {
      navPill.classList.add('pp-hidden');
      navPill.classList.remove('pp-pill-out');
      navPillActive = false;
      navCurrentId = null;
    }, 160);
  }

  function updateNavPillLabel() {
    if (navCurrentId === null) return;
    var uniqueAnns = getUniqueAnnotations();
    var idx = -1;
    for (var i = 0; i < uniqueAnns.length; i++) {
      if (uniqueAnns[i].id === navCurrentId) { idx = i; break; }
    }
    if (idx === -1) { hideNavPill(); return; }
    navLabel.textContent = (idx + 1) + ' / ' + uniqueAnns.length;
  }

  function navPillTo(ann) {
    if (!ann) return;
    navCurrentId = ann.id;
    updateNavPillLabel();

    if (ann.orphaned) {
      showOrphanPopover(ann);
      return;
    }

    var target = getTargetFromAnnotation(ann);
    if (!target) return;

    var r = getTargetAnchorRect(target);
    var inView = r && r.bottom > 0 && r.top < window.innerHeight;
    if (inView) {
      showTargetHighlight(target);
      showPopover(target, ann);
    } else {
      scrollAnnotationIntoView(ann, function () {
        var liveTarget = getTargetFromAnnotation(ann);
        if (!liveTarget) {
          if (ann.orphaned) showOrphanPopover(ann);
          return;
        }
        showTargetHighlight(liveTarget);
        showPopover(liveTarget, ann);
      });
    }
  }

  function positionPop(target, pop) {
    // In multi-mode the popover anchors against the union bounding box of all
    // selected targets — a single shared rect that doesn't jitter as the user
    // toggles individual targets in and out.
    var anchor = (target == null && popoverIsMulti)
      ? getMultiAnchorRect()
      : getTargetAnchorRect(target);
    if (!anchor) return;

    var margin = 8;
    var gap = 12;
    var viewportH = window.innerHeight;
    var viewportW = window.innerWidth;

    // Reserve the toolbar's footprint so the popover never slips underneath
    // (toolbar's z-index is higher and would clip the popover content).
    var toolbarBlock = MAIN_OFFSET + TOOLBAR_HEIGHT + STACK_GAP;
    var topBound = margin;
    var bottomBound = viewportH - margin;
    if (toolbarPosition.indexOf('top-') === 0) topBound = toolbarBlock;
    else bottomBound = viewportH - toolbarBlock;

    // Allow the popover up to the full available viewport. The popover
    // should only scroll when its content genuinely can't fit anywhere on
    // screen — not when it merely doesn't fit on the chosen side of the
    // anchor. The placement step below will move it around the anchor.
    var availableViewport = Math.max(120, bottomBound - topBound);
    pop.style.maxHeight = availableViewport + 'px';

    // Force layout, then read layout-based dimensions. offsetHeight/Width
    // ignore the pop-in animation's transform (scale 0.98), so they
    // measure the popover at its true rendered size — getBoundingClientRect
    // would read ~2% short while the animation is in flight.
    void pop.offsetHeight;
    var popWidth = pop.offsetWidth || 312;
    var popHeight = Math.max(pop.scrollHeight, pop.offsetHeight) || 180;

    var spaceBelow = bottomBound - anchor.bottom - gap;
    var spaceAbove = anchor.top - topBound - gap;

    var top;
    if (popHeight <= spaceBelow) {
      // Preferred: directly below the anchor.
      top = anchor.bottom + gap;
    } else if (popHeight <= spaceAbove) {
      // Fall back: above the anchor.
      top = anchor.top - popHeight - gap;
    } else {
      // Doesn't fit cleanly on either side — sit against the bound with
      // more breathing room and let it overlap the anchor. Because
      // maxHeight is the full viewport (not just one side), this still
      // avoids a scrollbar as long as the natural content fits the screen.
      top = spaceBelow >= spaceAbove ? bottomBound - popHeight : topBound;
    }
    // Clamp inside the toolbar-respecting viewport.
    top = Math.max(topBound, Math.min(top, bottomBound - popHeight));

    // Center on the visible anchor, but clamp into the viewport so the
    // popover never lands jammed against an edge.
    var anchorCenterX = anchor.left + anchor.width / 2;
    var left = anchorCenterX - popWidth / 2;
    left = Math.max(margin, Math.min(left, viewportW - popWidth - margin));

    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    pop.style.bottom = 'auto';
  }

  /* ── annotations & pins ────────────────────────────────── */
  function addAnnotation(target, comment, references, parts) {
    target = prepareTarget(target);
    // Replies to a target that already has notes inherit the target's id —
    // multiple notes on the same DOM count as one annotation in the UI.
    var existing = getAnnotationsForTarget(target);
    var assignedId = existing.length > 0 ? existing[0].id : nextId++;
    var ann = {
      id: assignedId,
      key: target.key,
      kind: target.kind,
      el: target.el || null,
      range: target.kind === 'text' ? target.range : null,
      selector: target.selector,
      type: target.kind === 'element' ? target.type : 'text',
      quote: target.quote || '',
      textStart: target.kind === 'text' ? target.textStart : null,
      textEnd: target.kind === 'text' ? target.textEnd : null,
      comment: comment,
      references: sanitizeReferences(references || []),
      parts: parts || null,
      pinEl: null,
    };
    annotations.push(ann);
    createPin(ann);
    persist();
    updateCount();
  }

  // Removes a single note. The caller passes the actual annotation reference
  // because ids are no longer unique — multiple notes on the same target
  // share an id, so id alone can't identify which entry to drop.
  function deleteAnnotation(ann) {
    var idx = annotations.indexOf(ann);
    if (idx === -1) return;

    var siblings = annotations.filter(function (a) {
      return a !== ann && a.key === ann.key;
    });

    annotations.splice(idx, 1);

    // Other notes for this target survive — keep pin and id intact.
    if (siblings.length > 0) {
      persist();
      updateCount();
      return;
    }

    // Last note for the target. Drop the pin and renumber higher ids down.
    if (ann.pinEl) ann.pinEl.remove();
    renumber();
    persist();
    updateCount();

    if (navPillActive) {
      var uniqueAnns = getUniqueAnnotations();
      if (uniqueAnns.length <= 1) {
        hideNavPill();
      } else {
        var stillExists = uniqueAnns.some(function (a) { return a.id === navCurrentId; });
        if (!stillExists) navCurrentId = uniqueAnns[0].id;
        updateNavPillLabel();
      }
    }
  }

  function renumber() {
    // Annotations targeting the same DOM (same key) share a single id. Walk
    // in order; first occurrence of each key claims the next id, siblings
    // inherit it. Pins are shared too — only update each pin once.
    var keyToId = {};
    var seenKeys = {};
    var nextNum = 1;

    for (var i = 0; i < annotations.length; i++) {
      var a = annotations[i];
      if (!(a.key in keyToId)) keyToId[a.key] = nextNum++;
      a.id = keyToId[a.key];
    }

    for (var j = 0; j < annotations.length; j++) {
      var ann = annotations[j];
      if (seenKeys[ann.key]) continue;
      seenKeys[ann.key] = true;
      if (ann.pinEl) {
        var numEl = ann.pinEl.querySelector('.pp-pin-num');
        if (numEl) numEl.textContent = ann.id;
        else ann.pinEl.textContent = ann.id;
        ann.pinEl.setAttribute('aria-label', 'Annotation ' + ann.id);
        ann.pinEl.classList.toggle('pp-pin-sm', ann.id >= 10 && ann.id < 100);
        ann.pinEl.classList.toggle('pp-pin-xs', ann.id >= 100);
      }
    }

    nextId = nextNum;
  }

  function deleteAll() {
    if (annotations.length === 0) { shakeBtn(btnDelete); return; }
    var count = getUniqueAnnotations().length;
    hidePopover();
    hideTargetHighlight();
    hideOverlay();
    saveUndoState();
    // Pins are shared across same-target notes — dedupe so we don't try
    // to remove the same DOM node twice.
    var removed = {};
    annotations.forEach(function (a) {
      if (a.pinEl && !removed[a.key]) {
        removed[a.key] = true;
        a.pinEl.remove();
      }
    });
    annotations = [];
    nextId = 1;
    persist();
    updateCount();
    showToast(count + ' annotation' + (count !== 1 ? 's' : '') + ' deleted');
  }

  function syncOrphanPinState(ann) {
    if (!ann || !ann.pinEl) return;
    ann.pinEl.classList.toggle('pp-pin-orphaned', !!ann.orphaned);
    ann.pinEl.title = ann.orphaned ? 'Element not found' : '';
    if (!ann.orphaned) adaptPinTheme(ann);
  }

  function markAnnotationOrphaned(ann) {
    if (!ann) return;
    // All notes targeting the same element become orphaned together — they
    // share an el, so once it's gone, every sibling is gone too.
    var siblings = annotations.filter(function (a) { return a.key === ann.key; });
    var changed = false;
    siblings.forEach(function (s) {
      if (s.orphaned) return;
      s.orphaned = true;
      s.el = null;
      s.range = null;
      changed = true;
    });
    if (!changed) return;
    syncOrphanPinState(ann);
    positionPin(ann);
    persist();
  }

  function createPin(ann) {
    // One pin per target. If another annotation already has a pin for the same
    // key (multi-note annotation), reuse it so users see a single pin on screen.
    var sibling = annotations.find(function (a) {
      return a !== ann && a.key === ann.key && a.pinEl;
    });
    if (sibling) {
      ann.pinEl = sibling.pinEl;
      syncOrphanPinState(ann);
      return;
    }

    var pin = document.createElement('div');
    pin.className = 'pp-pin';
    pin.setAttribute('role', 'button');
    pin.setAttribute('tabindex', '0');
    pin.setAttribute('aria-label', 'Annotation ' + ann.id);
    pin.dataset.annKey = ann.key;
    if (ann.id >= 100) pin.classList.add('pp-pin-xs');
    else if (ann.id >= 10) pin.classList.add('pp-pin-sm');
    pin.innerHTML =
      '<span class="pp-pin-num">' + ann.id + '</span>' +
      '<span class="pp-pin-icon" aria-hidden="true">' + ico.pencilPin + '</span>';

    pinLayer.appendChild(pin);
    ann.pinEl = pin;
    syncOrphanPinState(ann);
    positionPin(ann);

    // Closures capture `ann` directly. With shared pins, that ann may be
    // deleted while siblings remain; look up a live annotation by key when
    // handlers fire so we always operate on something that exists.
    function liveAnn() {
      return annotations.find(function (a) { return a.key === pin.dataset.annKey; }) || ann;
    }

    pin.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pin.click();
      }
    });

    pin.addEventListener('mouseenter', function () { showPinTip(liveAnn()); });
    pin.addEventListener('mouseleave', function () { hidePinTip(); });
    pin.addEventListener('focus', function () { showPinTip(liveAnn()); });
    pin.addEventListener('blur', function () { hidePinTip(); });

    pin.addEventListener('click', function (e) {
      e.stopPropagation();
      var current = liveAnn();
      if (!current) return;

      if (current.orphaned) {
        showOrphanPopover(current);
        return;
      }

      var target = getTargetFromAnnotation(current);
      if (!target) return;

      var r = getTargetAnchorRect(target);
      var inView = r && r.bottom > 0 && r.top < window.innerHeight;

      if (inView) {
        showTargetHighlight(target);
        showPopover(target, current);
      } else {
        scrollAnnotationIntoView(current, function () {
          var liveTarget = getTargetFromAnnotation(current);
          if (!liveTarget) {
            if (current.orphaned) showOrphanPopover(current);
            return;
          }
          showTargetHighlight(liveTarget);
          showPopover(liveTarget, current);
        });
      }
    });
  }

  /* ── pin hover tooltip ─────────────────────────────────── */
  function getPinTipPreview(ann) {
    if (!ann) return '';
    // Aggregate all notes for this target (they share ann.key).
    var notes = annotations.filter(function (a) { return a.key === ann.key; });
    if (!notes.length) notes = [ann];
    var parts = [];
    notes.forEach(function (a) {
      var c = normalizeQuote(a.comment || '');
      if (!c) return;
      if (c.length > 70) c = c.slice(0, 70) + '…';
      parts.push(c);
    });
    return parts.join('  •  ');
  }

  function showPinTip(ann) {
    if (!ann || !ann.pinEl) return;
    var preview = getPinTipPreview(ann);
    if (!preview) { hidePinTip(); return; }
    pinTip.textContent = preview;
    // Reveal first so we can measure, then position before the next paint.
    pinTip.classList.add('pp-on');
    positionPinTip(ann);
  }

  function hidePinTip() {
    pinTip.classList.remove('pp-on');
  }

  function positionPinTip(ann) {
    if (!ann || !ann.pinEl) return;
    var pinR = ann.pinEl.getBoundingClientRect();
    var tipW = pinTip.offsetWidth || 240;
    var tipH = pinTip.offsetHeight || 36;
    // Prefer above the pin; fall back below if it would clip the top.
    var top = pinR.top - tipH - 8;
    if (top < 8) top = pinR.bottom + 8;
    var left = pinR.left + pinR.width / 2 - tipW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
    pinTip.style.top = top + 'px';
    pinTip.style.left = left + 'px';
  }

  function positionPin(ann) {
    if (ann.orphaned) {
      // Stack orphan pins by unique key — siblings sharing a pin shouldn't each
      // claim a slot, and shared pins must land at the same offset every refresh.
      var orphanIndex = 0;
      var seenKeys = {};
      for (var oi = 0; oi < annotations.length; oi++) {
        var other = annotations[oi];
        if (other.key === ann.key) break;
        if (other.orphaned && !seenKeys[other.key]) {
          seenKeys[other.key] = true;
          orphanIndex++;
        }
      }
      ann.pinEl.style.display = 'flex';
      ann.pinEl.style.top = (8 + orphanIndex * 30) + 'px';
      ann.pinEl.style.left = '8px';
      return;
    }
    var target = getTargetFromAnnotation(ann);
    var anchor = getTargetAnchorRect(target);
    var inView = anchor && anchor.bottom > 0 && anchor.top < window.innerHeight &&
                 anchor.right > 0 && anchor.left < window.innerWidth;
    ann.pinEl.style.display = inView ? 'flex' : 'none';
    if (inView) {
      var top = Math.max(4, Math.min(anchor.top - 12, window.innerHeight - 32));
      var left = Math.max(4, Math.min(anchor.right - 12, window.innerWidth - 32));
      ann.pinEl.style.top = top + 'px';
      ann.pinEl.style.left = left + 'px';
    }
  }

  function refreshAll() {
    pruneMissingReferences();
    annotations.forEach(positionPin);
    // Hide pin tip on scroll/resize — pin may have moved or scrolled offscreen.
    hidePinTip();
    // Locked highlights on selected targets need to track scroll/resize the
    // same way pins do — same tick, same getTargetAnchorRect math.
    if (multiTargets.length) refreshMultiHighlights();
    if (popover && popoverIsMulti) {
      positionPop(null, popover);
    } else if (popover && popoverTarget) {
      positionPop(popoverTarget, popover);
      showTargetHighlight(popoverTarget);
    } else if (commenting && pointerInWindow && lastMouseX >= 0) {
      var el = document.elementFromPoint(lastMouseX, lastMouseY);
      if (isHoverHighlightable(el)) {
        hovered = el;
        showOverlay(el);
      } else {
        hideOverlay();
        hideTargetHighlight();
      }
    } else if (commenting && !pointerInWindow) {
      // Cursor left the window — keep the preview clear (no stale hover).
      hideOverlay();
    }
  }

  /* ── undo system (#4) ──────────────────────────────────── */
  function saveUndoState() {
    undoData = {
      items: annotations.map(function (a) {
        return {
          id: a.id,
          key: a.key,
          kind: a.kind,
          el: a.el,
          range: a.range ? a.range.cloneRange() : null,
          selector: a.selector,
          type: a.type,
          quote: a.quote,
          textStart: a.textStart,
          textEnd: a.textEnd,
          comment: a.comment,
          references: (a.references || []).slice(),
          parts: a.parts ? a.parts.slice() : null,
          orphaned: !!a.orphaned,
        };
      }),
      nextId: nextId,
    };
    btnDelete.innerHTML = ico.undo;
    btnDelete.classList.add('pp-undo-btn');
    btnDelete.setAttribute('data-tip', 'Undo');
    btnDelete.setAttribute('data-keys', 'Z');
    btnDelete.setAttribute('aria-label', 'Undo');
    clearTimeout(undoTimer);
    undoTimer = setTimeout(clearUndoState, 5000);
  }

  function clearUndoState() {
    undoData = null;
    clearTimeout(undoTimer);
    undoTimer = null;
    btnDelete.innerHTML = ico.trash;
    btnDelete.classList.remove('pp-undo-btn');
    btnDelete.setAttribute('data-tip', 'Delete all');
    btnDelete.setAttribute('data-keys', 'X,X,X');
    btnDelete.setAttribute('aria-label', 'Delete all');
  }

  function undo() {
    if (!undoData) return;
    var items = undoData.items;
    var savedNextId = undoData.nextId;
    clearUndoState();
    items.forEach(function (item) {
      var hasElementTarget = item.el && item.el.isConnected;

      if (!hasElementTarget) {
        // Restore orphaned annotations too
        if (item.selector) {
          var orphan = {
            id: item.id, key: item.key, kind: item.kind, el: null,
            range: null, selector: item.selector,
            type: item.type, quote: item.quote, textStart: item.textStart, textEnd: item.textEnd,
            comment: item.comment, pinEl: null,
            references: sanitizeReferences(item.references || []), parts: item.parts || null,
            orphaned: true,
          };
          annotations.push(orphan);
          createPin(orphan);
        }
        return;
      }
      var ann = {
        id: item.id,
        key: item.key,
        kind: item.kind,
        el: item.el,
        range: item.range || null,
        selector: item.selector,
        type: item.type,
        quote: item.quote,
        textStart: item.textStart,
        textEnd: item.textEnd,
        comment: item.comment,
        references: sanitizeReferences(item.references || []),
        parts: item.parts || null,
        pinEl: null,
      };
      annotations.push(ann);
      createPin(ann);
    });
    nextId = savedNextId;
    persist();
    updateCount();
  }

  /* ── menu panel toggle ─────────────────────────────────── */
  function showMenu() {
    menuPanel.style.width = Math.max(bar.offsetWidth, 280) + 'px';
    menuPanel.classList.remove('pp-hidden');
    btnShortcuts.classList.add('pp-sc-open');
  }

  function hideMenu() {
    menuPanel.classList.add('pp-hidden');
    btnShortcuts.classList.remove('pp-sc-open');
  }

  function toggleMenu() {
    if (menuPanel.classList.contains('pp-hidden')) showMenu();
    else hideMenu();
  }

  /* ── keyboard navigation ────────────────────────────────── */
  var NAV_SELECTOR = 'a, button, input, select, textarea, img, video, audio, ' +
      'h1, h2, h3, h4, h5, h6, li, p, figure, blockquote, pre, ' +
      'header, nav, main, aside, footer, section, article, form, table, ' +
      '[role], [id]:not(script):not(style):not(link)';

  function getNavigableElements() {
    if (!navElemsDirty && navElemsCache !== null) return navElemsCache;
    var all = document.querySelectorAll(NAV_SELECTOR);
    var result = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (isOurUI(el) || isSkippable(el)) continue;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') continue;
      var r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      if (r.right < 0 || r.left > window.innerWidth) continue;
      result.push(el);
    }
    navElemsCache = result;
    navElemsDirty = false;
    return result;
  }

  function getInitialElement() {
    var cx = window.innerWidth / 2;
    var cy = window.innerHeight / 2;
    var elems = getNavigableElements();
    var best = null, bestDist = Infinity;
    for (var i = 0; i < elems.length; i++) {
      var r = elems[i].getBoundingClientRect();
      var dx = r.left + r.width / 2 - cx;
      var dy = r.top + r.height / 2 - cy;
      var d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = elems[i]; }
    }
    return best;
  }

  function isFixedOrSticky(el) {
    try {
      var pos = getComputedStyle(el).position;
      return pos === 'fixed' || pos === 'sticky';
    } catch (e) { return false; }
  }

  function findNearest(from, direction) {
    var fr = from.getBoundingClientRect();
    var fcx = fr.left + fr.width / 2;
    var fcy = fr.top + fr.height / 2;
    var fromFixed = isFixedOrSticky(from);
    var elems = getNavigableElements();
    var best = null, bestScore = Infinity;

    for (var i = 0; i < elems.length; i++) {
      var el = elems[i];
      if (el === from || from.contains(el)) continue;

      // Skip fixed/sticky elements when navigating from non-fixed content
      // (prevents getting stuck on fixed headers/navs)
      if (!fromFixed && isFixedOrSticky(el)) continue;

      var r = el.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dx = cx - fcx, dy = cy - fcy;

      switch (direction) {
        case 'up':    if (dy >= -2) continue; break;
        case 'down':  if (dy <= 2) continue; break;
        case 'left':  if (dx >= -2) continue; break;
        case 'right': if (dx <= 2) continue; break;
      }

      var score = (direction === 'up' || direction === 'down')
        ? Math.abs(dy) + Math.abs(dx) * 2.5
        : Math.abs(dx) + Math.abs(dy) * 2.5;

      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  function cycleElement(forward) {
    var all = getNavigableElements();
    if (all.length === 0) return null;
    var cur = hovered;
    if (!cur) return all[0];
    var idx = all.indexOf(cur);
    if (idx === -1) return all[0];
    return forward ? all[(idx + 1) % all.length] : all[(idx - 1 + all.length) % all.length];
  }

  function selectParent(el) {
    var p = el.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      if (!isOurUI(p) && !isSkippable(p)) {
        var r = p.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return p;
      }
      p = p.parentElement;
    }
    return null;
  }

  function selectChild(el) {
    // Try direct visible children first
    var visible = [];
    for (var i = 0; i < el.children.length; i++) {
      var child = el.children[i];
      if (isOurUI(child) || child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') continue;
      var r = child.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) visible.push(child);
    }
    if (visible.length === 0) return null;
    // If only one visible child that fills the parent, skip into it recursively
    if (visible.length === 1) {
      var pr = el.getBoundingClientRect();
      var cr = visible[0].getBoundingClientRect();
      var fills = Math.abs(cr.width - pr.width) < 4 && Math.abs(cr.height - pr.height) < 4;
      if (fills) {
        var deeper = selectChild(visible[0]);
        return deeper || visible[0];
      }
    }
    return visible[0];
  }

  function scrollIntoViewIfNeeded(el) {
    var r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function keyNavTo(el) {
    if (!el) return;
    hovered = el;
    showOverlay(el);
    scrollIntoViewIfNeeded(el);
  }

  /* ── element snapshots for export ────────────────────────── */
  // Identity/intent attrs first; class is added last so truncation keeps
  // the useful bits when Tailwind class lists blow past the length budget.
  var IDENTITY_ATTRS = [
    'id', 'role', 'aria-label', 'aria-labelledby', 'aria-describedby',
    'name', 'type', 'alt', 'title', 'placeholder', 'href', 'src', 'poster',
    'for', 'action', 'method', 'value', 'target', 'rel', 'width', 'height',
    'data-testid', 'data-test', 'data-cy'
  ];

  // Utility-heavy classes (Tailwind etc.) bury the signal — keep a short
  // sample unless a class looks like a component/BEM name.
  var UTILITY_CLASS = /^!?(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|w|h|min-w|min-h|max-w|max-h|size|gap|space|flex|grid|col|row|order|grow|shrink|basis|items|justify|content|self|place|overflow|truncate|whitespace|break|rounded|border|ring|shadow|opacity|z|inset|top|right|bottom|left|start|end|translate|rotate|scale|skew|origin|object|bg|from|via|to|text|font|leading|tracking|align|underline|line|decoration|list|appearance|cursor|pointer|select|resize|scroll|snap|touch|accent|caret|fill|stroke|sr|not-sr|visible|invisible|collapse|static|fixed|absolute|relative|sticky|block|inline|hidden|table|flow|contents|isolate|mix|filter|backdrop|transition|duration|ease|delay|animate|will-change|aspect|columns|box|float|clear|isolation|overscroll)-|^!?(?:flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|static|truncate|sr-only|not-sr-only|container|prose|clearfix)$/;

  function isUtilityClass(cls) {
    if (!cls) return true;
    // Any Tailwind-style variant prefix (sm:, max-sm:, hover:, dark:, …).
    if (cls.indexOf(':') !== -1) return true;
    if (cls.indexOf('[') !== -1) return true; // arbitrary values
    return UTILITY_CLASS.test(cls);
  }

  function shortAttrValue(name, value) {
    if (!value) return '';
    var v = String(value).trim();
    if ((name === 'src' || name === 'href' || name === 'poster') && v.length > 80) {
      try {
        var u = new URL(v, location.href);
        var base = u.pathname.split('/').filter(Boolean).pop() || u.pathname;
        return (base.length > 60 ? base.slice(0, 60) + '\u2026' : base) + (u.search ? '?…' : '');
      } catch (e) {
        return v.length > 60 ? v.slice(0, 60) + '\u2026' : v;
      }
    }
    if (v.length > 72) return v.slice(0, 72) + '\u2026';
    return v;
  }

  function pickExportClasses(el) {
    if (!el.className || typeof el.className !== 'string') return [];
    var all = el.className.trim().split(/\s+/).filter(function (c) {
      return c && !isGeneratedClass(c);
    });
    if (!all.length) return [];
    var meaningful = all.filter(function (c) { return !isUtilityClass(c); });
    // Prefer component/BEM-ish names; fall back to a few utilities for shape.
    if (meaningful.length) return meaningful.slice(0, 6);
    return all.slice(0, 4);
  }

  function getCleanTag(el) {
    if (!el || !el.isConnected) return '';
    var tag = el.tagName.toLowerCase();
    var bits = ['<' + tag];
    var budget = 260;

    IDENTITY_ATTRS.forEach(function (name) {
      if (!el.hasAttribute(name)) return;
      var val = shortAttrValue(name, el.getAttribute(name));
      if (!val) return;
      var piece = ' ' + name + '="' + val.replace(/"/g, '&quot;') + '"';
      if ((bits.join('').length + piece.length) > budget) return;
      bits.push(piece);
    });

    var classes = pickExportClasses(el);
    if (classes.length) {
      var classStr = classes.join(' ');
      var piece = ' class="' + classStr + '"';
      // If class still overflows, keep as many as fit.
      while (classes.length > 1 && (bits.join('').length + piece.length) > budget) {
        classes.pop();
        classStr = classes.join(' ') + '\u2026';
        piece = ' class="' + classStr + '"';
      }
      if ((bits.join('').length + piece.length) <= budget + 20) bits.push(piece);
    }

    var html = bits.join('');
    if (html.length > budget) html = html.slice(0, budget) + '…';
    return html;
  }

  function getTextPreview(el) {
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > 100 ? text.slice(0, 100) + '\u2026' : text;
  }

  var SEMANTIC_TAGS = { HEADER:1, NAV:1, MAIN:1, ASIDE:1, FOOTER:1, SECTION:1, ARTICLE:1, FORM:1, DIALOG:1, FIGURE:1, TABLE:1, UL:1, OL:1 };

  function getMeaningfulClass(el) {
    if (!el.className || typeof el.className !== 'string') return '';
    var classes = el.className.trim().split(/\s+/).filter(function (c) {
      return c && !isGeneratedClass(c) && !isUtilityClass(c);
    });
    return classes[0] || '';
  }

  // One path segment for the ancestor trail — skip anonymous wrappers.
  function describeContextNode(el) {
    if (!el || !el.tagName) return '';
    var tag = el.tagName.toLowerCase();
    if (el.id && !/\s/.test(el.id)) return tag + '#' + el.id;

    var aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) {
      var short = aria.length > 36 ? aria.slice(0, 36) + '\u2026' : aria;
      return tag + '[aria-label="' + short.replace(/"/g, "'") + '"]';
    }

    var role = (el.getAttribute('role') || '').trim();
    if (role) return tag + '[role=' + role + ']';

    var testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
    if (testId) return tag + '[data-testid=' + testId + ']';

    var meaningful = getMeaningfulClass(el);
    if (meaningful) return tag + '.' + meaningful;

    if (SEMANTIC_TAGS[el.tagName]) return tag;
    // Skip pure layout wrappers (div/span without identity).
    if (tag === 'div' || tag === 'span') return '';
    return tag;
  }

  function getAncestorTrail(el) {
    var parts = [];
    var cur = el.parentElement;
    var depth = 0;
    while (cur && cur !== document.body && cur !== document.documentElement && depth < 10) {
      var label = describeContextNode(cur);
      if (label) parts.unshift(label);
      // Stop at a stable id once we already have some trail.
      if (cur.id && !/\s/.test(cur.id) && parts.length) break;
      // Cap once we have a landmark + enough path.
      if (SEMANTIC_TAGS[cur.tagName] && (cur.tagName === 'MAIN' || cur.tagName === 'HEADER' ||
          cur.tagName === 'FOOTER' || cur.tagName === 'NAV' || cur.tagName === 'ASIDE') &&
          parts.length >= 2) {
        break;
      }
      cur = cur.parentElement;
      depth++;
    }
    return parts.length ? parts.join(' > ') : '';
  }

  // Closest section heading so agents know which block the note refers to.
  function getNearbyHeading(el) {
    if (!el) return '';
    var cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      var labelledBy = cur.getAttribute && cur.getAttribute('aria-labelledby');
      if (labelledBy) {
        var labelEl = document.getElementById(labelledBy.split(/\s+/)[0]);
        if (labelEl) {
          var t = (labelEl.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) return (labelEl.tagName || 'label').toLowerCase() + ' "' +
            (t.length > 60 ? t.slice(0, 60) + '\u2026' : t) + '"';
        }
      }

      var sib = cur.previousElementSibling;
      while (sib) {
        if (/^H[1-6]$/.test(sib.tagName)) {
          var ht = (sib.textContent || '').replace(/\s+/g, ' ').trim();
          if (ht) return sib.tagName.toLowerCase() + ' "' +
            (ht.length > 60 ? ht.slice(0, 60) + '\u2026' : ht) + '"';
        }
        var nested = sib.querySelector && sib.querySelector('h1, h2, h3, h4, h5, h6');
        if (nested) {
          var nt = (nested.textContent || '').replace(/\s+/g, ' ').trim();
          if (nt) return nested.tagName.toLowerCase() + ' "' +
            (nt.length > 60 ? nt.slice(0, 60) + '\u2026' : nt) + '"';
        }
        sib = sib.previousElementSibling;
      }

      if (cur.parentElement) {
        var direct = null;
        var kids = cur.parentElement.children;
        for (var i = 0; i < kids.length; i++) {
          if (kids[i] === cur) break;
          if (/^H[1-6]$/.test(kids[i].tagName)) direct = kids[i];
        }
        if (direct) {
          var dt = (direct.textContent || '').replace(/\s+/g, ' ').trim();
          if (dt) return direct.tagName.toLowerCase() + ' "' +
            (dt.length > 60 ? dt.slice(0, 60) + '\u2026' : dt) + '"';
        }
      }

      cur = cur.parentElement;
    }
    return '';
  }

  function getExportLabel(ann) {
    return ann.kind === 'text' ? 'text selection' : (ann.type || 'element');
  }

  function quoteExportValue(value) {
    var clean = normalizeQuote(value);
    if (!clean) return '';
    return '"' + clean.replace(/"/g, '\\"') + '"';
  }

  function getReferenceSummary(ref) {
    var text = normalizeQuote(ref && ref.text);
    var type = ref && ref.type ? ref.type : 'element';
    if (!text) return type;
    return type + ' ' + quoteExportValue(text.length > 44 ? text.slice(0, 44) + '\u2026' : text);
  }

  function getInlineFeedback(ann) {
    var parts = Array.isArray(ann.parts) ? ann.parts : [];
    if (!parts.length) return normalizeQuote(ann.comment);
    var refs = sanitizeReferences(ann.references);
    var refIndex = {};
    refs.forEach(function (ref, index) {
      refIndex[ref.id] = index + 1;
    });
    var text = '';
    parts.forEach(function (part) {
      if (part.type === 'ref') {
        var ref = refs.find(function (item) { return item.id === part.id; });
        if (ref) text += '<ref:' + refIndex[ref.id] + '>';
      } else {
        text += part.text || '';
      }
    });
    return normalizeQuote(text || ann.comment);
  }

  function appendReferenceExport(lines, ann) {
    var refs = sanitizeReferences(Array.isArray(ann.references) ? ann.references : []);
    ann.references = refs;
    if (!refs.length) return;
    lines.push('   Inline references:');
    lines.push('      The <ref:n> tokens appear inside the feedback text at the exact sentence position where the user inserted each reference. Use the surrounding words to infer intent, such as matching, comparing, or borrowing style/content from that referenced element.');
    refs.forEach(function (ref, index) {
      if (!ref) return;
      lines.push('      <ref:' + (index + 1) + '> ' + getReferenceSummary(ref));
      lines.push('         Role: inline comparison/context target, not the primary annotated element');
      if (ref.selector) lines.push('         Selector: ' + ref.selector);
      if (ref.html) lines.push('         HTML snapshot: ' + ref.html);
      if (ref.text) lines.push('         Visible text: ' + quoteExportValue(ref.text));
      if (ref.context) lines.push('         Ancestor context: ' + ref.context);
    });
  }

  // Label the live viewport so agents know which breakpoint the notes
  // were written against (e.g. "680px Width (Mobile)").
  function getViewportLabel() {
    var w = window.innerWidth;
    var bucket = w < 768 ? 'Mobile' : w < 1024 ? 'Tablet' : 'Desktop';
    return w + 'px Width (' + bucket + ')';
  }

  /* ── copy ──────────────────────────────────────────────── */
  function formatMarkdown(items) {
    var source = items || annotations;

    // Group notes by id so each annotation appears once with all its
    // feedback grouped underneath. Multiple notes share a target, so the
    // HTML/text/context lines come from the first note and aren't repeated.
    var groups = [];
    var byId = {};
    source.forEach(function (ann) {
      if (!byId[ann.id]) {
        byId[ann.id] = { id: ann.id, anns: [] };
        groups.push(byId[ann.id]);
      }
      byId[ann.id].anns.push(ann);
    });

    // Feedback leads (on the number line) so multi-agent previews show the
    // human note first. URL + viewport trail at the end so they don't steal
    // the preview header.
    var lines = [];

    groups.forEach(function (group) {
      var primary = group.anns[0];
      var firstFeedback = getInlineFeedback(primary) || '';
      lines.push(primary.id + '. ' + firstFeedback);
      appendReferenceExport(lines, primary);

      // Extra notes on the same target, indented under the first.
      for (var i = 1; i < group.anns.length; i++) {
        lines.push('   ' + getInlineFeedback(group.anns[i]));
        appendReferenceExport(lines, group.anns[i]);
      }
      lines.push('   — end of feedback —');

      var html = primary.el ? getCleanTag(primary.el) : '';
      var text = primary.kind === 'text' ? primary.quote : (primary.el ? getTextPreview(primary.el) : '');
      var selector = primary.selector || (primary.el ? buildSelector(primary.el) : '');
      var context = primary.el ? getAncestorTrail(primary.el) : '';
      var near = primary.el ? getNearbyHeading(primary.el) : '';

      if (html) lines.push('   HTML: ' + html);
      if (text) lines.push('   ' + (primary.kind === 'text' ? 'Quote' : 'Text') + ': ' + quoteExportValue(text));
      if (selector) lines.push('   Selector: ' + selector);
      if (context) lines.push('   Context: ' + context);
      if (near) lines.push('   Near: ' + near);

      if (primary.orphaned) lines.push('   Status: Element not found');

      lines.push('');
    });

    lines.push('URL: ' + location.href);
    lines.push('Viewport: ' + getViewportLabel());
    return lines.join('\n').trim();
  }

  function copyAll() {
    if (annotations.length === 0) { shakeBtn(btnCopy); return; }
    // The "Clear after copy" toggle in the menu makes the plain Copy
    // action behave exactly like the Shift+A shortcut — copy, then wipe.
    if (clearAfterCopy) { copyAndClear(); return; }
    var count = getUniqueAnnotations().length;
    navigator.clipboard.writeText(formatMarkdown()).then(
      function () {
        flashBtn(btnCopy, ico.copy);
        showToast(count + ' annotation' + (count !== 1 ? 's' : '') + ' copied');
      },
      function () { shakeBtn(btnCopy); }
    );
  }

  function copyAndClear() {
    if (annotations.length === 0) { shakeBtn(btnCopy); return; }
    var count = getUniqueAnnotations().length;
    var md = formatMarkdown();
    saveUndoState();
    navigator.clipboard.writeText(md).then(function () {
      flashBtn(btnCopy, ico.copy);
      showToast(count + ' annotation' + (count !== 1 ? 's' : '') + ' copied & cleared');
      hidePopover();
      hideTargetHighlight();
      hideOverlay();
      // Pins are shared across notes for the same target — dedupe before
      // removing so we don't try to remove the same DOM node twice.
      var removed = {};
      annotations.forEach(function (a) {
        if (a.pinEl && !removed[a.key]) {
          removed[a.key] = true;
          a.pinEl.remove();
        }
      });
      annotations = [];
      nextId = 1;
      persist();
      updateCount();
    }, function () {
      shakeBtn(btnCopy);
      clearUndoState();
    });
  }

  /* ── button feedback (#2, #9) ──────────────────────────── */
  function flashBtn(btn, origIcon) {
    // Cancel any existing flash on this button
    var existing = flashTimers.get(btn);
    if (existing) {
      existing.forEach(clearTimeout);
      btn.classList.remove('pp-flash-out', 'pp-flash-in');
    }
    var orig = origIcon || btn.innerHTML;
    var timers = [];
    btn.classList.add('pp-flash-out');
    timers.push(setTimeout(function () {
      btn.innerHTML = ico.check;
      btn.classList.remove('pp-flash-out');
      btn.classList.add('pp-flash-in');
      timers.push(setTimeout(function () {
        btn.classList.add('pp-flash-out');
        timers.push(setTimeout(function () {
          btn.innerHTML = orig;
          btn.classList.remove('pp-flash-out', 'pp-flash-in');
          flashTimers.delete(btn);
        }, 150));
      }, 1500));
    }, 150));
    flashTimers.set(btn, timers);
  }

  function shakeBtn(btn) {
    btn.classList.remove('pp-shake');
    void btn.offsetWidth;
    btn.classList.add('pp-shake');
    setTimeout(function () { btn.classList.remove('pp-shake'); }, 300);
  }

  /* ── persistence ───────────────────────────────────────── */
  var LRU_MAX_KEYS = 50;
  var RESTORE_RETRY_DELAY = 350;
  var RESTORE_RETRY_MAX = 12;
  var restoreRequestId = 0;
  var restoreTimer = null;

  function buildPersistData() {
    return {
      nextId: nextId,
      _lastAccess: Date.now(),
      items: annotations.map(function (a) {
        return {
          id: a.id,
          key: a.key,
          kind: a.kind,
          selector: a.selector,
          type: a.type,
          quote: a.quote || '',
          textStart: a.textStart,
          textEnd: a.textEnd,
          comment: a.comment,
          references: a.references || [],
          parts: a.parts || null,
        };
      }),
    };
  }

  function normalizeStoredData(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch (e) { return null; }
    }
    return raw;
  }

  function clearRestoreTimer() {
    clearTimeout(restoreTimer);
    restoreTimer = null;
  }

  function scheduleRestore(attempt) {
    clearRestoreTimer();
    restoreTimer = setTimeout(function () {
      restore(attempt);
    }, RESTORE_RETRY_DELAY);
  }

  function loadStoredData(done) {
    safeStorageGet([STORE_KEY], function (result) {
      var data = normalizeStoredData(result[STORE_KEY]);
      if (data) {
        done(data);
        return;
      }

      var legacyRaw = null;
      try { legacyRaw = localStorage.getItem(STORE_KEY); } catch (e) { legacyRaw = null; }
      var legacyData = normalizeStoredData(legacyRaw);
      if (legacyData) {
        var migratePayload = {};
        migratePayload[STORE_KEY] = legacyData;
        safeStorageSet(migratePayload);
      }
      done(legacyData);
    });
  }

  function persist() {
    var data = buildPersistData();
    var payload = {};
    payload[STORE_KEY] = data;
    safeStorageSet(payload);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* blocked */ }
    pruneOldEntries();
  }

  function pruneOldEntries() {
    safeStorageGet(null, function (all) {
      var entries = [];
      Object.keys(all || {}).forEach(function (key) {
        if (key.indexOf('pinpoint:') !== 0) return;
        var parsed = normalizeStoredData(all[key]);
        var ts = parsed && parsed._lastAccess ? parsed._lastAccess : 0;
        entries.push({ key: key, ts: ts });
      });
      if (entries.length <= LRU_MAX_KEYS) return;
      entries.sort(function (a, b) { return a.ts - b.ts; });
      var removeKeys = [];
      var toRemove = entries.length - LRU_MAX_KEYS;
      for (var i = 0; i < toRemove; i++) {
        if (entries[i].key !== STORE_KEY) removeKeys.push(entries[i].key);
      }
      if (removeKeys.length) safeStorageRemove(removeKeys);
    });
  }

  function restore(attempt) {
    attempt = attempt || 0;
    clearRestoreTimer();
    var requestId = ++restoreRequestId;

    loadStoredData(function (data) {
      if (requestId !== restoreRequestId) return;
      if (!data) {
        if (annotations.length === 0) updateCount();
        tryRestoreDraft();
        return;
      }

      var orphanCount = 0;
      var droppedLegacyGroups = 0;
      var pendingItems = [];
      var restoredItems = [];
      var items = data.items || [];

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.kind === 'group') {
          droppedLegacyGroups++;
          continue;
        }

        var el = null;
        try { el = document.querySelector(item.selector); } catch (e) { el = null; }
        if (!el) {
          pendingItems.push(item);
          continue;
        }

        var ann = {
          id: item.id,
          key: item.key,
          kind: item.kind || 'element',
          el: el,
          range: null,
          selector: item.selector,
          type: item.type,
          quote: item.quote,
          textStart: item.textStart,
          textEnd: item.textEnd,
          comment: item.comment,
          references: sanitizeReferences(item.references || []),
          parts: item.parts || null,
          pinEl: null,
        };
        if (ann.kind === 'text') {
          ann.range = restoreRangeFromOffsets(el, item.textStart, item.textEnd, item.quote);
          if (!ann.range) {
            pendingItems.push(item);
            continue;
          }
        }
        ann.key = ann.key || getTargetKey({
          kind: ann.kind || 'element',
          selector: ann.selector,
          textStart: ann.textStart,
          textEnd: ann.textEnd,
        });
        restoredItems.push(ann);
      }

      if (pendingItems.length > 0 && attempt < RESTORE_RETRY_MAX) {
        scheduleRestore(attempt + 1);
        return;
      }

      nextId = data.nextId || 1;
      restoredItems.forEach(function (ann) {
        annotations.push(ann);
        createPin(ann);
      });

      pendingItems.forEach(function (item) {
        var orphan = {
          id: item.id,
          key: item.key || getTargetKey({
            kind: item.kind || 'element',
            selector: item.selector,
            textStart: item.textStart,
            textEnd: item.textEnd,
          }),
          kind: item.kind || 'element',
          el: null,
          range: null,
          selector: item.selector,
          type: item.type,
          quote: item.quote,
          textStart: item.textStart,
          textEnd: item.textEnd,
          comment: item.comment,
          references: sanitizeReferences(item.references || []),
          parts: item.parts || null,
          pinEl: null,
          orphaned: true,
        };
        annotations.push(orphan);
        createPin(orphan);
        orphanCount++;
      });

      if (annotations.length === 0) nextId = 1;
      updateCount();
      if (droppedLegacyGroups > 0) persist();
      if (orphanCount > 0) {
        setTimeout(function () {
          showToast(orphanCount + ' annotation' + (orphanCount !== 1 ? 's' : '') + ' couldn\'t find their elements');
        }, 400);
      }
      tryRestoreDraft();
    });
  }

  // Re-open the popover with whatever in-progress comment was written
  // before the page reloaded. Triggered after restore() finishes its
  // async annotation work. Bails silently when there's no recent draft,
  // when the saved targets can't be re-queried, or when the site has
  // been disabled in the meantime.
  var draftRestoreAttempted = false;
  function tryRestoreDraft() {
    if (draftRestoreAttempted) return;
    draftRestoreAttempted = true;

    loadDraft(function (draft) {
      if (!draft || !draft.mode) return;
      // Stale drafts are ignored — see DRAFT_MAX_AGE_MS rationale.
      if (!draft.savedAt || Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) {
        clearDraft();
        return;
      }
      // A popover is already on screen — don't clobber it. Keeps the
      // draft on disk so the user can close the current popover and a
      // future reload still has the draft to fall back on.
      if (popover) return;

      // Re-check site-enabled rules so an HMR refresh on a site the user
      // has since disabled doesn't pop the popover back up. Mirrors the
      // init-time site-disabled callback that hides the toggle.
      safeStorageGet(['disabledHosts', 'devOnly'], function (data) {
        var list = data.disabledHosts || [];
        var devOnly = !!data.devOnly;
        var localHtml = isLocalHtmlFile();
        var siteKey = getSiteKey();
        if (location.protocol === 'file:' && !localHtml) return;
        if (list.indexOf(siteKey) !== -1) return;
        if (localHtml && !devOnly) return;
        if (!localHtml && devOnly && !isDevHost()) return;

        if (draft.mode === 'multi') {
          var resolvedTargets = (draft.targets || [])
            .map(resolveTargetFromDraft)
            .filter(Boolean);
          if (resolvedTargets.length === 0) {
            clearDraft();
            return;
          }
          if (!active) activate();
          else if (!commenting) startCommenting();
          clearMultiSelect();
          resolvedTargets.forEach(addToMultiSelect);
          // showMultiPopover() reads multiTargets and rebuilds — feeding
          // it the saved comment/parts/refs via the `carried` arg restores
          // the editor content as if the popover had never closed.
          showMultiPopover({
            comment: draft.comment || '',
            parts: draft.parts || [],
            refs: draft.references || [],
          });
          return;
        }

        var target = resolveTargetFromDraft(draft.target);
        if (!target) {
          clearDraft();
          return;
        }
        if (!active) activate();
        else if (!commenting) startCommenting();
        showTargetHighlight(target);
        showPopover(target, null, {
          comment: draft.comment || '',
          parts: draft.parts || [],
          references: draft.references || [],
        });
      });
    });
  }

  /* ── selector builder (#12 — filter generated classes) ─── */
  // Heuristic for detecting CSS-in-JS / build-tool generated class names.
  // Pattern 1: CSS-in-JS runtime prefixes (styled-components 'sc-', emotion 'css-', MUI 'makeStyles-', etc.)
  //   False-positive risk: hand-written classes starting with these prefixes (e.g. 'css-header').
  // Pattern 2: Short prefix + hex hash (webpack/Next.js atomic CSS, e.g. 'ab1f2e3c4')
  //   False-positive risk: short semantic class names that are mostly hex chars.
  // Pattern 3: Underscore-prefixed minified identifiers (SvelteKit, Astro, e.g. '_a1b2c3d4')
  //   False-positive risk: deliberate underscore-prefixed utility classes.
  function isGeneratedClass(cls) {
    return /^(css|sc|emotion|styled|jss|makeStyles|_)-?/.test(cls) ||
           /^[a-zA-Z]{1,3}[0-9a-f]{5,}$/.test(cls) ||
           /^_[a-zA-Z0-9]{6,}$/.test(cls);
  }

  function buildSelector(el) {
    if (el.id && !/\s/.test(el.id)) {
      var idSel = '#' + cssEsc(el.id);
      try {
        if (document.querySelectorAll(idSel).length === 1) return idSel;
      } catch (e) { /* */ }
    }

    if (el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\s+/).filter(function (c) {
        return c && !isGeneratedClass(c);
      });
      if (cls.length) {
        var sel = el.tagName.toLowerCase() + '.' + cls.map(cssEsc).join('.');
        try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) { /* */ }
      }
    }

    var path = [], cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      var seg = cur.tagName.toLowerCase();
      if (cur.id && !/\s/.test(cur.id)) {
        var curIdSel = '#' + cssEsc(cur.id);
        try {
          if (document.querySelectorAll(curIdSel).length === 1) {
            path.unshift(curIdSel);
            break;
          }
        } catch (e) { /* */ }
      }
      var parent = cur.parentElement;
      if (parent) {
        var sibs = Array.from(parent.children).filter(function (s) { return s.tagName === cur.tagName; });
        if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      path.unshift(seg);
      cur = cur.parentElement;
    }
    return path.join(' > ');
  }

  function cssEsc(s) {
    return CSS && CSS.escape ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1');
  }

  /* ── pin contrast adaptation ───────────────────────────── */
  function getEffectiveBgColor(el) {
    var cur = el;
    while (cur && cur !== document.documentElement) {
      var bg = getComputedStyle(cur).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      cur = cur.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }

  function parseRgb(str) {
    var m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3] } : { r: 255, g: 255, b: 255 };
  }

  function srgbLuminance(r, g, b) {
    var rs = r / 255, gs = g / 255, bs = b / 255;
    rs = rs <= 0.03928 ? rs / 12.92 : Math.pow((rs + 0.055) / 1.055, 2.4);
    gs = gs <= 0.03928 ? gs / 12.92 : Math.pow((gs + 0.055) / 1.055, 2.4);
    bs = bs <= 0.03928 ? bs / 12.92 : Math.pow((bs + 0.055) / 1.055, 2.4);
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function adaptPinTheme(ann) {
    if (!ann.el || !ann.el.isConnected || !ann.pinEl) return;
    var rgb = parseRgb(getEffectiveBgColor(ann.el));
    var lum = srgbLuminance(rgb.r, rgb.g, rgb.b);

    // Distance to the Agimut accent orange (#e85102 = 232,81,2)
    var dr = rgb.r - 232, dg = rgb.g - 81, db = rgb.b - 2;
    var orangeDist = Math.sqrt(dr * dr + dg * dg + db * db);

    ann.pinEl.classList.remove('pp-pin-light', 'pp-pin-alt');
    if (orangeDist < 110) {
      ann.pinEl.classList.add('pp-pin-alt');
    } else if (lum > 0.45) {
      ann.pinEl.classList.add('pp-pin-light');
    }
  }

  /* ── helpers ───────────────────────────────────────────── */
  function typeName(el) { return TAG[el.tagName] || el.tagName.toLowerCase(); }

  function inputFocused() {
    var t = document.activeElement && document.activeElement.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' ||
           (document.activeElement && document.activeElement.isContentEditable);
  }

  function isOurUI(el) { return root.contains(el); }

  function isSkippable(el) {
    return !el || el === document.body || el === document.documentElement ||
           el === document.head || el.tagName === 'HTML' || el.tagName === 'BODY' ||
           isOurUI(el);
  }

  // Page shells (#app, main wrappers, etc.) cover nearly the whole viewport.
  // Highlighting them washes the entire page orange — treat them like body
  // for *hover* only so the preview stays clear until the cursor is on a
  // more specific element.
  function isPageShell(el) {
    if (!el || isSkippable(el)) return true;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return true;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    // Covers ~full viewport (common layout roots / full-bleed wrappers).
    if (r.width >= vw * 0.9 && r.height >= vh * 0.9) return true;
    // Taller than the viewport and nearly full width (scrollable page shells).
    if (r.width >= vw * 0.9 && r.height >= vh) return true;
    return false;
  }

  function isHoverHighlightable(el) {
    return !!el && !isSkippable(el) && !isPageShell(el) && !isOurUI(el);
  }

  // Clear the transient hover overlay when the pointer leaves the page.
  // Keeps selection / multi-select highlights intact (those are intentional).
  function clearHoverOverlay() {
    if (popover && !popoverIsMulti && popoverTarget) {
      // Single-target selection still uses the hover overlay as its highlight.
      showTargetHighlight(popoverTarget);
      return;
    }
    hideOverlay();
  }

  /* ── events ────────────────────────────────────────────── */

  // Mousemove — hover highlight
  var lastMouseX = -1, lastMouseY = -1;
  // True only while the pointer is over this document. Prevents the last
  // hovered (often full-page) element from staying orange after the cursor
  // leaves the window, and stops scroll/resize refresh from re-applying it.
  var pointerInWindow = false;

  document.addEventListener('mousedown', function (e) {
    if (!active || e.button !== 0) return;
    if (isOurUI(e.target)) return;
    if (!commenting || popover) return;
    selectionPointerDown = true;
  }, true);

  document.addEventListener('mousemove', function (e) {
    pointerInWindow = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (referencePicking) {
      if (isOurUI(e.target)) { hideOverlay(); return; }
      var refEl = document.elementFromPoint(e.clientX, e.clientY);
      if (!isHoverHighlightable(refEl)) { hideOverlay(); return; }
      if (refEl !== hovered) { hovered = refEl; showOverlay(refEl, 'reference'); }
      return;
    }
    // Hover highlight while commenting. Suppressed when a single-target
    // popover is open; multi-mode keeps hover so shift+click can add more.
    if (!active || !commenting) return;
    if (popover && !popoverIsMulti) return;
    if (selectionPointerDown && getTextSelectionTarget()) {
      hideOverlay();
      hideTargetHighlight();
      return;
    }
    if (isOurUI(e.target)) { hideOverlay(); return; }
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!isHoverHighlightable(el)) { hideOverlay(); return; }
    if (el !== hovered) {
      hovered = el;
      showOverlay(el);
    }
  }, true);

  // Pointer left the browser window / document — drop hover highlight so the
  // page preview is clean. relatedTarget is null when leaving the document.
  document.documentElement.addEventListener('mouseleave', function () {
    pointerInWindow = false;
    if (!active && !referencePicking) return;
    clearHoverOverlay();
  });

  window.addEventListener('blur', function () {
    pointerInWindow = false;
    if (!active && !referencePicking) return;
    clearHoverOverlay();
  });

  document.addEventListener('mouseup', function (e) {
    if (!active || e.button !== 0) return;
    if (!commenting) return;
    if (!selectionPointerDown) return;
    selectionPointerDown = false;

    var textTarget = prepareTarget(getTextSelectionTarget());
    if (textTarget) {
      suppressClickOnce = true;
      showTargetHighlight(textTarget);
      showPopover(textTarget);
      clearBrowserSelection();
    }
  }, true);

  // Click — annotate or close popover (#1: works in ANY mode now)
  document.addEventListener('click', function (e) {
    if (!active) return;
    if (suppressClickOnce) {
      suppressClickOnce = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    var menuWasOpen = !menuPanel.classList.contains('pp-hidden');
    if (menuWasOpen &&
        !menuPanel.contains(e.target) &&
        !btnShortcuts.contains(e.target)) {
      hideMenu();
    }
    if (isOurUI(e.target)) return;

    if (referencePicking && referenceEditor) {
      e.preventDefault();
      e.stopPropagation();
      var refTarget = document.elementFromPoint(e.clientX, e.clientY);
      if (!isSkippable(refTarget)) {
        insertReferenceChip(referenceEditor.editor, makeReferenceFromElement(refTarget));
        stopReferencePicking();
      }
      return;
    }

    // Shift+click while in comment mode — toggle the clicked element into the
    // pending multi-target batch. Runs ahead of the outside-click-closes-
    // popover branch so the multi popover stays open as the user iterates.
    if (commenting && e.shiftKey) {
      var multiEl = document.elementFromPoint(e.clientX, e.clientY);
      if (multiEl && !isSkippable(multiEl)) {
        e.preventDefault();
        e.stopPropagation();
        var multiTarget = prepareTarget(makeElementTarget(multiEl));
        if (multiTarget && multiTarget.kind === 'element') {
          // Snapshot any in-progress editor content before the rebuild so
          // adding/removing a chip doesn't wipe what the user has typed.
          var carriedClick = captureMultiEditorState();
          if (isInMultiSelect(multiTarget)) removeFromMultiSelect(multiTarget);
          else                              addToMultiSelect(multiTarget);
          if (multiTargets.length === 0) {
            clearDraft();
            hidePopover();
            hideTargetHighlight();
            hideOverlay();
          } else {
            showMultiPopover(carriedClick);
          }
        }
        return;
      }
    }

    // Close popover on any outside click, regardless of comment mode (#1).
    // Exception: a multi-mode popover preserves the in-progress selection on
    // outside clicks — only Esc or removing all chips dismisses it.
    if (popover) {
      if (popoverIsMulti) {
        // Swallow the click so the underlying page button/link doesn't fire,
        // but keep the popover open.
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      hidePopover();
      hideTargetHighlight();
      hideOverlay();
      if (commenting) { e.preventDefault(); e.stopPropagation(); }
      return;
    }

    if (commenting) {
      e.preventDefault();
      e.stopPropagation();
      if (hovered && !isSkippable(hovered)) {
        var target = prepareTarget(makeElementTarget(hovered));
        showTargetHighlight(target);
        showPopover(target);
      }
    }
  }, true);

  // Keyboard — shortcuts (#3: A instant, Shift+A copy&clear)
  var tapKey = '';
  var tapCount = 0;
  var tapTimer = null;

  function resetTaps() { tapKey = ''; tapCount = 0; clearTimeout(tapTimer); tapTimer = null; }

  // Nav pill arrow key navigation (capture phase — fires before textarea stopPropagation)
  document.addEventListener('keydown', function (e) {
    if (!active || !navPillActive || navCurrentId === null) return;
    if (inputFocused()) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var uniqueAnns = getUniqueAnnotations();
    if (uniqueAnns.length <= 1) return;
    e.preventDefault();
    e.stopPropagation();
    var idx = -1;
    for (var ni = 0; ni < uniqueAnns.length; ni++) {
      if (uniqueAnns[ni].id === navCurrentId) { idx = ni; break; }
    }
    if (idx === -1) return;
    var target = e.key === 'ArrowLeft'
      ? (idx - 1 + uniqueAnns.length) % uniqueAnns.length
      : (idx + 1) % uniqueAnns.length;
    navPillTo(uniqueAnns[target]);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (!active) return;

    if (popover || inputFocused()) {
      if (e.key === 'Escape' && popover) {
        // Esc on the multi-mode popover discards the pending batch — same
        // bail-out semantics as Esc on a single-target popover.
        if (popoverIsMulti) clearMultiSelect();
        hidePopover();
        hideTargetHighlight();
        hideOverlay();
        if (commenting) stopCommenting();
      }
      return;
    }

    var k = e.key.toLowerCase();

    if (e.key === 'Escape') {
      if (!menuPanel.classList.contains('pp-hidden')) { hideMenu(); resetTaps(); return; }
      if (commenting) {
        stopCommenting();
        hideTargetHighlight();
        selectionPointerDown = false;
        resetTaps();
        return;
      }
      // No tool active, no popover, no menu → double-Esc closes the toolbar.
      if (active) {
        if (tapKey === 'escape') {
          resetTaps();
          deactivate();
        } else {
          tapKey = 'escape';
          tapCount = 1;
          clearTimeout(tapTimer);
          tapTimer = setTimeout(resetTaps, 400);
        }
      }
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // ── keyboard navigation (when enabled + comment mode) ──
    if (keyNavEnabled && commenting) {
      var dir = null;
      if (e.key === 'ArrowUp' && !e.shiftKey) dir = 'up';
      else if (e.key === 'ArrowDown' && !e.shiftKey) dir = 'down';
      else if (e.key === 'ArrowLeft') dir = 'left';
      else if (e.key === 'ArrowRight') dir = 'right';

      if (dir) {
        e.preventDefault();
        keyNavTo(hovered ? findNearest(hovered, dir) : getInitialElement());
        resetTaps();
        return;
      }

      // Shift+Up — parent
      if (e.key === 'ArrowUp' && e.shiftKey && hovered) {
        e.preventDefault();
        keyNavTo(selectParent(hovered));
        resetTaps();
        return;
      }

      // Shift+Down — child
      if (e.key === 'ArrowDown' && e.shiftKey && hovered) {
        e.preventDefault();
        keyNavTo(selectChild(hovered));
        resetTaps();
        return;
      }

      // Tab / Shift+Tab — cycle
      if (e.key === 'Tab') {
        e.preventDefault();
        keyNavTo(cycleElement(!e.shiftKey));
        resetTaps();
        return;
      }

      // Shift+Enter — toggle the keyboard-navigated element into/out of the
      // multi-target batch, mirroring the Shift+click flow for keyboard users.
      if (e.key === 'Enter' && e.shiftKey && hovered && !isSkippable(hovered)) {
        e.preventDefault();
        var multiHoverTarget = prepareTarget(makeElementTarget(hovered));
        if (multiHoverTarget) {
          var carriedKey = captureMultiEditorState();
          if (isInMultiSelect(multiHoverTarget)) removeFromMultiSelect(multiHoverTarget);
          else                                   addToMultiSelect(multiHoverTarget);
          if (multiTargets.length === 0) {
            clearDraft();
            hidePopover();
            hideTargetHighlight();
            hideOverlay();
          } else {
            showMultiPopover(carriedKey);
          }
        }
        resetTaps();
        return;
      }

      // Enter — annotate hovered element
      if (e.key === 'Enter' && hovered && !isSkippable(hovered)) {
        e.preventDefault();
        var hoverTarget = prepareTarget(makeElementTarget(hovered));
        showTargetHighlight(hoverTarget);
        showPopover(hoverTarget);
        resetTaps();
        return;
      }
    }

    // Z — undo
    if (k === 'z' && undoData) {
      e.preventDefault();
      undo();
      resetTaps();
      return;
    }

    // C — toggle comment
    if (k === 'c') {
      e.preventDefault();
      commenting ? stopCommenting() : startCommenting();
      resetTaps();
      return;
    }

    // Shift+A — copy & clear (instant)
    if (k === 'a' && e.shiftKey) {
      e.preventDefault();
      copyAndClear();
      resetTaps();
      return;
    }

    // A — copy all (instant) (#3)
    if (k === 'a') {
      e.preventDefault();
      copyAll();
      resetTaps();
      return;
    }

    // X — multi-tap for delete (XXX)
    if (k === 'x') {
      e.preventDefault();
      if (tapKey === 'x') {
        tapCount++;
      } else {
        tapKey = 'x';
        tapCount = 1;
      }
      clearTimeout(tapTimer);
      if (tapCount >= 3) {
        resetTaps();
        deleteAll();
        return;
      }
      tapTimer = setTimeout(resetTaps, 400);
      return;
    }

    resetTaps();
  });

  // Scroll / resize
  function scheduleRefresh() {
    navElemsDirty = true;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      refreshAll();
    });
  }
  window.addEventListener('scroll', scheduleRefresh, true);
  window.addEventListener('resize', scheduleRefresh);

  /* ── SPA navigation detection (#11) ────────────────────── */
  var currentPath = location.pathname;
  var currentSearch = location.search;
  var currentHash = location.hash;
  var currentStoreKey = STORE_KEY;

  function onNavChange() {
    var newPath = location.pathname;
    var newSearch = location.search;
    var newHash = location.hash;
    var newStoreKey = getStoreKey();
    if (newPath === currentPath && newSearch === currentSearch && newHash === currentHash) return;
    if (newStoreKey === currentStoreKey) {
      currentPath = newPath;
      currentSearch = newSearch;
      currentHash = newHash;
      scheduleRefresh();
      return;
    }
    currentPath = newPath;
    currentSearch = newSearch;
    currentHash = newHash;
    currentStoreKey = newStoreKey;
    STORE_KEY = newStoreKey;
    // Drafts are URL-keyed, so the new page has its own draft slot. We rebind
    // here so subsequent save/load calls hit the right key; the old URL's
    // draft (if any) stays attached to the old key until that page's own
    // commit/Esc/timeout clears it.
    DRAFT_KEY = getDraftKey();
    // Re-arm the draft restore guard so the upcoming restore() call below
    // gives the new URL its own one-shot draft check.
    draftRestoreAttempted = false;
    clearRestoreTimer();
    annotations.forEach(function (a) { if (a.pinEl) a.pinEl.remove(); });
    annotations = [];
    nextId = 1;
    // Multi-select state is page-scoped — a route change abandons whatever
    // batch was being assembled before the navigation.
    clearMultiSelect();
    hidePopover();
    hideTargetHighlight();
    hideOverlay();
    clearUndoState();
    clearBrowserSelection();
    selectionPointerDown = false;
    restore();
  }

  var _pushState = history.pushState;
  var _replaceState = history.replaceState;
  history.pushState = function () { _pushState.apply(this, arguments); onNavChange(); };
  history.replaceState = function () { _replaceState.apply(this, arguments); onNavChange(); };
  window.addEventListener('popstate', onNavChange);
  window.addEventListener('hashchange', onNavChange);
  window.addEventListener('pageshow', onNavChange);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) onNavChange();
  });
  setInterval(onNavChange, 500);

  /* ── toolbar wiring ────────────────────────────────────── */
  btnComment.addEventListener('click', function (e) { e.stopPropagation(); commenting ? stopCommenting() : startCommenting(); });
  countEl.addEventListener('click', function (e) {
    e.stopPropagation();
    var uniqueAnns = getUniqueAnnotations();
    if (uniqueAnns.length > 0) navPillTo(uniqueAnns[0]);
  });
  btnCopy.addEventListener('click', function (e) { e.stopPropagation(); copyAll(); });
  btnDelete.addEventListener('click', function (e) {
    e.stopPropagation();
    if (undoData) undo(); else deleteAll();
  });
  btnShortcuts.addEventListener('click', function (e) { e.stopPropagation(); toggleMenu(); });
  btnClose.addEventListener('click', function (e) { e.stopPropagation(); deactivate(true); });
  toggle.addEventListener('click', function (e) { e.stopPropagation(); activate(); });

  /* ── nav pill wiring ──────────────────────────────────── */
  navPrev.addEventListener('click', function (e) {
    e.stopPropagation();
    var uniqueAnns = getUniqueAnnotations();
    if (navCurrentId === null || uniqueAnns.length === 0) return;
    var idx = -1;
    for (var i = 0; i < uniqueAnns.length; i++) {
      if (uniqueAnns[i].id === navCurrentId) { idx = i; break; }
    }
    if (idx === -1) return;
    var prevIdx = (idx - 1 + uniqueAnns.length) % uniqueAnns.length;
    navPillTo(uniqueAnns[prevIdx]);
  });

  navNext.addEventListener('click', function (e) {
    e.stopPropagation();
    var uniqueAnns = getUniqueAnnotations();
    if (navCurrentId === null || uniqueAnns.length === 0) return;
    var idx = -1;
    for (var i = 0; i < uniqueAnns.length; i++) {
      if (uniqueAnns[i].id === navCurrentId) { idx = i; break; }
    }
    if (idx === -1) return;
    var nextIdx = (idx + 1) % uniqueAnns.length;
    navPillTo(uniqueAnns[nextIdx]);
  });

  navPill.addEventListener('click', function (e) { e.stopPropagation(); });

  /* ── menu settings wiring ─────────────────────────────── */
  var keyNavToggle = menuPanel.querySelector('.pp-keynav-toggle');
  var clearAfterCopyToggle = menuPanel.querySelector('.pp-clearcopy-toggle');

  keyNavToggle.addEventListener('change', function () {
    keyNavEnabled = this.checked;
    safeStorageSet({ keyNavEnabled: keyNavEnabled });
  });

  clearAfterCopyToggle.addEventListener('change', function () {
    clearAfterCopy = this.checked;
    safeStorageSet({ clearAfterCopy: clearAfterCopy });
  });

  // Stop clicks inside menu from propagating (prevents toolbar close)
  menuPanel.addEventListener('click', function (e) { e.stopPropagation(); });

  // Restore settings
  safeStorageGet(['keyNavEnabled', 'clearAfterCopy', 'theme', 'toolbarPosition'], function (data) {
    keyNavEnabled = data.keyNavEnabled !== undefined ? !!data.keyNavEnabled : true;
    keyNavToggle.checked = keyNavEnabled;
    clearAfterCopy = !!data.clearAfterCopy;
    clearAfterCopyToggle.checked = clearAfterCopy;
    applyTheme(data.theme);
    applyToolbarPosition(data.toolbarPosition);
    if (data.toolbarPosition !== toolbarPosition) {
      safeStorageSet({ toolbarPosition: toolbarPosition });
    }
  });

  /* ── custom tooltips ──────────────────────────────────── */
  var barTipTimer = null;

  function showBarTip(btn) {
    var label = btn.getAttribute('data-tip');
    if (!label) return;
    var keys = btn.getAttribute('data-keys');
    var html = '<span class="pp-bar-tip-label">' + label + '</span>';
    if (keys) {
      html += '<div class="pp-bar-tip-keys">';
      keys.split(',').forEach(function (k) {
        html += '<kbd class="pp-key">' + k + '</kbd>';
      });
      html += '</div>';
    }
    barTip.innerHTML = html;
    barTip.classList.add('pp-on');
    var br = btn.getBoundingClientRect();
    var tw = barTip.offsetWidth;
    var th = barTip.offsetHeight;
    var left = br.left + br.width / 2 - tw / 2;
    var preferBelow = toolbarPosition.indexOf('top-') === 0;
    var top;

    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));

    // The settings menu stacks above (or below) the toolbar in the
    // direction the tooltip wants to grow. When it's open, use the
    // menu's far edge as the anchor instead of the button's so the
    // tooltip never lands tucked behind the menu panel.
    var menuIsOpen = !menuPanel.classList.contains('pp-hidden');
    var awayRect = menuIsOpen ? menuPanel.getBoundingClientRect() : br;

    if (preferBelow) {
      top = awayRect.bottom + 10;
      if (top + th > window.innerHeight - 8) {
        top = Math.max(8, awayRect.top - th - 10);
      }
    } else {
      top = awayRect.top - th - 10;
      if (top < 8) {
        top = Math.min(window.innerHeight - th - 8, awayRect.bottom + 10);
      }
    }

    barTip.style.left = left + 'px';
    barTip.style.top = top + 'px';
  }

  function hideBarTip() {
    clearTimeout(barTipTimer);
    barTipTimer = null;
    barTip.classList.remove('pp-on');
  }

  root.addEventListener('mouseenter', function (e) {
    var btn = e.target.closest('[data-tip]');
    if (!btn || !root.contains(btn)) return;
    clearTimeout(barTipTimer);
    barTipTimer = setTimeout(function () { showBarTip(btn); }, 400);
  }, true);

  root.addEventListener('mouseleave', function (e) {
    var btn = e.target.closest('[data-tip]');
    if (!btn || !root.contains(btn)) return;
    hideBarTip();
  }, true);

  root.addEventListener('click', function () { hideBarTip(); }, true);

  /* ── dev-only helper ─────────────────────────────────────── */
  // NOTE: This function is duplicated in popup.js (which takes a host parameter).
  // Popup and content script run in separate JS contexts and cannot share code
  // without a build step. Keep both in sync manually.
  function isLocalHtmlFile() {
    return location.protocol === 'file:' && /\.html?(?:$|[?#])/i.test(location.pathname);
  }

  function getSiteKey() {
    return isLocalHtmlFile() ? 'file://local-html' : location.hostname;
  }

  // Record this domain as disabled (same list the popup's per-site toggle
  // uses) so the load-time check below hides the toggle after a refresh.
  function persistSiteDisabled() {
    var siteKey = getSiteKey();
    safeStorageGet('disabledHosts', function (data) {
      var list = data.disabledHosts || [];
      if (list.indexOf(siteKey) === -1) {
        list.push(siteKey);
        safeStorageSet({ disabledHosts: list });
      }
    });
  }

  function isDevHost() {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
           h === '[::1]' || h.endsWith('.local') || h.endsWith('.localhost');
  }

  /* ── site disable/enable ────────────────────────────────── */
  safeStorageGet(['disabledHosts', 'devOnly', 'theme', 'toolbarPosition'], function (data) {
    var list = data.disabledHosts || [];
    var devOnly = !!data.devOnly;
    var localHtml = isLocalHtmlFile();
    var siteKey = getSiteKey();
    applyTheme(data.theme);
    applyToolbarPosition(data.toolbarPosition);
    if (location.protocol === 'file:' && !localHtml) {
      toggle.classList.add('pp-hidden');
      return;
    }
    if (list.indexOf(siteKey) !== -1 ||
        (localHtml && !devOnly) ||
        (!localHtml && devOnly && !isDevHost())) {
      toggle.classList.add('pp-hidden');
    }
  });

  safeRuntimeOnMessage(function (msg) {
    if (msg.type === 'agimut-toggle') {
      if (msg.enabled) {
        toggle.classList.remove('pp-hidden');
      } else {
        if (active) deactivate();
        toggle.classList.add('pp-hidden');
      }
    }
    if (msg.type === 'agimut-devonly') {
      var localHtml = isLocalHtmlFile();
      if ((localHtml && !msg.devOnly) || (!localHtml && msg.devOnly && !isDevHost())) {
        if (active) deactivate();
        toggle.classList.add('pp-hidden');
      } else {
        safeStorageGet('disabledHosts', function (data) {
          var list = data.disabledHosts || [];
          if (list.indexOf(getSiteKey()) === -1) {
            toggle.classList.remove('pp-hidden');
          }
        });
      }
    }
    if (msg.type === 'agimut-settings') {
      if (msg.theme) applyTheme(msg.theme);
      if (msg.toolbarPosition) applyToolbarPosition(msg.toolbarPosition);
      refreshAll();
    }
  });

  /* ── init ──────────────────────────────────────────────── */
  pinLayer.classList.add('pp-hidden');
  applyTheme(uiTheme);
  applyToolbarPosition(toolbarPosition);
  restore();
})();
