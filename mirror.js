// mirror.js — Ghost Mirror v4.16

var messages = [];
var currentFilter = 'all';
var autoScroll = true;
var searchTerm = '';
var syncReceived = false;

document.addEventListener('DOMContentLoaded', function() {

  document.getElementById('btn-all').addEventListener('click', function() { setFilter('all'); });
  document.getElementById('btn-human').addEventListener('click', function() { setFilter('human'); });
  document.getElementById('btn-assistant').addEventListener('click', function() { setFilter('assistant'); });
  document.getElementById('btn-auto').addEventListener('click', toggleAutoScroll);
  document.getElementById('btn-top').addEventListener('click', function() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    autoScroll = false;
    document.getElementById('btn-auto').classList.remove('active');
  });
  document.getElementById('btn-bottom').addEventListener('click', function() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    autoScroll = true;
    document.getElementById('btn-auto').classList.add('active');
  });
  document.getElementById('search-box').addEventListener('input', function(e) { onSearch(e.target.value); });
  document.getElementById('btn-focus').addEventListener('click', function() {
    browser.runtime.sendMessage({ type: 'FOCUS_CLAUDE' }).catch(function() {});
  });

  browser.runtime.onMessage.addListener(function(message) {
    if (message.type === 'SYNC') {
      if (message.payload && message.payload.length > 0) syncReceived = true;
      var prev = messages;
      messages = message.payload || [];
      renderIncremental(prev, messages);
      setStatus(true);
    }
    if (message.type === 'DOWNLOAD_RESULT') {
      var tags = document.querySelectorAll('.file-tag[data-file="' + message.filename + '"]');
      tags.forEach(function(tag) {
        var orig = tag.textContent;
        if (message.clicked === true) {
          tag.textContent = '\u2713 downloading...';
          tag.style.background = '#1a7a4a';
          tag.style.color = '#fff';
        } else if (message.clicked === 'textonly') {
          tag.textContent = '\u21b3 text file \u2014 save from Claude tab';
          tag.style.background = '#5a4a00';
          tag.style.color = '#ffd';
        } else {
          tag.textContent = '\u26a0 scroll to in Claude tab';
          tag.style.background = '#9a6000';
          tag.style.color = '#fff';
        }
        setTimeout(function() {
          tag.textContent = orig;
          tag.style.background = '';
          tag.style.color = '';
        }, 3000);
      });
    }
    if (message.type === 'DEBUG_FILES_RESULT') {
      console.log('Ghost Mirror debug files:', JSON.stringify(message.result, null, 2));
    }
  });

  // Single delegated listener for all file tags — wired once, survives renderAll/renderIncremental
  document.getElementById('conversation').addEventListener('click', function(e) {
    var ft = e.target.closest('.file-tag');
    if (!ft) return;
    e.stopPropagation();
    var tagIdx = parseInt(ft.getAttribute('data-idx'), 10);
    var fname = ft.getAttribute('data-file');
    ft.style.opacity = '0.6';
    setTimeout(function() { ft.style.opacity = ''; }, 400);
    console.log('Ghost Mirror: file tag clicked', fname, 'idx', tagIdx);
    browser.runtime.sendMessage({
      type: 'CLICK_DOWNLOAD',
      idx: tagIdx,
      filename: fname
    }).catch(function(err) { console.log('Ghost Mirror: download click error', err); });
  });

  window.addEventListener('scroll', function() {
    autoScroll = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 100);
    document.getElementById('btn-auto').classList.toggle('active', autoScroll);
  });

  requestSync();
});

function requestSync() {
  if (syncReceived) return;
  browser.runtime.sendMessage({ type: 'REQUEST_SYNC' }).catch(function() {});
  setTimeout(requestSync, 800);
}

function setStatus(live) {
  document.getElementById('status-dot').className = 'status-dot' + (live ? ' live' : '');
  document.getElementById('status-text').textContent = live ? 'Live \u2014 syncing with Claude tab' : 'Waiting for Claude tab...';
}

function formatTimestamp(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  return d.getHours().toString().padStart(2,'0') + ':' +
         d.getMinutes().toString().padStart(2,'0') + ':' +
         d.getSeconds().toString().padStart(2,'0');
}

