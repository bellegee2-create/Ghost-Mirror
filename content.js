// content.js — Ghost Mirror v4.15
console.log("Ghost Mirror: content script loaded");

let messageCache = [];

function getAssistantEls() {
  const humanEls = Array.from(document.querySelectorAll('[data-testid="user-message"]'));
  let assistantEls = [];
  if (humanEls.length > 0) {
    let container = humanEls[0].parentElement;
    for (let i = 0; i < 10; i++) {
      if (!container) break;
      const fontClaude = Array.from(container.querySelectorAll('[class*="font-claude"]'));
      const userMsgs = Array.from(container.querySelectorAll('[data-testid="user-message"]'));
      if (fontClaude.length > 0 && userMsgs.length > 0) {
        assistantEls = fontClaude.filter(el => !fontClaude.some(other => other !== el && other.contains(el)));
        break;
      }
      container = container.parentElement;
    }
  }
  return assistantEls;
}

// Strip status/spinner child text so "Working..." doesn't appear in assistant messages
function getCleanText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('[class*="status"],[class*="spinner"],[class*="loading"],[class*="thinking"]')
    .forEach(n => n.remove());
  return clone.innerText?.trim() || '';
}

function getAllSorted() {
  const humanEls = Array.from(document.querySelectorAll('[data-testid="user-message"]'));
  const assistantEls = getAssistantEls();
  const all = [];
  humanEls.forEach(el => { if (el.innerText?.trim()) all.push({ el, role: 'human' }); });
  assistantEls.forEach(el => { if (getCleanText(el)) all.push({ el, role: 'assistant' }); });
  all.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  return all;
}

// Scan DOM for download cards.
// ALL file types (zip, docx, py, txt, md, bat etc.) render button[aria-label^="Download "]
// Filename is in the aria-label: "Download Consumer 1 " → strip "Download " prefix
function findDownloadCards() {
  const cards = [];
  const assistantEls = getAssistantEls();

  function assignOwner(targetEl) {
    let ownerEl = null;
    for (const el of assistantEls) {
      const pos = el.compareDocumentPosition(targetEl);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) ownerEl = el;
    }
    return ownerEl;
  }

  // All file types — button[aria-label^="Download "]
  // Exclude file-thumbnail (user upload cards)
  const btns = Array.from(document.querySelectorAll('button[aria-label^="Download "]'));
  btns.forEach(btn => {
    if (btn.closest('[data-testid="file-thumbnail"]')) return;
    const label = btn.getAttribute('aria-label') || '';
    const fname = label.replace(/^Download\s+/i, '').trim();
    if (!fname) return;
    const ownerEl = assignOwner(btn);
    cards.push({ filename: fname, buttonEl: btn, ownerEl, textOnly: false });
  });

  return cards;
}


function extractMessages() {
  const all = getAllSorted();
  const downloadCards = findDownloadCards();

  return all.map((item, idx) => {
    const msg = {
      id: idx,
      role: item.role,
      text: item.role === 'assistant' ? getCleanText(item.el) : item.el.innerText?.trim(),
      ts: Date.now(),
      files: []
    };

    if (item.role === 'assistant') {
      downloadCards.forEach(card => {
        if (card.ownerEl === item.el) {
          if (!msg.files.find(f => f.filename === card.filename)) {
            msg.files.push({ filename: card.filename });
          }
        }
      });
    }

    return msg;
  });
}

function sendSync() {
  const messages = extractMessages();
  messageCache = messages;
  browser.runtime.sendMessage({ type: 'SYNC', payload: messages }).catch(() => {});
}

function syncIfChanged() {
  const messages = extractMessages();
  const last = messages[messages.length - 1];
  const cachedLast = messageCache[messageCache.length - 1];
  if (messages.length !== messageCache.length ||
      (last && cachedLast && last.text !== cachedLast.text)) {
    messageCache = messages;
    browser.runtime.sendMessage({ type: 'SYNC', payload: messages }).catch(() => {});
  }
}

// Also sync when download cards appear (they load after message text)
function syncIfCardsChanged() {
  const cards = findDownloadCards();
  const cardCount = cards.length;
  const cachedCardCount = messageCache.reduce((n, m) => n + (m.files ? m.files.length : 0), 0);
  if (cardCount !== cachedCardCount) {
    sendSync();
  }
}

const observer = new MutationObserver(() => {
  syncIfChanged();
  syncIfCardsChanged();
});

function startObserver() {
  const target = document.querySelector('main') || document.body;
  observer.observe(target, { childList: true, subtree: true, characterData: true });
  messageCache = extractMessages();
}

if (document.readyState === 'complete') startObserver();
else window.addEventListener('load', startObserver);

function getAllMessageEls() {
  const all = getAllSorted();
  return all.map(item => item.el);
}

function fireClick(btn) {
  // React synthetic events don't respond to programmatic dispatch from content script context.
  // Inject a script tag to fire the click from page context instead.
  const label = btn.getAttribute('aria-label') || '';
  const escaped = label.replace(/'/g, "\\'");
  const s = document.createElement('script');
  s.textContent = '(function(){' +
    'var btn=Array.from(document.querySelectorAll(\'button[aria-label^="Download "]\'))' +
    '.find(function(b){return b.getAttribute(\'aria-label\')===\'' + escaped + '\';});' +
    'if(btn)btn.click();' +
    '})();';
  document.head.appendChild(s);
  s.remove();
}

function tryClickDownload(filename, attempts, resolve) {
  const cards = findDownloadCards();
  const fname = filename.toLowerCase();
  const match = cards.find(c =>
    c.filename.toLowerCase() === fname ||
    c.filename.toLowerCase().includes(fname) ||
    fname.includes(c.filename.toLowerCase())
  );
  if (match) {
    fireClick(match.buttonEl);
    resolve(true);
    return;
  }
  if (attempts <= 0) { resolve(false); return; }
  setTimeout(() => tryClickDownload(filename, attempts - 1, resolve), 400);
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'REQUEST_SYNC') sendSync();

  if (message.type === 'SCROLL_TO') {
    const all = getAllMessageEls();
    const target = all[message.idx];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const prev = target.style.outline;
      target.style.outline = '2px solid #4a7c6e';
      setTimeout(() => { target.style.outline = prev; }, 2000);
    }
  }

  if (message.type === 'CLICK_DOWNLOAD') {
    const all = getAllMessageEls();
    const msgEl = all[message.idx];
    if (msgEl) msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    new Promise(resolve => {
      setTimeout(() => tryClickDownload(message.filename, 8, resolve), 600);
    }).then(clicked => {
      browser.runtime.sendMessage({
        type: 'DOWNLOAD_RESULT',
        clicked,
        filename: message.filename
      }).catch(() => {});
    });
  }
});
