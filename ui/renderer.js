'use strict';

let tabs = [];
let activeId = null;
let accounts = {};
let accountsSidebarOpen = false;
let helpSidebarOpen = false;
let keybindings = {};

document.addEventListener('DOMContentLoaded', async () => {
  window.api.onPlatform(p => { if (p === 'darwin') document.body.classList.add('mac'); });

  const data = await window.api.getInitData();
  if (data.platform === 'darwin') document.body.classList.add('mac');

  tabs = data.tabs || [];
  activeId = data.activeId || null;
  accounts = data.accounts || {};
  accountsSidebarOpen = data.accountsSidebarOpen || false;

  renderTabs();
  renderAccounts();
  setAccountsSidebarOpen(accountsSidebarOpen);

  const sc = await window.api.getKeybindings();
  if (sc) { keybindings = sc.keybindings || {}; applyHelpOverrides(sc); updateKeybindingLabels(); }

  window.api.onTabsUpdate(d => { tabs = d.tabs; activeId = d.activeId; renderTabs(); });
  window.api.onAccountsUpdate(d => { accounts = d; renderAccounts(); });
  window.api.onAccountsSidebarState(v => setAccountsSidebarOpen(v));
  window.api.onHelpSidebarState(v => setHelpSidebarOpen(v));
  window.api.onKeybindingsUpdate(d => {
    keybindings = d.keybindings || {};
    applyHelpOverrides(d);
    updateKeybindingLabels();
  });

  wire();
});

function applyHelpOverrides(d) {
  if (!d.helpOverrides) return;
  const overrides = d.helpOverrides;
  Object.keys(overrides).forEach(sectionKey => {
    const ov = overrides[sectionKey];
    const section = document.querySelector(`[data-section="${sectionKey}"]`);
    if (!section) return;
    if (ov.title) {
      const titleEl = section.querySelector('[data-title-key]');
      if (titleEl) titleEl.textContent = ov.title;
    }
    if (ov.body) {
      // replace paragraph content after the title
      const existingPs = section.querySelectorAll('p, ol');
      existingPs.forEach(el => el.remove());
      const div = document.createElement('div');
      div.innerHTML = ov.body;
      section.appendChild(div);
    }
  });
}

function labelFromCfg(cfg) {
  if (!cfg) return null;
  if (cfg.global) return cfg.label || cfg.global;
  if (cfg.special) return cfg.special;
  const parts = [];
  if (cfg.meta) parts.push('\u229e'); // ⊞ Win key
  if (cfg.ctrl) parts.push('Ctrl');
  if (cfg.alt) parts.push('Alt');
  if (cfg.shift) parts.push('Shift');
  if (cfg.key) parts.push(cfg.key.length === 1 ? cfg.key.toUpperCase() : cfg.key);
  return parts.join('+') || null;
}

