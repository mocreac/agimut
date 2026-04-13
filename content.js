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
  var STORE_KEY = 'pinpoint:' + location.origin + location.pathname + location.hash;

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

    // Collapse to toggle size
    bar.style.width = '46px';
    bar.style.borderRadius = '50%';
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
    hideOverlay();
    hideMenu();
    hideBarTip();
    clearUndoState();

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
    bar.style.width = curWidth + 'px';
    bar.style.overflow = 'hidden';
    void bar.offsetWidth;

    bar.style.transition = 'width 250ms cubic-bezier(0.5, 0, 0.75, 0), border-radius 250ms cubic-bezier(0.5, 0, 0.75, 0)';
    bar.style.width = '46px';
    bar.style.borderRadius = '50%';

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
    // Sit above nav pill when it's visible, otherwise take its spot
    toast.style.bottom = navPillActive ? '116px' : '';
    toast.classList.remove('pp-hidden', 'pp-toast-out');
    void toast.offsetWidth;
    toast.classList.add('pp-toast-in');
    toastTimer = setTimeout(function () {
      toast.classList.remove('pp-toast-in');
      toast.classList.add('pp-toast-out');
      toastTimer = setTimeout(function () {
        toast.classList.add('pp-hidden');
        toast.classList.remove('pp-toast-out');
        toast.style.bottom = '';
      }, 300);
    }, 2500);
  }

  /* ── hover overlay ─────────────────────────────────────── */
  function showOverlay(el) {
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
    overlay.classList.add('pp-on');

    var name = typeName(el);
    var text = (el.textContent || '').trim();
    var preview = text.length > 35 ? text.slice(0, 35) + '\u2026' : text;
    tip.textContent = name + (preview ? ': ' + preview : '');

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
    tip.classList.remove('pp-on');
    hovered = null;
  }

  /* ── popover ───────────────────────────────────────────── */
  function getAnnotationsForElement(el) {
    return annotations.filter(function (a) { return a.el === el; });
  }

  function buildCommentCard(ann, pop) {
    var card = document.createElement('div');
    card.className = 'pp-comment-card';

    var header = document.createElement('div');
    header.className = 'pp-comment-header';
    var badge = document.createElement('span');
    badge.className = 'pp-comment-badge';
    badge.textContent = ann.id;
    header.appendChild(badge);

    var del = document.createElement('button');
    del.className = 'pp-pop-btn pp-pop-delete';
    del.title = 'Delete';
    del.setAttribute('aria-label', 'Delete');
    del.innerHTML = ico.trashSm;
    del.addEventListener('click', function (e) {
      e.stopPropagation();
      var targetEl = ann.el;
      deleteAnnotation(ann.id);
      // Reopen popover to refresh all badges, or close if none left
      var remaining = getAnnotationsForElement(targetEl);
      if (remaining.length > 0) {
        showPopover(targetEl, remaining[0]);
        showOverlay(targetEl);
      } else {
        hidePopover();
        hideOverlay();
      }
    });
    header.appendChild(del);
    card.appendChild(header);

    var input = document.createElement('textarea');
    input.className = 'pp-pop-input';
    input.value = ann.comment;
    input.rows = 1;
    input.setAttribute('aria-label', 'Annotation ' + ann.id);
    card.appendChild(input);

    function autoGrow() {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';
    }
    input.addEventListener('input', function () {
      autoGrow();
      ann.comment = input.value.trim();
      persist();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hidePopover(); hideOverlay(); }
      e.stopPropagation();
    });
    requestAnimationFrame(autoGrow);

    return card;
  }

  function showPopover(el, ann) {
    hidePopover();
    editingAnn = ann || null;
    popoverTarget = el;

    // Find all annotations on this element
    var elAnns = ann ? getAnnotationsForElement(el) : [];
    var isEdit = elAnns.length > 0;

    var pop = document.createElement('div');
    pop.className = 'pp-popover';

    // Show existing annotation cards
    if (isEdit) {
      elAnns.forEach(function (a) {
        pop.appendChild(buildCommentCard(a, pop));
      });
    }

    // New comment input (always shown)
    var newSection = document.createElement('div');
    newSection.className = 'pp-new-comment';

    var input = document.createElement('textarea');
    input.className = 'pp-pop-input';
    input.placeholder = isEdit ? 'Add another comment' : 'Add a comment';
    input.setAttribute('aria-label', 'New comment');
    input.rows = 1;
    newSection.appendChild(input);

    function autoGrow() {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';
    }
    input.addEventListener('input', autoGrow);

    var btnRow = document.createElement('div');
    btnRow.className = 'pp-pop-btns';

    var submit = document.createElement('button');
    submit.className = 'pp-pop-btn pp-pop-submit';
    submit.title = 'Add';
    submit.setAttribute('aria-label', 'Add');
    submit.innerHTML = ico.arrowUp;
    submit.disabled = true;

    function sync() {
      var on = input.value.trim().length > 0;
      submit.classList.toggle('pp-submit-on', on);
      submit.disabled = !on;
    }
    input.addEventListener('input', sync);

    submit.addEventListener('click', function (e) {
      e.stopPropagation();
      commit();
    });
    btnRow.appendChild(submit);
    newSection.appendChild(btnRow);

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hidePopover(); hideOverlay(); }
      e.stopPropagation();
    });

    pop.appendChild(newSection);

    function commit() {
      var text = input.value.trim();
      if (!text) return;
      addAnnotation(el, text);
      hidePopover();
      hideOverlay();
    }

    root.appendChild(pop);
    popover = pop;
    positionPop(el, pop);
    requestAnimationFrame(function () { input.focus(); });
    if (ann) showNavPill(ann);
  }

  function hidePopover() {
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

    if (!ann.el || !ann.el.isConnected) return;

    var r = ann.el.getBoundingClientRect();
    var inView = r.top >= 0 && r.bottom <= window.innerHeight;
    if (inView) {
      showOverlay(ann.el);
      showPopover(ann.el, ann);
    } else {
      ann.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var settled = 0;
      var lastY = ann.el.getBoundingClientRect().top;
      var frameCount = 0;
      function waitNav() {
        frameCount++;
        if (!ann.el.isConnected || frameCount > 60) return;
        var curY = ann.el.getBoundingClientRect().top;
        if (Math.abs(curY - lastY) < 1) {
          settled++;
          if (settled >= 3) {
            showOverlay(ann.el);
            showPopover(ann.el, ann);
            return;
          }
        } else {
          settled = 0;
        }
        lastY = curY;
        requestAnimationFrame(waitNav);
      }
      requestAnimationFrame(waitNav);
    }
  }

  function positionPop(el, pop) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight;
    var visTop = Math.max(0, r.top);
    var visBottom = Math.min(vh, r.bottom);
    var above = visBottom > vh * 0.6;

    if (above) {
      var bottomVal = vh - visTop + 10;
      if (bottomVal > vh - 8) {
        pop.style.top = '8px';
        pop.style.bottom = 'auto';
      } else {
        pop.style.bottom = bottomVal + 'px';
        pop.style.top = 'auto';
      }
    } else {
      pop.style.top = Math.min(visBottom + 10, vh - 80) + 'px';
      pop.style.bottom = 'auto';
    }

    var left = r.left + r.width / 2 - 160;
    left = Math.max(8, Math.min(left, window.innerWidth - 328));
    pop.style.left = left + 'px';
  }

  /* ── annotations & pins ────────────────────────────────── */
  function addAnnotation(el, comment) {
    var ann = {
      id: nextId++,
      el: el,
      selector: buildSelector(el),
      type: typeName(el),
      comment: comment,
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
    hideOverlay();
    saveUndoState();
    annotations.forEach(function (a) { if (a.pinEl) a.pinEl.remove(); });
    annotations = [];
    nextId = 1;
    persist();
    updateCount();
    showToast(count + ' annotation' + (count !== 1 ? 's' : '') + ' deleted');
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

    if (ann.orphaned) {
      pin.classList.add('pp-pin-orphaned');
      pin.title = 'Element not found';
    }

    pinLayer.appendChild(pin);
    ann.pinEl = pin;
    positionPin(ann);

    if (!ann.orphaned) {
      adaptPinTheme(ann);
    }

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

      if (!ann.el.isConnected) return;

      var r = ann.el.getBoundingClientRect();
      var inView = r.top >= 0 && r.bottom <= window.innerHeight;

      if (inView) {
        showOverlay(ann.el);
        showPopover(ann.el, ann);
      } else {
        ann.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        var settled = 0;
        var lastY = ann.el.getBoundingClientRect().top;
        var frameCount = 0;
        function waitForScroll() {
          frameCount++;
          if (!ann.el.isConnected || frameCount > 60) return;
          var curY = ann.el.getBoundingClientRect().top;
          if (Math.abs(curY - lastY) < 1) {
            settled++;
            if (settled >= 3) {
              showOverlay(ann.el);
              showPopover(ann.el, ann);
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
    if (!ann.el || !ann.el.isConnected) { ann.pinEl.style.display = 'none'; return; }
    var r = ann.el.getBoundingClientRect();
    var inView = r.bottom > 0 && r.top < window.innerHeight &&
                 r.right > 0 && r.left < window.innerWidth;
    ann.pinEl.style.display = inView ? 'flex' : 'none';
    if (inView) {
      // Clamp pin to stay fully visible within viewport
      var top = Math.max(2, Math.min(r.top - 11, window.innerHeight - 28));
      var left = Math.max(2, Math.min(r.right - 11, window.innerWidth - 28));
      ann.pinEl.style.top = top + 'px';
      ann.pinEl.style.left = left + 'px';
    }
  }

  function refreshAll() {
    annotations.forEach(positionPin);
    if (popover && popoverTarget) {
      positionPop(popoverTarget, popover);
      showOverlay(popoverTarget);
    } else if (commenting && lastMouseX >= 0) {
      var el = document.elementFromPoint(lastMouseX, lastMouseY);
      if (el && !isSkippable(el) && !isOurUI(el)) {
        hovered = el;
        showOverlay(el);
      } else {
        hideOverlay();
      }
    }
  }

  /* ── undo system (#4) ──────────────────────────────────── */
  function saveUndoState() {
    undoData = {
      items: annotations.map(function (a) {
        return { id: a.id, el: a.el, selector: a.selector, type: a.type, comment: a.comment, orphaned: !!a.orphaned };
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
      if (!item.el || !item.el.isConnected) {
        // Restore orphaned annotations too
        if (item.selector) {
          var orphan = {
            id: item.id, el: null, selector: item.selector,
            type: item.type, comment: item.comment, pinEl: null,
            orphaned: true,
          };
          annotations.push(orphan);
          createPin(orphan);
        }
        return;
      }
      var ann = {
        id: item.id, el: item.el, selector: item.selector,
        type: item.type, comment: item.comment, pinEl: null,
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

  /* ── copy ──────────────────────────────────────────────── */
  function formatMarkdown() {
    var lines = [
      'Design Review - ' + document.title,
      'URL: ' + location.href,
      'Viewport: ' + window.innerWidth + '\u00d7' + window.innerHeight, '',
    ];
    annotations.forEach(function (ann) {
      lines.push(ann.id + '. [' + ann.type + '] ' + ann.selector);
      if (ann.orphaned) {
        lines.push('   (Element not found)');
        lines.push('   Comment: ' + ann.comment);
        lines.push('');
        return;
      }
      var trail = getAncestorTrail(ann.el);
      if (trail) lines.push('   In: ' + trail);
      var tag = getCleanTag(ann.el);
      if (tag) lines.push('   HTML: ' + tag);
      var text = getTextPreview(ann.el);
      if (text) lines.push('   Text: "' + text + '"');
      lines.push('   Comment: ' + ann.comment);
      lines.push('');
    });
    return lines.join('\n');
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
      hideOverlay();
      annotations.forEach(function (a) { if (a.pinEl) a.pinEl.remove(); });
      annotations = [];
      nextId = 1;
      persist();
      updateCount();
    }, function () {
      shakeBtn(btnSend);
      // restore since copy failed
      undo();
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

  function persist() {
    var data = {
      nextId: nextId,
      _lastAccess: Date.now(),
      items: annotations.map(function (a) {
        return { id: a.id, selector: a.selector, type: a.type, comment: a.comment };
      }),
    };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      pruneOldEntries();
    } catch (e) { /* full */ }
  }

  function pruneOldEntries() {
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('pinpoint:') === 0) keys.push(k);
      }
    } catch (e) { return; }
    if (keys.length <= LRU_MAX_KEYS) return;
    var entries = [];
    keys.forEach(function (k) {
      try {
        var raw = localStorage.getItem(k);
        var parsed = raw ? JSON.parse(raw) : null;
        var ts = parsed && parsed._lastAccess ? parsed._lastAccess : 0;
        entries.push({ key: k, ts: ts });
      } catch (e) { entries.push({ key: k, ts: 0 }); }
    });
    entries.sort(function (a, b) { return a.ts - b.ts; });
    var toRemove = entries.length - LRU_MAX_KEYS;
    for (var j = 0; j < toRemove; j++) {
      if (entries[j].key !== STORE_KEY) {
        try { localStorage.removeItem(entries[j].key); } catch (e) { /* */ }
      }
    }
  }

  function restore() {
    var orphanCount = 0;
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      nextId = data.nextId || 1;
      (data.items || []).forEach(function (item) {
        var el;
        try { el = document.querySelector(item.selector); } catch (e) { el = null; }
        if (!el) {
          var orphan = {
            id: item.id, el: null, selector: item.selector,
            type: item.type, comment: item.comment, pinEl: null,
            orphaned: true,
          };
          annotations.push(orphan);
          createPin(orphan);
          orphanCount++;
          return;
        }
        var ann = {
          id: item.id, el: el, selector: item.selector,
          type: item.type, comment: item.comment, pinEl: null,
        };
        annotations.push(ann);
        createPin(ann);
      });
    } catch (e) { /* corrupt */ }
    updateCount();
    if (orphanCount > 0) {
      setTimeout(function () {
        showToast(orphanCount + ' annotation' + (orphanCount !== 1 ? 's' : '') + ' couldn\'t find their elements');
      }, 400);
    }
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
    if (el.id && !/\s/.test(el.id)) return '#' + cssEsc(el.id);

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
      if (cur.id && !/\s/.test(cur.id)) { path.unshift('#' + cssEsc(cur.id)); break; }
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

    // Distance to our accent orange (#d4620e = 212,98,14)
    var dr = rgb.r - 212, dg = rgb.g - 98, db = rgb.b - 14;
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

  document.addEventListener('mousemove', function (e) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (!active || !commenting || popover) return;
    if (isOurUI(e.target)) { hideOverlay(); return; }
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (isSkippable(el)) { hideOverlay(); return; }
    if (el !== hovered) { hovered = el; showOverlay(el); }
  }, true);

  // Click — annotate or close popover (#1: works in ANY mode now)
  document.addEventListener('click', function (e) {
    if (!active) return;
    if (!menuPanel.classList.contains('pp-hidden') &&
        !menuPanel.contains(e.target) &&
        !btnShortcuts.contains(e.target)) {
      hideMenu();
    }
    if (isOurUI(e.target)) return;

    // Close popover on any outside click, regardless of comment mode (#1)
    if (popover) {
      hidePopover();
      hideOverlay();
      if (commenting) { e.preventDefault(); e.stopPropagation(); }
      return;
    }

    if (commenting) {
      e.preventDefault();
      e.stopPropagation();
      if (hovered && !isSkippable(hovered)) showPopover(hovered);
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
      if (e.key === 'Escape' && popover) { hidePopover(); hideOverlay(); }
      return;
    }

    var k = e.key.toLowerCase();

    if (e.key === 'Escape') {
      if (!menuPanel.classList.contains('pp-hidden')) { hideMenu(); return; }
      if (commenting) stopCommenting();
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
        showPopover(hovered);
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
  var currentHash = location.hash;

  function onNavChange() {
    var newPath = location.pathname;
    var newHash = location.hash;
    if (newPath === currentPath && newHash === currentHash) return;
    currentPath = newPath;
    currentHash = newHash;
    STORE_KEY = 'pinpoint:' + location.origin + location.pathname + location.hash;
    annotations.forEach(function (a) { if (a.pinEl) a.pinEl.remove(); });
    annotations = [];
    nextId = 1;
    hidePopover();
    hideOverlay();
    clearUndoState();
    restore();
  }

  var _pushState = history.pushState;
  var _replaceState = history.replaceState;
  history.pushState = function () { _pushState.apply(this, arguments); onNavChange(); };
  history.replaceState = function () { _replaceState.apply(this, arguments); onNavChange(); };
  window.addEventListener('popstate', onNavChange);
  window.addEventListener('hashchange', onNavChange);

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
    chrome.storage.local.set({ keyNavEnabled: keyNavEnabled });
  });

  // Stop clicks inside menu from propagating (prevents toolbar close)
  menuPanel.addEventListener('click', function (e) { e.stopPropagation(); });

  // Restore settings
  chrome.storage.local.get('keyNavEnabled', function (data) {
    keyNavEnabled = data.keyNavEnabled !== undefined ? !!data.keyNavEnabled : true;
    keyNavToggle.checked = keyNavEnabled;
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
    barTip.style.left = Math.max(8, br.left + br.width / 2 - tw / 2) + 'px';
    barTip.style.top = (br.top - th - 10) + 'px';
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
  function isDevHost() {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
           h === '[::1]' || h.endsWith('.local') || h.endsWith('.localhost');
  }

  /* ── site disable/enable ────────────────────────────────── */
  chrome.storage.local.get(['disabledHosts', 'devOnly'], function (data) {
    var list = data.disabledHosts || [];
    var devOnly = !!data.devOnly;
    if (list.indexOf(location.hostname) !== -1 || (devOnly && !isDevHost())) {
      toggle.classList.add('pp-hidden');
    }
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.type === 'agimut-toggle') {
      if (msg.enabled) {
        toggle.classList.remove('pp-hidden');
      } else {
        if (active) deactivate();
        toggle.classList.add('pp-hidden');
      }
    }
    if (msg.type === 'agimut-devonly') {
      if (msg.devOnly && !isDevHost()) {
        if (active) deactivate();
        toggle.classList.add('pp-hidden');
      } else {
        chrome.storage.local.get('disabledHosts', function (data) {
          var list = data.disabledHosts || [];
          if (list.indexOf(location.hostname) === -1) {
            toggle.classList.remove('pp-hidden');
          }
        });
      }
    }
  });

  /* ── init ──────────────────────────────────────────────── */
  pinLayer.classList.add('pp-hidden');
  restore();
})();
