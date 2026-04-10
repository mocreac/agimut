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

  /* ── undo state ────────────────────────────────────────── */
  var undoData = null;   // { items: [...], nextId }
  var undoTimer = null;

  /* ── flash timer tracking (issue #9) ───────────────────── */
  var flashTimers = new Map();

  /* ── persistence key ───────────────────────────────────── */
  var STORE_KEY = 'pinpoint:' + location.origin + location.pathname;

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
  };

  var logoSvg = '<svg width="22" height="18" viewBox="0 0 319 260" fill="currentColor"><path d="M112.506 10.5C112.506 4.70102 117.207 8.24649e-06 123.006 0C128.805 0 133.506 4.70101 133.506 10.5V187.303L190.288 51.8965C197.377 34.992 213.917 23.9922 232.248 23.9922H308.132C313.931 23.9922 318.632 28.6932 318.632 34.4922C318.632 40.2911 313.931 44.9922 308.132 44.9922H232.248C222.377 44.9922 213.471 50.9152 209.654 60.0176L126.168 259.104L2.58373 117.271C-1.22584 112.898 -0.769813 106.267 3.60229 102.457C7.97441 98.6475 14.6062 99.1035 18.4158 103.476L112.506 211.459V10.5Z"/></svg>';

  /* ── DOM scaffolding ───────────────────────────────────── */
  var root = document.createElement('div');
  root.id = 'pinpoint-root';
  document.documentElement.appendChild(root);

  var overlay = document.createElement('div');
  overlay.className = 'pp-overlay';
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
    '<button class="pp-bar-btn pp-btn-comment" title="Comment \u00b7 C">' + ico.chat + '</button>' +
    '<span class="pp-count pp-hidden"></span>' +
    '<div class="pp-bar-sep"></div>' +
    '<button class="pp-bar-btn pp-btn-copy" title="Copy all \u00b7 A">' + ico.copy + '</button>' +
    '<button class="pp-bar-btn pp-btn-send" title="Copy & clear \u00b7 Shift+A">' + ico.send + '</button>' +
    '<div class="pp-bar-sep"></div>' +
    '<button class="pp-bar-btn pp-btn-delete" title="Delete all \u00b7 XXX">' + ico.trash + '</button>' +
    '<div class="pp-bar-sep"></div>' +
    '<button class="pp-bar-btn pp-btn-close" title="Close \u00b7 Esc">' + ico.close + '</button>';
  root.appendChild(bar);

  var toggle = document.createElement('button');
  toggle.className = 'pp-toggle';
  toggle.title = 'Feedpin';
  toggle.innerHTML = logoSvg;
  root.appendChild(toggle);

  /* ── button refs ───────────────────────────────────────── */
  var btnComment = bar.querySelector('.pp-btn-comment');
  var btnCopy    = bar.querySelector('.pp-btn-copy');
  var btnSend    = bar.querySelector('.pp-btn-send');
  var btnDelete  = bar.querySelector('.pp-btn-delete');
  var btnClose   = bar.querySelector('.pp-btn-close');
  var countEl    = bar.querySelector('.pp-count');

  /* ── activate / deactivate ─────────────────────────────── */
  function activate() {
    active = true;
    toggle.classList.add('pp-hidden');
    bar.classList.remove('pp-hidden');
    pinLayer.classList.remove('pp-hidden');
    startCommenting();
  }

  function deactivate() {
    active = false;
    stopCommenting();
    hidePopover();
    hideOverlay();
    clearUndoState();
    toggle.classList.remove('pp-hidden');
    bar.classList.add('pp-hidden');
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
    } else {
      countEl.classList.add('pp-hidden');
    }
  }

  /* ── hover overlay ─────────────────────────────────────── */
  function showOverlay(el) {
    var r = el.getBoundingClientRect();
    overlay.style.top = r.top + 'px';
    overlay.style.left = r.left + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
    overlay.classList.add('pp-on');

    var name = typeName(el);
    var text = (el.textContent || '').trim();
    var preview = text.length > 35 ? text.slice(0, 35) + '\u2026' : text;
    tip.textContent = name + (preview ? ': ' + preview : '');

    // Clamp tooltip to viewport (#8)
    var tipLeft = r.left;
    var tipRight = tipLeft + 280;
    if (tipRight > window.innerWidth - 8) {
      tipLeft = Math.max(8, window.innerWidth - 288);
    }
    tip.style.left = Math.max(8, tipLeft) + 'px';
    tip.style.top = (r.top > 30 ? r.top - 26 : r.bottom + 4) + 'px';
    tip.classList.add('pp-on');
  }

  function hideOverlay() {
    overlay.classList.remove('pp-on');
    tip.classList.remove('pp-on');
    hovered = null;
  }

  /* ── popover ───────────────────────────────────────────── */
  function showPopover(el, ann) {
    hidePopover();
    editingAnn = ann || null;
    popoverTarget = el;
    var isEdit = !!ann;

    var pop = document.createElement('div');
    pop.className = 'pp-popover';

    var input = document.createElement('textarea');
    input.className = 'pp-pop-input';
    input.placeholder = 'Add a comment';
    input.rows = 1;
    if (isEdit) input.value = ann.comment;
    pop.appendChild(input);

    function autoGrow() {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';
    }
    input.addEventListener('input', autoGrow);

    var btnRow = document.createElement('div');
    btnRow.className = 'pp-pop-btns';

    if (isEdit) {
      var del = document.createElement('button');
      del.className = 'pp-pop-btn pp-pop-delete';
      del.title = 'Delete';
      del.innerHTML = ico.trashSm;
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteAnnotation(ann.id);
        hidePopover();
        hideOverlay();
      });
      btnRow.appendChild(del);
    }

    var submit = document.createElement('button');
    submit.className = 'pp-pop-btn pp-pop-submit';
    submit.title = isEdit ? 'Save' : 'Add';
    submit.innerHTML = ico.arrowUp;
    submit.disabled = true;

    function sync() {
      var on = input.value.trim().length > 0;
      submit.classList.toggle('pp-submit-on', on);
      submit.disabled = !on;
    }
    input.addEventListener('input', sync);
    sync();

    submit.addEventListener('click', function (e) {
      e.stopPropagation();
      commit();
    });
    btnRow.appendChild(submit);
    pop.appendChild(btnRow);

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hidePopover(); hideOverlay(); }
      e.stopPropagation();
    });

    requestAnimationFrame(autoGrow);

    function commit() {
      var text = input.value.trim();
      if (!text) return;
      if (isEdit) {
        ann.comment = text;
        persist();
      } else {
        addAnnotation(el, text);
      }
      hidePopover();
      hideOverlay();
    }

    root.appendChild(pop);
    popover = pop;
    positionPop(el, pop);
    requestAnimationFrame(function () { input.focus(); });
  }

  function hidePopover() {
    if (popover) {
      popover.remove();
      popover = null;
      popoverTarget = null;
      editingAnn = null;
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
    persist();
    updateCount();
  }

  function deleteAll() {
    if (annotations.length === 0) { shakeBtn(btnDelete); return; }
    saveUndoState();
    annotations.forEach(function (a) { if (a.pinEl) a.pinEl.remove(); });
    annotations = [];
    nextId = 1;
    persist();
    updateCount();
  }

  function createPin(ann) {
    var pin = document.createElement('div');
    pin.className = 'pp-pin';
    if (ann.id >= 100) pin.classList.add('pp-pin-xs');
    else if (ann.id >= 10) pin.classList.add('pp-pin-sm');
    pin.textContent = ann.id;
    pinLayer.appendChild(pin);
    ann.pinEl = pin;
    positionPin(ann);

    pin.addEventListener('click', function (e) {
      e.stopPropagation();
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
        function waitForScroll() {
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
    if (!ann.el.isConnected) { ann.pinEl.style.display = 'none'; return; }
    var r = ann.el.getBoundingClientRect();
    var inView = r.bottom > 0 && r.top < window.innerHeight &&
                 r.right > 0 && r.left < window.innerWidth;
    ann.pinEl.style.display = inView ? 'flex' : 'none';
    if (inView) {
      ann.pinEl.style.top = (r.top - 11) + 'px';
      ann.pinEl.style.left = (r.right - 11) + 'px';
    }
  }

  function refreshAll() {
    annotations.forEach(positionPin);
    if (popover && popoverTarget) {
      positionPop(popoverTarget, popover);
      showOverlay(popoverTarget);
    }
  }

  /* ── undo system (#4) ──────────────────────────────────── */
  function saveUndoState() {
    undoData = {
      items: annotations.map(function (a) {
        return { id: a.id, el: a.el, selector: a.selector, type: a.type, comment: a.comment };
      }),
      nextId: nextId,
    };
    btnDelete.innerHTML = ico.undo;
    btnDelete.classList.add('pp-undo-btn');
    btnDelete.title = 'Undo \u00b7 Z';
    clearTimeout(undoTimer);
    undoTimer = setTimeout(clearUndoState, 5000);
  }

  function clearUndoState() {
    undoData = null;
    clearTimeout(undoTimer);
    undoTimer = null;
    btnDelete.innerHTML = ico.trash;
    btnDelete.classList.remove('pp-undo-btn');
    btnDelete.title = 'Delete all \u00b7 XXX';
  }

  function undo() {
    if (!undoData) return;
    var items = undoData.items;
    var savedNextId = undoData.nextId;
    clearUndoState();
    items.forEach(function (item) {
      if (!item.el || !item.el.isConnected) return;
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

  /* ── element snapshots for export ────────────────────────── */
  function getOpeningTag(el) {
    if (!el.isConnected) return '';
    var html = el.cloneNode(false).outerHTML;
    var tag = el.tagName.toLowerCase();
    var closeTag = '</' + tag + '>';
    if (html.endsWith(closeTag)) html = html.slice(0, -closeTag.length);
    return html.length > 200 ? html.slice(0, 200) + '...' : html;
  }

  function getTextPreview(el) {
    var text = (el.textContent || '').trim();
    if (!text) return '';
    return text.length > 50 ? text.slice(0, 50) + '\u2026' : text;
  }

  /* ── copy ──────────────────────────────────────────────── */
  function formatMarkdown() {
    var lines = [
      'Design Review - ' + document.title,
      'URL: ' + location.href, '',
    ];
    annotations.forEach(function (ann) {
      lines.push(ann.id + '. Element: ' + ann.selector + ' (' + ann.type + ')');
      var tag = getOpeningTag(ann.el);
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
    navigator.clipboard.writeText(formatMarkdown()).then(
      function () { flashBtn(btnCopy, ico.copy); },
      function () { shakeBtn(btnCopy); }
    );
  }

  function copyAndClear() {
    if (annotations.length === 0) { shakeBtn(btnSend); return; }
    var md = formatMarkdown();
    saveUndoState();
    navigator.clipboard.writeText(md).then(function () {
      flashBtn(btnSend, ico.send);
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
  function persist() {
    var data = {
      nextId: nextId,
      items: annotations.map(function (a) {
        return { id: a.id, selector: a.selector, type: a.type, comment: a.comment };
      }),
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* full */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      nextId = data.nextId || 1;
      (data.items || []).forEach(function (item) {
        var el;
        try { el = document.querySelector(item.selector); } catch (e) { return; }
        if (!el) return;
        var ann = {
          id: item.id, el: el, selector: item.selector,
          type: item.type, comment: item.comment, pinEl: null,
        };
        annotations.push(ann);
        createPin(ann);
      });
    } catch (e) { /* corrupt */ }
    updateCount();
  }

  /* ── selector builder (#12 — filter generated classes) ─── */
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
  document.addEventListener('mousemove', function (e) {
    if (!active || !commenting || popover) return;
    if (isOurUI(e.target)) { hideOverlay(); return; }
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (isSkippable(el)) { hideOverlay(); return; }
    if (el !== hovered) { hovered = el; showOverlay(el); }
  }, true);

  // Click — annotate or close popover (#1: works in ANY mode now)
  document.addEventListener('click', function (e) {
    if (!active) return;
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

  document.addEventListener('keydown', function (e) {
    if (!active) return;
    if (popover || inputFocused()) {
      if (e.key === 'Escape' && popover) { hidePopover(); hideOverlay(); }
      return;
    }

    var k = e.key.toLowerCase();

    if (e.key === 'Escape') {
      if (commenting) stopCommenting();
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;

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
  window.addEventListener('scroll', refreshAll, true);
  window.addEventListener('resize', refreshAll);

  /* ── SPA navigation detection (#11) ────────────────────── */
  var currentPath = location.pathname;

  function onNavChange() {
    if (location.pathname === currentPath) return;
    currentPath = location.pathname;
    STORE_KEY = 'pinpoint:' + location.origin + location.pathname;
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

  /* ── toolbar wiring ────────────────────────────────────── */
  btnComment.addEventListener('click', function (e) { e.stopPropagation(); commenting ? stopCommenting() : startCommenting(); });
  btnCopy.addEventListener('click', function (e) { e.stopPropagation(); copyAll(); });
  btnSend.addEventListener('click', function (e) { e.stopPropagation(); copyAndClear(); });
  btnDelete.addEventListener('click', function (e) {
    e.stopPropagation();
    if (undoData) undo(); else deleteAll();
  });
  btnClose.addEventListener('click', function (e) { e.stopPropagation(); deactivate(); });
  toggle.addEventListener('click', function (e) { e.stopPropagation(); activate(); });

  /* ── dev-only helper ─────────────────────────────────────── */
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
    if (msg.type === 'feedpin-toggle') {
      if (msg.enabled) {
        toggle.classList.remove('pp-hidden');
      } else {
        if (active) deactivate();
        toggle.classList.add('pp-hidden');
      }
    }
    if (msg.type === 'feedpin-devonly') {
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