function updateKeybindingLabels() {
  if (!keybindings) return;
  const kb = keybindings;

  const DEFAULTS = {
    newTab: { ctrl: true, alt: false, shift: false, meta: false, key: 't' },
    closeTab: { ctrl: true, alt: false, shift: false, meta: false, key: 'w' },
    nextTab: { ctrl: true, alt: false, shift: false, meta: false, key: 'Tab' },
    prevTab: { ctrl: true, alt: false, shift: true, meta: false, key: 'Tab' },
    reloadTab: { ctrl: true, alt: false, shift: false, meta: false, key: 'r' },
    toggleAccounts: { ctrl: false, alt: true, shift: false, meta: false, key: 'a' },
    toggleCompanion: { label: '\u229e+Alt+/', global: 'Super+Alt+/' },
  };

  const get = (key, fallback) => labelFromCfg(kb[key]) || labelFromCfg(DEFAULTS[key]) || fallback;

  const companionLabel = get('toggleCompanion', '\u229e+Alt+/');

  // update the companion shortcut kbd in the help section
  const companionKbd = byId('companion-shortcut-kbd');
  if (companionKbd) companionKbd.textContent = companionLabel;

  // update accounts sidebar footer
  const sbFoot = byId('accounts-sidebar-footer');
  if (sbFoot) {
    const toggleAcctLabel = get('toggleAccounts', 'Alt+A');
    sbFoot.innerHTML = `${escHtml(companionLabel)} &middot; toggle companion &nbsp;|&nbsp; ${escHtml(toggleAcctLabel)} &middot; toggle this panel`;
  }

  // update configurable kbd elements in help prose
  const setText = (id, val) => { const el = byId(id); if (el) el.textContent = val; };
  setText('help-kbd-newTab', get('newTab', 'Ctrl+T'));
  setText('help-kbd-nextTab', get('nextTab', 'Ctrl+Tab'));
  setText('help-kbd-prevTab', get('prevTab', 'Ctrl+Shift+Tab'));
  setText('help-kbd-closeTab', get('closeTab', 'Ctrl+W'));
  setText('help-kbd-reloadTab', get('reloadTab', 'Ctrl+R'));
  const acctLabel = get('toggleAccounts', 'Alt+A');
  setText('help-kbd-toggleAcct1', acctLabel);
  setText('help-kbd-toggleAcct2', acctLabel);
}

function matchesShortcut(e, sc) {
  if (!sc || sc.global || sc.special) return false;
  const keyMatch = e.key.toLowerCase() === sc.key?.toLowerCase();
  const ctrlMatch = !!sc.ctrl === e.ctrlKey;
  const metaMatch = !!sc.meta === e.metaKey;
  const altMatch = !!sc.alt === e.altKey;
  const shiftMatch = !!sc.shift === e.shiftKey;
  return keyMatch && ctrlMatch && metaMatch && altMatch && shiftMatch;
}

function wire() {
  byId('btn-minimize')?.addEventListener('click', () => window.api.windowControl('minimize'));
  byId('btn-maximize')?.addEventListener('click', () => window.api.windowControl('maximize'));
  byId('btn-close')?.addEventListener('click', () => window.api.windowControl('close'));

  byId('accounts-toggle')?.addEventListener('click', () => window.api.toggleAccountsSidebar());
  byId('accounts-close')?.addEventListener('click', () => window.api.toggleAccountsSidebar());

  byId('help-toggle')?.addEventListener('click', () => window.api.toggleHelpSidebar());
  byId('help-close-btn')?.addEventListener('click', () => window.api.toggleHelpSidebar());

  byId('preferences-toggle')?.addEventListener('click', () => window.api.openPreferencesWin());

  byId('new-tab-btn')?.addEventListener('click', () => window.api.newTab());

  byId('refresh-btn')?.addEventListener('click', () => window.api.reloadTab());

  byId('open-in-companion-btn')?.addEventListener('click', async () => {
    await window.api.openInCompanion();
  });

  byId('save-btn')?.addEventListener('click', doSaveAccount);
  byId('account-name-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') doSaveAccount(); });

  byId('clear-btn')?.addEventListener('click', async () => {
    await window.api.clearCookies();
    toast('Signed out — cookies cleared.', 'success');
  });

  byId('share-btn')?.addEventListener('click', async () => {
    setLoading('share-btn', true, 'Copy Share Link');
    const link = await window.api.getShareLink();
    setLoading('share-btn', false, 'Copy Share Link');
    toast(link ? 'Share link copied!' : 'No active chat to share.', link ? 'success' : 'error');
  });

  byId('import-btn')?.addEventListener('click', doImportAccounts);
  byId('export-btn')?.addEventListener('click', doExportAccounts);

  byId('accounts-list')?.addEventListener('click', onAccountClick);

  document.addEventListener('keydown', e => {
    if (e.key === 'F5') { e.preventDefault(); window.api.reloadTab(); return; }
    if (matchesShortcut(e, keybindings.toggleAccounts || { ctrl: false, alt: true, shift: false, key: 'a' })) {
      e.preventDefault(); window.api.toggleAccountsSidebar(); return;
    }

    if (e.ctrlKey && e.key.toLowerCase() === 't') { e.preventDefault(); window.api.newTab(); }
    if (matchesShortcut(e, keybindings.reloadTab || { ctrl: true, alt: false, shift: false, key: 'r' })) { e.preventDefault(); window.api.reloadTab(); return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'w') { e.preventDefault(); if (activeId) window.api.closeTab(activeId); }
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      const idx = tabs.findIndex(t => t.id === activeId);
      if (idx < 0 || tabs.length < 2) return;
      const next = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
      window.api.switchTab(tabs[next].id);
    }
  });
}

