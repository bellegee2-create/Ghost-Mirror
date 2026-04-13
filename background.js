// background.js — Ghost Mirror v4.8
let mirrorTabId = null;
let claudeTabId = null;
let pendingSync = null;

browser.browserAction.onClicked.addListener((tab) => {
  if (!tab.url || !tab.url.includes("claude.ai")) return;
  claudeTabId = tab.id;
  if (mirrorTabId !== null) {
    browser.tabs.get(mirrorTabId)
      .then(t => { browser.tabs.update(mirrorTabId, { active: true }); browser.windows.update(t.windowId, { focused: true }); })
      .catch(() => { mirrorTabId = null; openMirror(); });
    return;
  }
  openMirror();
});

function openMirror() {
  browser.tabs.create({ url: browser.runtime.getURL('mirror.html'), active: false })
    .then(tab => { mirrorTabId = tab.id; })
    .catch(err => console.error("Ghost Mirror: open failed:", err));
}

function sendToMirror(payload) {
  if (mirrorTabId === null) return;
  browser.tabs.sendMessage(mirrorTabId, { type: 'SYNC', payload })
    .then(() => { pendingSync = null; })
    .catch(() => { pendingSync = payload; setTimeout(() => { if (pendingSync) sendToMirror(pendingSync); }, 500); });
}

browser.runtime.onMessage.addListener((message) => {

  if (message.type === 'REQUEST_SYNC') {
    if (claudeTabId !== null)
      browser.tabs.sendMessage(claudeTabId, { type: 'REQUEST_SYNC' }).catch(() => {});
  }

  if (message.type === 'SYNC') {
    pendingSync = message.payload;
    sendToMirror(message.payload);
  }

  if (message.type === 'SCROLL_TO') {
    if (claudeTabId !== null) {
      browser.tabs.get(claudeTabId)
        .then(t => {
          browser.windows.update(t.windowId, { focused: true });
          browser.tabs.update(claudeTabId, { active: true });
          return browser.tabs.sendMessage(claudeTabId, { type: 'SCROLL_TO', idx: message.idx });
        }).catch(() => {});
    }
  }

  // Forward CLICK_DOWNLOAD from mirror → claude tab (no focus change)
  if (message.type === 'CLICK_DOWNLOAD') {
    if (claudeTabId !== null) {
      browser.tabs.sendMessage(claudeTabId, {
        type: 'CLICK_DOWNLOAD',
        idx: message.idx,
        filename: message.filename
      }).catch(() => {});
    }
  }

  // Forward DOWNLOAD_RESULT from claude tab → mirror (for feedback)
  if (message.type === 'DOWNLOAD_RESULT') {
    if (mirrorTabId !== null) {
      browser.tabs.sendMessage(mirrorTabId, {
        type: 'DOWNLOAD_RESULT',
        clicked: message.clicked,
        filename: message.filename
      }).catch(() => {});
    }
  }

  if (message.type === 'FOCUS_CLAUDE') {
    if (claudeTabId !== null) {
      browser.tabs.get(claudeTabId)
        .then(t => { browser.windows.update(t.windowId, { focused: true }); browser.tabs.update(claudeTabId, { active: true }); })
        .catch(() => {});
    }
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  if (tabId === mirrorTabId) mirrorTabId = null;
  if (tabId === claudeTabId) claudeTabId = null;
});
