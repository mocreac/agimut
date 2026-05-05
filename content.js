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

  var STORE_KEY = getStoreKey();

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
    crosshair:   'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm8,191.63V184a8,8,0,0,0-16,0v31.63A88.13,88.13,0,0,1,40.37,136H72a8,8,0,0,0,0-16H40.37A88.13,88.13,0,0,1,120,40.37V72a8,8,0,0,0,16,0V40.37A88.13,88.13,0,0,1,215.63,120H184a8,8,0,0,0,0,16h31.63A88.13,88.13,0,0,1,136,215.63Z',
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
    crosshair: ph(P.crosshair),
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
    '<button class="pp-bar-btn pp-btn-send" data-tip="Copy & clear" data-keys="Shift,A" aria-label="Copy and clear">' + ico.send + '</button>' +
    '<div class="pp-bar-sep"></div>' +
    '<button class="pp-bar-btn pp-btn-delete" data-tip="Delete all" data-keys="X,X,X" aria-label="Delete all">' + ico.trash + '</button>' +
    '<div class="pp-bar-sep"></div>' +
    '<button class="pp-bar-btn pp-btn-shortcuts" data-tip="Menu" aria-label="Menu">' + ico.sliders + '</button>' +
    '<button class="pp-bar-btn pp-btn-close" data-tip="Close" data-keys="Esc" aria-label="Close">' + ico.close + '</button>';
  root.appendChild(bar);

  var barTip = document.createElement('div');
  barTip.className = 'pp-bar-tip';
  root.appendChild(barTip);

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
    '</div>' +
    '<div class="pp-menu-divider"></div>' +
    '<div class="pp-menu-section">' +
      '<div class="pp-sc-title">Shortcuts</div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Comment mode</span><div class="pp-sc-keys"><kbd class="pp-key">C</kbd></div></div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Copy annotations</span><div class="pp-sc-keys"><kbd class="pp-key">A</kbd></div></div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Copy & clear</span><div class="pp-sc-keys"><kbd class="pp-key">Shift</kbd><kbd class="pp-key">A</kbd></div></div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Delete all</span><div class="pp-sc-keys"><kbd class="pp-key">X</kbd><kbd class="pp-key">X</kbd><kbd class="pp-key">X</kbd></div></div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Undo delete</span><div class="pp-sc-keys"><kbd class="pp-key">Z</kbd></div></div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Close</span><div class="pp-sc-keys"><kbd class="pp-key">Esc</kbd></div></div>' +
    '</div>' +
    '<div class="pp-menu-divider"></div>' +
    '<div class="pp-menu-section">' +
      '<div class="pp-sc-title">Navigation</div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Move selection</span><div class="pp-sc-keys"><kbd class="pp-key">\u2190</kbd><kbd class="pp-key">\u2191</kbd><kbd class="pp-key">\u2193</kbd><kbd class="pp-key">\u2192</kbd></div></div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Parent / child</span><div class="pp-sc-keys"><kbd class="pp-key">Shift</kbd><kbd class="pp-key">\u2191</kbd><kbd class="pp-key">\u2193</kbd></div></div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Cycle elements</span><div class="pp-sc-keys"><kbd class="pp-key">Tab</kbd></div></div>' +
      '<div class="pp-sc-row"><span class="pp-sc-label">Annotate</span><div class="pp-sc-keys"><kbd class="pp-key">Enter</kbd></div></div>' +
    '</div>';
  root.appendChild(menuPanel);

  /* ── button refs ───────────────────────────────────────── */
  var btnComment = bar.querySelector('.pp-btn-comment');
  var btnCopy    = bar.querySelector('.pp-btn-copy');
  var btnSend    = bar.querySelector('.pp-btn-send');
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

    var mainOffset = isTop ? '20px' : '20px';
    var stackOffset = isTop ? '76px' : '76px';

    if (isTop) {
      bar.style.top = mainOffset;
      toggle.style.top = mainOffset;
      menuPanel.style.top = stackOffset;
      toast.style.top = stackOffset;
      navPill.style.top = stackOffset;
    } else {
      bar.style.bottom = mainOffset;
      toggle.style.bottom = mainOffset;
      menuPanel.style.bottom = stackOffset;
      toast.style.bottom = stackOffset;
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

    // Collapse to toggle size
    bar.style.width = collapsedSize + 'px';
    bar.style.borderRadius = collapsedRadius;
    bar.style.overflow = 'hidden';
    void bar.offsetWidth;
    bar.style.visibility = '';

    // Animate expansion
    bar.style.transition = 'width 300ms cubic-bezier(0.25, 1, 0.5, 1), border-radius 300ms cubic-bezier(0.25, 1, 0.5, 1)';
    requestAnimationFrame(function () {
      bar.style.width = fullWidth + 'px';
      bar.style.borderRadius = '';
    });

    morphTimer = setTimeout(function () {
      bar.style.transition = '';
      bar.style.width = '';
      bar.style.borderRadius = '';
      bar.style.overflow = '';
    }, 320);

    pinLayer.classList.remove('pp-hidden');
    startCommenting();
  }

  function deactivate() {
    active = false;
    stopCommenting();
    hidePopover();
    hideTargetHighlight();
    hideOverlay();
    hideMenu();
    hideBarTip();
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
    bar.style.width = curWidth + 'px';
    bar.style.overflow = 'hidden';
    void bar.offsetWidth;

    bar.style.transition = 'width 250ms cubic-bezier(0.5, 0, 0.75, 0), border-radius 250ms cubic-bezier(0.5, 0, 0.75, 0)';
    bar.style.width = collapsedSize + 'px';
    bar.style.borderRadius = collapsedRadius;

    morphTimer = setTimeout(function () {
      bar.style.transition = '';
      bar.style.width = '';
      bar.style.borderRadius = '';
      bar.style.overflow = '';
      bar.classList.add('pp-hidden');
      toggle.classList.remove('pp-hidden');
    }, 270);

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
  }

  /* ── annotation count badge (#6) ───────────────────────── */
  function updateCount() {
    var n = annotations.length;
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
    if (toolbarPosition.indexOf('top-') === 0) {
      toast.style.top = navPillActive ? '116px' : '76px';
    } else {
      toast.style.bottom = navPillActive ? '116px' : '76px';
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
      }, 300);
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

  function getAnnotationsForTarget(target) {
    var key = target ? target.key || getTargetKey(target) : '';
    return annotations.filter(function (ann) { return ann.key === key; });
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

  function buildCommentCard(ann) {
    ann.references = sanitizeReferences(ann.references || []);
    var card = document.createElement('div');
    card.className = 'pp-comment-card';

    var shell = document.createElement('div');
    shell.className = 'pp-input-shell pp-comment-shell';

    var badgeWrap = document.createElement('div');
    badgeWrap.className = 'pp-comment-badge-wrap';
    var editorRow = document.createElement('div');
    editorRow.className = 'pp-comment-editor-row';

    var badge = document.createElement('span');
    badge.className = 'pp-comment-badge';
    badge.textContent = ann.id;
    badgeWrap.appendChild(badge);
    card.appendChild(badgeWrap);

    var actions = document.createElement('div');
    actions.className = 'pp-comment-actions';

    var copy = document.createElement('button');
    copy.className = 'pp-pop-btn pp-pop-copy';
    copy.title = 'Copy annotation';
    copy.setAttribute('aria-label', 'Copy annotation');
    copy.innerHTML = ico.copy;
    copy.addEventListener('click', function (e) {
      e.stopPropagation();
      navigator.clipboard.writeText(formatMarkdown([ann])).then(
        function () {
          flashBtn(copy, ico.copy);
          showToast('Annotation ' + ann.id + ' copied');
        },
        function () { shakeBtn(copy); }
      );
    });
    actions.appendChild(copy);

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

    var del = document.createElement('button');
    del.className = 'pp-pop-btn pp-pop-delete';
    del.title = 'Delete';
    del.setAttribute('aria-label', 'Delete');
    del.innerHTML = ico.trashSm;
    del.addEventListener('click', function (e) {
      e.stopPropagation();
      deleteAnnotationAndContinue();
    });
    actions.appendChild(del);

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
      deleteAnnotation(ann.id);
      var remaining = annotations.filter(function (item) { return item.key === ann.key; });
      if (remaining.length > 0) {
        navPillTo(remaining[0]);
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
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hidePopover(); hideTargetHighlight(); hideOverlay(); }
      saveEditorRange(input);
      e.stopPropagation();
    });

    var ref = document.createElement('button');
    ref.className = 'pp-pop-btn pp-pop-ref pp-ref-picker';
    ref.title = 'Reference element';
    ref.setAttribute('aria-label', 'Reference element');
    ref.innerHTML = ico.crosshair;
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

  function showPopover(target, ann) {
    hidePopover();
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
      targetAnns.forEach(function (a) {
        pop.appendChild(buildCommentCard(a));
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
    newBadge.textContent = nextId;
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
    });
    editorRow.appendChild(input);
    shell.appendChild(editorRow);

    var btnRow = document.createElement('div');
    btnRow.className = 'pp-pop-btns';

    var refBtn = document.createElement('button');
    refBtn.className = 'pp-pop-btn pp-ref-picker';
    refBtn.title = 'Reference element';
    refBtn.setAttribute('aria-label', 'Reference element');
    refBtn.innerHTML = ico.crosshair;
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
    input.addEventListener('input', function () {
      sync();
      saveEditorRange(input);
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
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hidePopover(); hideTargetHighlight(); hideOverlay(); }
      saveEditorRange(input);
      e.stopPropagation();
    });

    pop.appendChild(newSection);

    function commit() {
      var data = serializeEditor(input);
      if (!data.comment && data.refs.length === 0) return;
      addAnnotation(target, data.comment, data.refs, data.parts);
      hidePopover();
      hideTargetHighlight();
      hideOverlay();
    }

    root.appendChild(pop);
    popover = pop;
    positionPop(target, pop);
    requestAnimationFrame(function () {
      if (quoteTextNode && quoteBlockNode) {
        var lineHeight = parseFloat(getComputedStyle(quoteTextNode).lineHeight) || 18;
        var isSingleLine = quoteTextNode.scrollHeight <= lineHeight * 1.5;
        quoteBlockNode.classList.toggle('pp-pop-quote-single', isSingleLine);
      }
      input.focus();
    });
    if (ann) showNavPill(ann);
  }

  function hidePopover() {
    stopReferencePicking();
    if (popover) {
      popover.remove();
      popover = null;
      popoverTarget = null;
      editingAnn = null;
    }
    hideNavPill();
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
      deleteAnnotation(ann.id);
      hidePopover();
    });
    header.appendChild(del);
    pop.appendChild(header);

    if (ann.comment) {
      var commentEl = document.createElement('p');
      commentEl.className = 'pp-orphan-comment';
      commentEl.textContent = ann.comment;
      pop.appendChild(commentEl);
    }

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
    if (annotations.length <= 1) { hideNavPill(); return; }
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
    }, 200);
  }

  function updateNavPillLabel() {
    if (navCurrentId === null) return;
    var idx = -1;
    for (var i = 0; i < annotations.length; i++) {
      if (annotations[i].id === navCurrentId) { idx = i; break; }
    }
    if (idx === -1) { hideNavPill(); return; }
    navLabel.textContent = (idx + 1) + ' / ' + annotations.length;
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
    var anchor = getTargetAnchorRect(target);
    if (!anchor) return;

    var popWidth = pop.offsetWidth || 320;
    var popHeight = pop.offsetHeight || 180;
    var spaceAbove = anchor.top - 8;
    var spaceBelow = window.innerHeight - anchor.bottom - 8;
    var top;

    if (spaceBelow >= popHeight + 12 || spaceBelow >= spaceAbove) {
      top = Math.min(anchor.bottom + 12, window.innerHeight - popHeight - 8);
    } else {
      top = Math.max(8, anchor.top - popHeight - 12);
    }

    var left = anchor.left + anchor.width / 2 - popWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popWidth - 8));

    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    pop.style.bottom = 'auto';
  }

  /* ── annotations & pins ────────────────────────────────── */
  function addAnnotation(target, comment, references, parts) {
    target = prepareTarget(target);
    var ann = {
      id: nextId++,
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

  function deleteAnnotation(id) {
    var idx = annotations.findIndex(function (a) { return a.id === id; });
    if (idx === -1) return;
    var ann = annotations[idx];
    if (ann.pinEl) ann.pinEl.remove();
    annotations.splice(idx, 1);
    renumber();
    persist();
    updateCount();
    // Update nav pill after renumber
    if (navPillActive) {
      if (annotations.length <= 1) {
        hideNavPill();
      } else {
        var newIdx = Math.min(idx, annotations.length - 1);
        navCurrentId = annotations[newIdx].id;
        updateNavPillLabel();
      }
    }
  }

  function renumber() {
    for (var i = 0; i < annotations.length; i++) {
      var a = annotations[i];
      a.id = i + 1;
      if (a.pinEl) {
        a.pinEl.textContent = a.id;
        a.pinEl.setAttribute('aria-label', 'Annotation ' + a.id);
        a.pinEl.classList.toggle('pp-pin-sm', a.id >= 10 && a.id < 100);
        a.pinEl.classList.toggle('pp-pin-xs', a.id >= 100);
      }
    }
    nextId = annotations.length + 1;
  }

  function deleteAll() {
    if (annotations.length === 0) { shakeBtn(btnDelete); return; }
    var count = annotations.length;
    hidePopover();
    hideTargetHighlight();
    hideOverlay();
    saveUndoState();
    annotations.forEach(function (a) { if (a.pinEl) a.pinEl.remove(); });
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
    if (!ann || ann.orphaned) return;
    ann.orphaned = true;
    ann.el = null;
    ann.range = null;
    syncOrphanPinState(ann);
    positionPin(ann);
    persist();
  }

  function createPin(ann) {
    var pin = document.createElement('div');
    pin.className = 'pp-pin';
    pin.setAttribute('role', 'button');
    pin.setAttribute('tabindex', '0');
    pin.setAttribute('aria-label', 'Annotation ' + ann.id);
    if (ann.id >= 100) pin.classList.add('pp-pin-xs');
    else if (ann.id >= 10) pin.classList.add('pp-pin-sm');
    pin.textContent = ann.id;

    pinLayer.appendChild(pin);
    ann.pinEl = pin;
    syncOrphanPinState(ann);
    positionPin(ann);

    pin.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pin.click();
      }
    });

    pin.addEventListener('click', function (e) {
      e.stopPropagation();

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
    });
  }

  function positionPin(ann) {
    if (ann.orphaned) {
      var orphanIndex = 0;
      for (var oi = 0; oi < annotations.length; oi++) {
        if (annotations[oi] === ann) break;
        if (annotations[oi].orphaned) orphanIndex++;
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
    if (popover && popoverTarget) {
      positionPop(popoverTarget, popover);
      showTargetHighlight(popoverTarget);
    } else if (commenting && lastMouseX >= 0) {
      var el = document.elementFromPoint(lastMouseX, lastMouseY);
      if (el && !isSkippable(el) && !isOurUI(el)) {
        hovered = el;
        showOverlay(el);
      } else {
        hideOverlay();
        hideTargetHighlight();
      }
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
  var KEEP_ATTRS = /^(id|class|href|src|alt|name|type|role|aria-label|placeholder|action|method|for|value|target|rel)$/;

  function getCleanTag(el) {
    if (!el.isConnected) return '';
    var clone = el.cloneNode(false);
    var attrs = Array.from(clone.attributes);
    for (var i = 0; i < attrs.length; i++) {
      var a = attrs[i];
      if (!KEEP_ATTRS.test(a.name)) { clone.removeAttribute(a.name); continue; }
      if (a.name === 'class') {
        var clean = a.value.trim().split(/\s+/).filter(function (c) {
          return c && !isGeneratedClass(c);
        }).join(' ');
        if (clean) clone.setAttribute('class', clean); else clone.removeAttribute('class');
      }
    }
    var html = clone.outerHTML;
    var tag = el.tagName.toLowerCase();
    var closeTag = '</' + tag + '>';
    if (html.endsWith(closeTag)) html = html.slice(0, -closeTag.length);
    return html.length > 200 ? html.slice(0, 200) + '...' : html;
  }

  function getTextPreview(el) {
    var text = (el.textContent || '').trim();
    if (!text) return '';
    return text.length > 80 ? text.slice(0, 80) + '\u2026' : text;
  }

  var SEMANTIC_TAGS = { HEADER:1, NAV:1, MAIN:1, ASIDE:1, FOOTER:1, SECTION:1, ARTICLE:1, FORM:1 };

  function getAncestorTrail(el) {
    var parts = [];
    var cur = el.parentElement;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur.id && !/\s/.test(cur.id)) { parts.unshift('#' + cur.id); break; }
      if (SEMANTIC_TAGS[cur.tagName]) parts.unshift(cur.tagName.toLowerCase());
      cur = cur.parentElement;
    }
    return parts.length ? parts.join(' > ') : '';
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
    lines.push('      The <ref:n> tokens appear inside Feedback at the exact sentence position where the user inserted each reference. Use the surrounding words to infer intent, such as matching, comparing, or borrowing style/content from that referenced element.');
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

  /* ── copy ──────────────────────────────────────────────── */
  function formatMarkdown(items) {
    var source = items || annotations;
    var lines = ['URL: ' + location.href];
    lines.push('');

    source.forEach(function (ann) {
      lines.push(ann.id + '.');

      var html = ann.el ? getCleanTag(ann.el) : '';
      var text = ann.kind === 'text' ? ann.quote : (ann.el ? getTextPreview(ann.el) : '');
      var context = ann.el ? getAncestorTrail(ann.el) : '';
      var comment = getInlineFeedback(ann);

      if (html) lines.push('   HTML: ' + html);
      if (text) lines.push('   ' + (ann.kind === 'text' ? 'Quote' : 'Text') + ': ' + quoteExportValue(text));
      if (context) lines.push('   Context: ' + context);

      if (ann.orphaned) {
        lines.push('   Status: Element not found');
        lines.push('   Feedback: ' + comment);
        appendReferenceExport(lines, ann);
        lines.push('');
        return;
      }

      lines.push('   Feedback: ' + comment);
      appendReferenceExport(lines, ann);
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  function copyAll() {
    if (annotations.length === 0) { shakeBtn(btnCopy); return; }
    var count = annotations.length;
    navigator.clipboard.writeText(formatMarkdown()).then(
      function () {
        flashBtn(btnCopy, ico.copy);
        showToast(count + ' annotation' + (count !== 1 ? 's' : '') + ' copied');
      },
      function () { shakeBtn(btnCopy); }
    );
  }

  function copyAndClear() {
    if (annotations.length === 0) { shakeBtn(btnSend); return; }
    var count = annotations.length;
    var md = formatMarkdown();
    saveUndoState();
    navigator.clipboard.writeText(md).then(function () {
      flashBtn(btnSend, ico.send);
      showToast(count + ' annotation' + (count !== 1 ? 's' : '') + ' copied & cleared');
      hidePopover();
      hideTargetHighlight();
      hideOverlay();
      annotations.forEach(function (a) { if (a.pinEl) a.pinEl.remove(); });
      annotations = [];
      nextId = 1;
      persist();
      updateCount();
    }, function () {
      shakeBtn(btnSend);
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

  /* ── events ────────────────────────────────────────────── */

  // Mousemove — hover highlight
  var lastMouseX = -1, lastMouseY = -1;

  document.addEventListener('mousedown', function (e) {
    if (!active || !commenting || popover || e.button !== 0) return;
    if (isOurUI(e.target)) return;
    selectionPointerDown = true;
  }, true);

  document.addEventListener('mousemove', function (e) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (referencePicking) {
      if (isOurUI(e.target)) { hideOverlay(); return; }
      var refEl = document.elementFromPoint(e.clientX, e.clientY);
      if (isSkippable(refEl)) { hideOverlay(); return; }
      if (refEl !== hovered) { hovered = refEl; showOverlay(refEl, 'reference'); }
      return;
    }
    if (!active || !commenting || popover) return;
    if (selectionPointerDown && getTextSelectionTarget()) {
      hideOverlay();
      hideTargetHighlight();
      return;
    }
    if (isOurUI(e.target)) { hideOverlay(); return; }
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (isSkippable(el)) { hideOverlay(); return; }
    if (el !== hovered) { hovered = el; showOverlay(el); }
  }, true);

  document.addEventListener('mouseup', function (e) {
    if (!active || !commenting || e.button !== 0) return;
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
    if (!menuPanel.classList.contains('pp-hidden') &&
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

    // Close popover on any outside click, regardless of comment mode (#1)
    if (popover) {
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
    if (!active || !navPillActive || navCurrentId === null || annotations.length <= 1) return;
    if (inputFocused()) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    var idx = -1;
    for (var ni = 0; ni < annotations.length; ni++) {
      if (annotations[ni].id === navCurrentId) { idx = ni; break; }
    }
    if (idx === -1) return;
    var target = e.key === 'ArrowLeft'
      ? (idx - 1 + annotations.length) % annotations.length
      : (idx + 1) % annotations.length;
    navPillTo(annotations[target]);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (!active) return;

    if (popover || inputFocused()) {
      if (e.key === 'Escape' && popover) { hidePopover(); hideTargetHighlight(); hideOverlay(); }
      return;
    }

    var k = e.key.toLowerCase();

    if (e.key === 'Escape') {
      if (!menuPanel.classList.contains('pp-hidden')) { hideMenu(); return; }
      if (commenting) {
        stopCommenting();
        hideTargetHighlight();
        selectionPointerDown = false;
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
    clearRestoreTimer();
    annotations.forEach(function (a) { if (a.pinEl) a.pinEl.remove(); });
    annotations = [];
    nextId = 1;
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
    if (annotations.length > 0) navPillTo(annotations[0]);
  });
  btnCopy.addEventListener('click', function (e) { e.stopPropagation(); copyAll(); });
  btnSend.addEventListener('click', function (e) { e.stopPropagation(); copyAndClear(); });
  btnDelete.addEventListener('click', function (e) {
    e.stopPropagation();
    if (undoData) undo(); else deleteAll();
  });
  btnShortcuts.addEventListener('click', function (e) { e.stopPropagation(); toggleMenu(); });
  btnClose.addEventListener('click', function (e) { e.stopPropagation(); deactivate(); });
  toggle.addEventListener('click', function (e) { e.stopPropagation(); activate(); });

  /* ── nav pill wiring ──────────────────────────────────── */
  navPrev.addEventListener('click', function (e) {
    e.stopPropagation();
    if (navCurrentId === null || annotations.length === 0) return;
    var idx = -1;
    for (var i = 0; i < annotations.length; i++) {
      if (annotations[i].id === navCurrentId) { idx = i; break; }
    }
    if (idx === -1) return;
    var prevIdx = (idx - 1 + annotations.length) % annotations.length;
    navPillTo(annotations[prevIdx]);
  });

  navNext.addEventListener('click', function (e) {
    e.stopPropagation();
    if (navCurrentId === null || annotations.length === 0) return;
    var idx = -1;
    for (var i = 0; i < annotations.length; i++) {
      if (annotations[i].id === navCurrentId) { idx = i; break; }
    }
    if (idx === -1) return;
    var nextIdx = (idx + 1) % annotations.length;
    navPillTo(annotations[nextIdx]);
  });

  navPill.addEventListener('click', function (e) { e.stopPropagation(); });

  /* ── menu settings wiring ─────────────────────────────── */
  var keyNavToggle = menuPanel.querySelector('.pp-keynav-toggle');

  keyNavToggle.addEventListener('change', function () {
    keyNavEnabled = this.checked;
    safeStorageSet({ keyNavEnabled: keyNavEnabled });
  });

  // Stop clicks inside menu from propagating (prevents toolbar close)
  menuPanel.addEventListener('click', function (e) { e.stopPropagation(); });

  // Restore settings
  safeStorageGet(['keyNavEnabled', 'theme', 'toolbarPosition'], function (data) {
    keyNavEnabled = data.keyNavEnabled !== undefined ? !!data.keyNavEnabled : true;
    keyNavToggle.checked = keyNavEnabled;
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

    if (preferBelow) {
      top = br.bottom + 10;
      if (top + th > window.innerHeight - 8) {
        top = Math.max(8, br.top - th - 10);
      }
    } else {
      top = br.top - th - 10;
      if (top < 8) {
        top = Math.min(window.innerHeight - th - 8, br.bottom + 10);
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