async function onAccountClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const name = btn.dataset.name;
  const action = btn.dataset.action;

  if (action === 'delete') {
    if (!confirm(`Delete "${name}"?`)) return;
    await window.api.deleteAccount(name);
    toast(`Deleted "${name}"`, 'success');
    return;
  }
  if (action === 'switch') {
    const res = await window.api.switchAccount(name);
    toast(res?.ok ? `Loaded "${name}" in this tab` : `Failed: ${res?.error}`, res?.ok ? 'success' : 'error');
    return;
  }
  if (action === 'context') {
    toast('Grabbing share link…', 'info');
    const res = await window.api.switchWithContext(name);
    if (res?.ok) toast(`Loaded "${name}" in this tab` + (res.shareUrl ? ' 🔗' : ''), 'success');
    else toast(`Failed: ${res?.error}`, 'error');
    return;
  }
}

async function doSaveAccount() {
  const input = byId('account-name-input');
  const name = input.value.trim();
  if (!name) { toast('Enter an account name first.', 'error'); return; }
  setLoading('save-btn', true, 'Save');
  const ok = await window.api.saveAccount(name);
  setLoading('save-btn', false, 'Save');
  if (ok) { input.value = ''; toast(`Saved "${name}"`, 'success'); }
  else toast('Failed to save account.', 'error');
}

let dragSrcId = null;

function renderTabs() {
  const list = byId('tabs-list');
  if (!list) return;
  const scrollLeft = list.scrollLeft;
  list.innerHTML = '';

  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeId ? ' active' : '');
    el.draggable = true;
    el.dataset.id = tab.id;

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = shortTitle(tab.title);
    title.title = tab.title || 'ChatGPT';

    const x = document.createElement('button');
    x.className = 'tab-x';
    x.textContent = '×';
    x.addEventListener('click', e => { e.stopPropagation(); window.api.closeTab(tab.id); });

    el.appendChild(title);
    el.appendChild(x);
    el.addEventListener('click', () => window.api.switchTab(tab.id));

    el.addEventListener('dragstart', e => {
      dragSrcId = tab.id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      list.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      list.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
      if (tab.id !== dragSrcId) el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (!dragSrcId || dragSrcId === tab.id) return;
      const srcIdx = tabs.findIndex(t => t.id === dragSrcId);
      const dstIdx = tabs.findIndex(t => t.id === tab.id);
      if (srcIdx < 0 || dstIdx < 0) return;
      const [moved] = tabs.splice(srcIdx, 1);
      tabs.splice(dstIdx, 0, moved);
      window.api.reorderTabs(tabs.map(t => t.id));
      renderTabs();
    });

    list.appendChild(el);
  });

  list.scrollLeft = scrollLeft;
}

function shortTitle(t) {
  if (!t || t === 'ChatGPT') return 'ChatGPT';
  return t.length > 22 ? t.slice(0, 20) + '…' : t;
}

let acctDragSrc = null;

