// mirror.js — Ghost Mirror v4.13

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
      messages = message.payload || [];
      renderAll();
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
  document.getElementById('status-text').textContent = live ? 'Live — syncing with Claude tab' : 'Waiting for Claude tab...';
}

function formatTimestamp(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  return d.getHours().toString().padStart(2,'0') + ':' +
         d.getMinutes().toString().padStart(2,'0') + ':' +
         d.getSeconds().toString().padStart(2,'0');
}

// Build occurrence map from files[] arrays on messages
// Returns: { 'filename': [{idx, ariaLabel}, ...], ... }
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

function escHtml(t) {
  return (t || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatBody(text) {
  var s = escHtml(text);
  s = s.replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  return s;
}

function renderAll() {
  var container = document.getElementById('conversation');
  container.innerHTML = '';

  var occurrenceMap = buildOccurrenceMap();

  // Build reverse: msgIdx -> [{filename, ariaLabel, revNum, totalRevs}]
  var msgFileTags = {};
  Object.keys(occurrenceMap).forEach(function(fname) {
    var entryList = occurrenceMap[fname]; // [{idx, ariaLabel}]
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

  messages.forEach(function(msg, idx) {
    var div = document.createElement('div');
    div.className = 'msg ' + msg.role;
    div.dataset.role = msg.role;
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

    div.querySelectorAll('.file-tag').forEach(function(ft) {
      ft.addEventListener('click', function(e) {
        e.stopPropagation();
        var tagIdx = parseInt(ft.getAttribute('data-idx'), 10);
        var fname = ft.getAttribute('data-file');
        ft.style.opacity = '0.6';
        setTimeout(function() { ft.style.opacity = ''; }, 400);
        browser.runtime.sendMessage({
          type: 'CLICK_DOWNLOAD',
          idx: tagIdx,
          filename: fname
        }).catch(function(err) { console.log('Ghost Mirror: download click error', err); });
      });
    });

    container.appendChild(div);
  });

  document.getElementById('msg-count').textContent = messages.length + ' messages';
  applyFilter();
  applySearch();
  if (autoScroll) window.scrollTo(0, document.body.scrollHeight + 500);
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