// Build occurrence map from files[] arrays on messages
function buildOccurrenceMap() {
  var occurrences = {};
  messages.forEach(function(msg, idx) {
    if (msg.role !== 'assistant') return;
    var files = msg.files || [];
    files.forEach(function(f) {
      var key = f.filename.toLowerCase();
      if (!occurrences[key]) occurrences[key] = [];
      if (!occurrences[key].find(function(e) { return e.idx === idx; })) {
        occurrences[key].push({ idx: idx, ariaLabel: f.ariaLabel || '' });
      }
    });
  });
  return occurrences;
}

// Build msgIdx → [{filename, ariaLabel, revNum, totalRevs}]
function buildMsgFileTags(occurrenceMap) {
  var msgFileTags = {};
  Object.keys(occurrenceMap).forEach(function(fname) {
    var entryList = occurrenceMap[fname];
    entryList.forEach(function(entry, revIdx) {
      if (!msgFileTags[entry.idx]) msgFileTags[entry.idx] = [];
      msgFileTags[entry.idx].push({
        filename: fname,
        ariaLabel: entry.ariaLabel || '',
        revNum: revIdx + 1,
        totalRevs: entryList.length
      });
    });
  });
  return msgFileTags;
}

function escHtml(t) {
  return (t || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatBody(text) {
  var s = escHtml(text);
  s = s.replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  return s;
}

function buildMsgDiv(msg, idx, msgFileTags) {
  var div = document.createElement('div');
  div.className = 'msg ' + msg.role;
  div.dataset.role = msg.role;
  div.dataset.idx = idx;

  var label = msg.role === 'human' ? 'You' : 'Claude';
  var ts = msg.ts ? '<span class="msg-ts">' + formatTimestamp(msg.ts) + '</span>' : '';

  var fileTagsHtml = '';
  if (msg.role === 'assistant' && msgFileTags[idx]) {
    msgFileTags[idx].forEach(function(ft) {
      var revLabel = ft.totalRevs > 1 ? ' v' + ft.revNum : '';
      var dlLabel = '\uD83D\uDCE5 ' + ft.filename + revLabel;
      var tooltip = ft.totalRevs > 1
        ? 'Download ' + ft.filename + ' (revision ' + ft.revNum + ' of ' + ft.totalRevs + ')'
        : 'Download ' + ft.filename;
      fileTagsHtml += '<span class="file-tag" data-idx="' + idx +
        '" data-file="' + escHtml(ft.filename) +
        '" data-aria-label="' + escHtml(ft.ariaLabel) +
        '" title="' + escHtml(tooltip) + '">' +
        escHtml(dlLabel) + '</span> ';
    });
  }

  div.innerHTML =
    '<div class="msg-header">' +
      '<span class="msg-label">' + label + '</span>' +
      '<span class="msg-num">#' + (idx+1) + '</span>' +
      ts + fileTagsHtml +
    '</div>' +
    '<div class="msg-body">' + formatBody(msg.text || '') + '</div>';

  return div;
}

// Incremental render — only rebuild what changed.
// Strategy:
//   - If new message list is longer, append new divs at the end.
//   - If last message changed (streaming update), rebuild only that div in-place.
//   - If count decreased or there's a structural change, fall back to full rebuild.
//   - File tag changes on existing messages trigger a targeted header rebuild only.
function renderIncremental(prev, next) {
  var container = document.getElementById('conversation');
  var existingDivs = Array.from(container.querySelectorAll('.msg[data-idx]'));

  var occurrenceMap = buildOccurrenceMap();
  var msgFileTags = buildMsgFileTags(occurrenceMap);

  // Full rebuild needed if message count dropped (shouldn't happen) or 
  // existing count mismatches DOM (first load or structural change)
  var needsFullRebuild = (next.length < prev.length) ||
                         (existingDivs.length !== prev.length && prev.length > 0);

  if (needsFullRebuild || existingDivs.length === 0) {
    renderAll(msgFileTags);
    return;
  }

  var scrolledToBottom = autoScroll;

  // Append new messages at tail
  for (var i = existingDivs.length; i < next.length; i++) {
    var newDiv = buildMsgDiv(next[i], i, msgFileTags);
    container.appendChild(newDiv);
  }

  // Update last message div if its text changed (streaming)
  var lastIdx = prev.length - 1;
  if (lastIdx >= 0 && prev[lastIdx] && next[lastIdx]) {
    if (prev[lastIdx].text !== next[lastIdx].text) {
      var lastDiv = container.querySelector('.msg[data-idx="' + lastIdx + '"]');
      if (lastDiv) {
        var bodyEl = lastDiv.querySelector('.msg-body');
        if (bodyEl) bodyEl.innerHTML = formatBody(next[lastIdx].text || '');
      }
    }
    // If file tags changed on last message, rebuild its header
    var prevFiles = JSON.stringify((prev[lastIdx].files || []).map(function(f){return f.filename;}));
    var nextFiles = JSON.stringify((next[lastIdx].files || []).map(function(f){return f.filename;}));
    if (prevFiles !== nextFiles) {
      var lastDiv2 = container.querySelector('.msg[data-idx="' + lastIdx + '"]');
      if (lastDiv2) rebuildMsgHeader(lastDiv2, next[lastIdx], lastIdx, msgFileTags);
    }
  }

  document.getElementById('msg-count').textContent = next.length + ' messages';
  applyFilter();
  applySearch();
  if (scrolledToBottom) window.scrollTo(0, document.body.scrollHeight + 500);
}

// Rebuild header in-place for a single message div (file tag updates without full redraw)
function rebuildMsgHeader(div, msg, idx, msgFileTags) {
  var label = msg.role === 'human' ? 'You' : 'Claude';
  var ts = msg.ts ? '<span class="msg-ts">' + formatTimestamp(msg.ts) + '</span>' : '';
  var fileTagsHtml = '';
  if (msg.role === 'assistant' && msgFileTags[idx]) {
    msgFileTags[idx].forEach(function(ft) {
      var revLabel = ft.totalRevs > 1 ? ' v' + ft.revNum : '';
      var dlLabel = '\uD83D\uDCE5 ' + ft.filename + revLabel;
      var tooltip = ft.totalRevs > 1
        ? 'Download ' + ft.filename + ' (revision ' + ft.revNum + ' of ' + ft.totalRevs + ')'
        : 'Download ' + ft.filename;
      fileTagsHtml += '<span class="file-tag" data-idx="' + idx +
        '" data-file="' + escHtml(ft.filename) +
        '" data-aria-label="' + escHtml(ft.ariaLabel) +
        '" title="' + escHtml(tooltip) + '">' +
        escHtml(dlLabel) + '</span> ';
    });
  }
  var header = div.querySelector('.msg-header');
  if (header) {
    header.innerHTML =
      '<span class="msg-label">' + label + '</span>' +
      '<span class="msg-num">#' + (idx+1) + '</span>' +
      ts + fileTagsHtml;
    // click handled by container delegation
  }
}

// Full rebuild — used on first load and structural changes only
function renderAll(msgFileTags) {
  var container = document.getElementById('conversation');
  // Preserve scroll position so full rebuild doesn't jump
  var scrollY = window.scrollY;
  var atBottom = autoScroll;

  container.innerHTML = '';

  if (!msgFileTags) {
    var occurrenceMap = buildOccurrenceMap();
    msgFileTags = buildMsgFileTags(occurrenceMap);
  }

  messages.forEach(function(msg, idx) {
    container.appendChild(buildMsgDiv(msg, idx, msgFileTags));
  });

  document.getElementById('msg-count').textContent = messages.length + ' messages';
  applyFilter();
  applySearch();

  if (atBottom) {
    window.scrollTo(0, document.body.scrollHeight + 500);
  } else {
    window.scrollTo(0, scrollY);
  }
}

function applyFilter() {
  document.querySelectorAll('.msg').forEach(function(el) {
    el.classList.toggle('filtered', currentFilter !== 'all' && el.dataset.role !== currentFilter);
  });
  document.getElementById('status-filter').textContent = 'Filter: ' + currentFilter;
  ['all','human','assistant'].forEach(function(f) {
    var btn = document.getElementById('btn-' + f);
    if (btn) btn.classList.toggle('active', f === currentFilter);
  });
}

function setFilter(f) { currentFilter = f; applyFilter(); }
function onSearch(val) { searchTerm = val.toLowerCase().trim(); applySearch(); }

function applySearch() {
  document.querySelectorAll('.msg').forEach(function(el) {
    if (!searchTerm) { el.classList.remove('search-hidden'); return; }
    var text = (el.querySelector('.msg-body') || {}).textContent || '';
    el.classList.toggle('search-hidden', text.toLowerCase().indexOf(searchTerm) === -1);
  });
}

function toggleAutoScroll() {
  autoScroll = !autoScroll;
  document.getElementById('btn-auto').classList.toggle('active', autoScroll);
}