function renderAccounts() {
  const list = byId('accounts-list');
  if (!list) return;
  const names = Object.keys(accounts);

  if (!names.length) {
    list.innerHTML = `<div class="empty">No saved accounts yet.<br>Log in, then type a name and click <b>Save</b>.</div>`;
    return;
  }

  list.innerHTML = '';
  names.forEach(name => {
    const acc = accounts[name];
    const date = acc?.savedAt
      ? new Date(acc.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
      : '';
    const esc = escHtml(name);

    const card = document.createElement('div');
    card.className = 'account-card';
    card.draggable = true;
    card.dataset.name = name;

    card.innerHTML = `
      <div class="account-main-row">
        <div class="drag-handle" title="Drag to reorder">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <circle cx="3" cy="2" r="1"/><circle cx="7" cy="2" r="1"/>
            <circle cx="3" cy="5" r="1"/><circle cx="7" cy="5" r="1"/>
            <circle cx="3" cy="8" r="1"/><circle cx="7" cy="8" r="1"/>
          </svg>
        </div>
        <div class="account-info">
          <div class="account-name" title="${esc}">${esc}</div>
          ${date ? `<div class="account-date">· ${date}</div>` : ''}
        </div>
        <div class="account-btns">
          <button class="btn-icon btn-icon-load" data-name="${esc}" data-action="context" title="Load with context">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
              <polyline points="10 17 15 12 10 7"/>
              <line x1="15" y1="12" x2="3" y2="12"/>
            </svg>
          </button>
          <button class="btn-icon btn-icon-del" data-name="${esc}" data-action="delete" title="Delete account">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>
      </div>`;

    card.addEventListener('dragstart', e => {
      acctDragSrc = name;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      list.querySelectorAll('.account-card').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      list.querySelectorAll('.account-card').forEach(c => c.classList.remove('drag-over'));
      if (name !== acctDragSrc) card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (!acctDragSrc || acctDragSrc === name) return;
      const namesList = Object.keys(accounts);
      const srcIdx = namesList.indexOf(acctDragSrc);
      const dstIdx = namesList.indexOf(name);
      if (srcIdx < 0 || dstIdx < 0) return;
      const [moved] = namesList.splice(srcIdx, 1);
      namesList.splice(dstIdx, 0, moved);
      window.api.reorderAccounts(namesList);
      const reordered = {};
      namesList.forEach(n => { if (accounts[n]) reordered[n] = accounts[n]; });
      accounts = reordered;
      renderAccounts();
    });

    list.appendChild(card);
  });
}

function setAccountsSidebarOpen(open) {
  accountsSidebarOpen = open;
  byId('accounts-sidebar')?.classList.toggle('closed', !open);
  byId('accounts-toggle')?.classList.toggle('active', open);
}

function setHelpSidebarOpen(open) {
  helpSidebarOpen = open;
  byId('help-sidebar')?.classList.toggle('closed', !open);
  byId('help-toggle')?.classList.toggle('active', open);
}

function toast(msg, type = '') {
  window.api.showToast(msg, type);
}

async function doImportAccounts() {
  const res = await window.api.importAccounts();
  if (res.canceled) return;
  if (!res.ok) { toast('Import failed: ' + res.error, 'error'); return; }
  let msg = `Imported ${res.added} account${res.added !== 1 ? 's' : ''}.`;
  if (res.conflicts > 0) msg += ` (${res.conflicts} renamed to avoid conflicts)`;
  toast(msg, 'success');
}

async function doExportAccounts() {
  const res = await window.api.exportAccounts();
  if (res.canceled) return;
  if (!res.ok) { toast('Export failed: ' + res.error, 'error'); return; }
  toast(`Exported ${res.count} account${res.count !== 1 ? 's' : ''} successfully.`, 'success');
}

function byId(id) { return document.getElementById(id); }
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function setLoading(id, loading, label) {
  const el = byId(id);
  if (!el) return;
  el.disabled = loading;
  el.innerHTML = loading ? `<span class="spin"></span>${label}` : label;
}
