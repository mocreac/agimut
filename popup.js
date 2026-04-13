(function () {
  var toggle = document.getElementById('toggle');
  var devToggle = document.getElementById('devonly');
  var siteEl = document.getElementById('site');
  var row = document.querySelector('.row');
  var hostname = '';

  // NOTE: This function is duplicated in content.js (which reads location.hostname directly).
  // Popup and content script run in separate JS contexts and cannot share code
  // without a build step. Keep both in sync manually.
  function isDevHost(host) {
    return host === 'localhost' ||
           host === '127.0.0.1' ||
           host === '0.0.0.0' ||
           host === '[::1]' ||
           host.endsWith('.local') ||
           host.endsWith('.localhost');
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs[0];
    if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
      siteEl.textContent = 'Not available on this page';
      row.classList.add('unavailable');
      toggle.checked = false;
      return;
    }

    hostname = new URL(tab.url).hostname;
    siteEl.textContent = hostname;

    chrome.storage.local.get(['disabledHosts', 'devOnly'], function (data) {
      var disabled = data.disabledHosts || [];
      var devOnly = !!data.devOnly;
      devToggle.checked = devOnly;

      if (devOnly && !isDevHost(hostname)) {
        toggle.checked = false;
        row.classList.add('unavailable');
        siteEl.textContent = 'Dev environments only';
      } else {
        toggle.checked = disabled.indexOf(hostname) === -1;
      }
    });
  });

  // Also load devOnly for non-HTTP pages where hostname isn't set
  chrome.storage.local.get('devOnly', function (data) {
    devToggle.checked = !!data.devOnly;
  });

  toggle.addEventListener('change', function () {
    if (!hostname) return;
    var enabled = toggle.checked;

    chrome.storage.local.get('disabledHosts', function (data) {
      var disabled = data.disabledHosts || [];
      var idx = disabled.indexOf(hostname);

      if (enabled && idx !== -1) disabled.splice(idx, 1);
      else if (!enabled && idx === -1) disabled.push(hostname);

      chrome.storage.local.set({ disabledHosts: disabled }, function () {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'agimut-toggle',
              enabled: enabled,
            }).catch(function () { /* content script not loaded */ });
          }
        });
      });
    });
  });

  devToggle.addEventListener('change', function () {
    var devOnly = devToggle.checked;
    chrome.storage.local.set({ devOnly: devOnly }, function () {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'agimut-devonly',
            devOnly: devOnly,
          }).catch(function () { /* content script not loaded */ });
        }
      });

      if (hostname) {
        if (devOnly && !isDevHost(hostname)) {
          toggle.checked = false;
          row.classList.add('unavailable');
          siteEl.textContent = 'Dev environments only';
        } else {
          row.classList.remove('unavailable');
          siteEl.textContent = hostname;
          chrome.storage.local.get('disabledHosts', function (data) {
            var disabled = data.disabledHosts || [];
            toggle.checked = disabled.indexOf(hostname) === -1;
          });
        }
      }
    });
  });
})();
