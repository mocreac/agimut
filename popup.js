(function () {
  var toggle = document.getElementById('toggle');
  var devToggle = document.getElementById('devonly');
  var themeToggle = document.getElementById('theme-toggle');
  var siteEl = document.getElementById('site');
  var row = document.querySelector('.row');
  var positionGroup = document.getElementById('position-group');
  var positionButtons = document.querySelectorAll('[data-position-value]');
  var externalLinks = document.querySelectorAll('[data-url]');
  var siteKey = '';
  var isLocalHtml = false;
  var theme = 'dark';
  var toolbarPosition = 'bottom-left';
  var VALID_POSITIONS = {
    'top-left': true,
    'top-right': true,
    'bottom-left': true,
    'bottom-right': true,
  };

  function isDevHost(host) {
    return host === 'localhost' ||
           host === '127.0.0.1' ||
           host === '0.0.0.0' ||
           host === '[::1]' ||
           host.endsWith('.local') ||
           host.endsWith('.localhost');
  }

  function isLocalHtmlUrl(url) {
    return /^file:/i.test(url) && /\.html?(?:$|[?#])/i.test(url);
  }

  function getSiteKey(tabUrl) {
    if (isLocalHtmlUrl(tabUrl)) return 'file://local-html';
    return new URL(tabUrl).hostname;
  }

  function getSiteLabel(tabUrl) {
    if (isLocalHtmlUrl(tabUrl)) return 'Local HTML file';
    return new URL(tabUrl).hostname;
  }

  function setActive(buttons, attr, value) {
    buttons.forEach(function (button) {
      button.classList.toggle('is-active', button.getAttribute(attr) === value);
    });
    if (positionGroup) positionGroup.setAttribute('data-position', value);
  }

  function applyTheme(nextTheme) {
    document.body.setAttribute('data-theme', nextTheme);
  }

  function normalizeToolbarPosition(value) {
    if (VALID_POSITIONS[value]) return value;
    if (value === 'top-center') return 'top-left';
    if (value === 'bottom-center') return 'bottom-left';
    return 'bottom-left';
  }

  function sendToActiveTab(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, message).catch(function () { /* content script not loaded */ });
      }
    });
  }

  function openExternalUrl(url) {
    if (!url) return;
    chrome.tabs.create({ url: url });
  }

  chrome.storage.local.get(['disabledHosts', 'devOnly', 'theme', 'toolbarPosition'], function (data) {
    var hasStoredTheme = data.theme === 'light' || data.theme === 'dark';
    theme = data.theme === 'light' ? 'light' : 'dark';
    toolbarPosition = normalizeToolbarPosition(data.toolbarPosition);
    applyTheme(theme);
    themeToggle.checked = theme === 'dark';
    setActive(positionButtons, 'data-position-value', toolbarPosition);

    if (!hasStoredTheme) {
      chrome.storage.local.set({ theme: 'dark' });
    }

    if (data.toolbarPosition !== toolbarPosition) {
      chrome.storage.local.set({ toolbarPosition: toolbarPosition }, function () {
        sendToActiveTab({
          type: 'agimut-settings',
          toolbarPosition: toolbarPosition,
        });
      });
    }

    var disabled = data.disabledHosts || [];
    var devOnly = !!data.devOnly;
    devToggle.checked = devOnly;

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs[0];
      if (!tab || !tab.url || (!/^https?:/.test(tab.url) && !isLocalHtmlUrl(tab.url))) {
        siteEl.textContent = 'Not available on this page';
        row.classList.add('unavailable');
        toggle.checked = false;
        return;
      }

      siteKey = getSiteKey(tab.url);
      isLocalHtml = isLocalHtmlUrl(tab.url);
      siteEl.textContent = getSiteLabel(tab.url);

      if (isLocalHtml && !devOnly) {
        toggle.checked = false;
        row.classList.add('unavailable');
        siteEl.textContent = 'Local HTML (Dev only)';
      } else if (devOnly && !isLocalHtml && !isDevHost(siteKey)) {
        toggle.checked = false;
        row.classList.add('unavailable');
        siteEl.textContent = 'Dev environments only';
      } else {
        row.classList.remove('unavailable');
        toggle.checked = disabled.indexOf(siteKey) === -1;
      }
    });
  });

  toggle.addEventListener('change', function () {
    if (!siteKey) return;
    var enabled = toggle.checked;

    chrome.storage.local.get('disabledHosts', function (data) {
      var disabled = data.disabledHosts || [];
      var idx = disabled.indexOf(siteKey);

      if (enabled && idx !== -1) disabled.splice(idx, 1);
      else if (!enabled && idx === -1) disabled.push(siteKey);

      chrome.storage.local.set({ disabledHosts: disabled }, function () {
        sendToActiveTab({
          type: 'agimut-toggle',
          enabled: enabled,
        });
      });
    });
  });

  devToggle.addEventListener('change', function () {
    var devOnly = devToggle.checked;
    chrome.storage.local.set({ devOnly: devOnly }, function () {
      sendToActiveTab({
        type: 'agimut-devonly',
        devOnly: devOnly,
      });

      if (!siteKey) return;

      if (isLocalHtml && !devOnly) {
        toggle.checked = false;
        row.classList.add('unavailable');
        siteEl.textContent = 'Local HTML (Dev only)';
        return;
      }

      if (devOnly && !isLocalHtml && !isDevHost(siteKey)) {
        toggle.checked = false;
        row.classList.add('unavailable');
        siteEl.textContent = 'Dev environments only';
        return;
      }

      row.classList.remove('unavailable');
      siteEl.textContent = isLocalHtml ? 'Local HTML file' : siteKey;
      chrome.storage.local.get('disabledHosts', function (data) {
        var disabled = data.disabledHosts || [];
        toggle.checked = disabled.indexOf(siteKey) === -1;
      });
    });
  });

  themeToggle.addEventListener('change', function () {
    theme = themeToggle.checked ? 'dark' : 'light';
    applyTheme(theme);
    chrome.storage.local.set({ theme: theme }, function () {
      sendToActiveTab({
        type: 'agimut-settings',
        theme: theme,
      });
    });
  });

  positionButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      toolbarPosition = button.getAttribute('data-position-value');
      setActive(positionButtons, 'data-position-value', toolbarPosition);
      chrome.storage.local.set({ toolbarPosition: toolbarPosition }, function () {
        sendToActiveTab({
          type: 'agimut-settings',
          toolbarPosition: toolbarPosition,
        });
      });
    });
  });

  // Optional local plugin settings (private/popup.js, never shipped).
  import('./private/popup.js').then(function (mod) {
    if (mod && typeof mod.default === 'function') mod.default(document);
  }, function () { /* no plugin installed */ });

  externalLinks.forEach(function (button) {
    button.addEventListener('click', function () {
      openExternalUrl(button.getAttribute('data-url'));
    });
  });
})();
