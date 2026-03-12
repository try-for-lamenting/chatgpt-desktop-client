const {
  app, BrowserWindow, BrowserView, globalShortcut,
  ipcMain, session, clipboard, dialog
} = require('electron');
const path = require('path');
const fs = require('fs');

const LOGIN_ARG = '--login-launch';
function isLoginItemEnabled() {
  try { return app.getLoginItemSettings({ args: [LOGIN_ARG] }).openAtLogin; } catch (_) { return false; }
}
function setLoginItem(enable) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enable,
      // windows uses args here to distinguish startup launches
      // wasOpenedAtLogin works on mac only
      args: enable ? [LOGIN_ARG] : [],
    });
  } catch (_) { }
}
function wasLaunchedAtLogin() {
  try {
    // check mac criteria
    if (app.getLoginItemSettings({ args: [LOGIN_ARG] }).wasOpenedAtLogin) return true;
  } catch (_) { }
  // check windows arg
  return process.argv.includes(LOGIN_ARG);
}

// app is single instance
// kill any new instance immediately
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  process.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWin && !mainWin.isDestroyed()) {
      if (mainWin.isMinimized()) mainWin.restore();
      if (!mainWin.isVisible()) mainWin.show();
      mainWin.focus();
    } else {
      createMainWindow();
    }
  });
}

const CHATGPT_URL = 'https://chatgpt.com';

const COMPANION_PARTITION = 'persist:companion';
const TOOLBAR_HEIGHT = 44;
const ACCOUNTS_SIDEBAR_WIDTH = 315;
const HELP_SIDEBAR_WIDTH = 300;

let DATA_PATH = '';

function readJSON(file, fallback) {
  try {
    const p = path.join(DATA_PATH, file);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { }
  return fallback;
}
function writeJSON(file, data) {
  try { fs.writeFileSync(path.join(DATA_PATH, file), JSON.stringify(data, null, 2)); }
  catch (e) { console.error('writeJSON:', e.message); }
}
let mainWin = null;
let companionWin = null;
let prefsWin = null;
let companionView = null;
let companionVisible = false;
let companionPanelH = 0;
let tabs = [];   // {id, view, partition, title, url}
let activeTabId = 0;
let accountsSidebarOpen = false;
let helpSidebarOpen = false;
let tabCounter = 0;
let accounts = {};
let lastUsedAccount = null;

// the "restore to default"'s
const DEFAULT_KEYBINDINGS = {
  toggleAccounts: { ctrl: false, alt: true, shift: false, key: 'a', label: 'Alt+A', description: 'Toggle account panel (main & companion)' },
  newTab: { ctrl: true, alt: false, shift: false, key: 't', label: 'Ctrl+T', description: 'New tab' },
  closeTab: { ctrl: true, alt: false, shift: false, key: 'w', label: 'Ctrl+W', description: 'Close tab' },
  nextTab: { ctrl: true, alt: false, shift: false, key: 'Tab', label: 'Ctrl+Tab', description: 'Next tab' },
  prevTab: { ctrl: true, alt: false, shift: true, key: 'Tab', label: 'Ctrl+Shift+Tab', description: 'Previous tab' },
  reloadTab: { ctrl: true, alt: false, shift: false, key: 'r', label: 'Ctrl+R', description: 'Reload active tab' },
  toggleCompanion: { global: 'Super+Alt+/', label: 'Win+Alt+/', description: 'Toggle companion window (global)' },
  devTools: { special: 'F12', label: 'F12', description: 'Open DevTools' },
};

const DEFAULT_HELP_SECTIONS = {
  tabs: { title: 'Tabs', body: '' },
  accounts: { title: 'Adding Accounts', body: '' },
  switching: { title: 'Switching Accounts', body: '' },
  companion: { title: 'Companion Window', body: '' },
  sharing: { title: 'Sharing & Cookies', body: '' },
  keybindings: { title: 'Keyboard Shortcuts', body: '' },
};

let keybindings = { ...DEFAULT_KEYBINDINGS };
let helpOverrides = {};   // key → { title?, body? }

function loadKeybindings() {
  const saved = readJSON('keybindings.json', null);
  if (saved && saved.keybindings) keybindings = { ...DEFAULT_KEYBINDINGS, ...saved.keybindings };
  if (saved && saved.helpOverrides) helpOverrides = saved.helpOverrides;
}
function saveKeybindings() {
  writeJSON('keybindings.json', { keybindings, helpOverrides });
}
function broadcastKeybindings() {
  const payload = { keybindings, helpOverrides };
  mainWin?.webContents.send('keybindings-update', payload);
  companionWin?.webContents.send('keybindings-update', payload);
  prefsWin?.webContents.send('keybindings-update', payload);
}
let registeredCompanionKeybinding = null;
function registerGlobalKeybindings() {
  globalShortcut.unregisterAll();

  const compKey = keybindings.toggleCompanion?.global || 'Super+Alt+/';
  try {
    globalShortcut.register(compKey, toggleCompanion);
    registeredCompanionKeybinding = compKey;
  } catch (_) {
    globalShortcut.register('Super+Alt+/', toggleCompanion);
  }
}

function inputMatchesKeybinding(input, cfg) {
  if (!cfg || cfg.global || cfg.special) return false;
  if (input.type !== 'keyDown') return false;
  const keyMatch = input.key.toLowerCase() === (cfg.key || '').toLowerCase();
  const ctrlMatch = !!cfg.ctrl === (input.control || input.meta);
  const altMatch = !!cfg.alt === input.alt;
  const shiftMatch = !!cfg.shift === input.shift;
  return keyMatch && ctrlMatch && altMatch && shiftMatch;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
function injectNavigatorShareHook(wc) {
  if (!wc || wc.isDestroyed()) return;
  wc.executeJavaScript(`
    (function () {
      if (window.__navigatorShareHooked) return;
      window.__navigatorShareHooked = true;
      window.__interceptedShareUrl   = null;
      const _orig = (typeof navigator.share === 'function')
        ? navigator.share.bind(navigator) : null;
      navigator.share = function (data) {
        const url = data && data.url;
        if (url && (
          url.startsWith('https://chatgpt.com/share/') ||
          url.startsWith('https://chat.openai.com/share/')
        )) {
          window.__interceptedShareUrl = url;
          return Promise.resolve();          // prevent actual ui from opening
        }
        return _orig ? _orig(data) : Promise.resolve();
      };
    })();
  `).catch(() => { });
}

function isShareUrl(url) {
  return !!(url && (
    url.startsWith('https://chatgpt.com/share/') ||
    url.startsWith('https://chat.openai.com/share/')
  ));
}

function tabPartition(id) { return `persist:tab-${id}`; }
function getSession(partition) { return session.fromPartition(partition); }
function companionSession() { return getSession(COMPANION_PARTITION); }

const SAMESITE_MAP = {
  no_restriction: 'no_restriction', lax: 'lax', strict: 'strict',
  Lax: 'lax', Strict: 'strict', None: 'no_restriction', unspecified: 'unspecified',
};

async function clearCookies(partition) {
  const ses = getSession(partition);
  const all = await ses.cookies.get({});
  await Promise.all(all.map(c => {
    const dom = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
    return ses.cookies.remove(`https://${dom}${c.path || '/'}`, c.name).catch(() => { });
  }));
  await ses.clearStorageData({ storages: ['localstorage', 'sessionstorage', 'cachestorage'] }).catch(() => { });
}

async function restoreCookies(cookieList, partition) {
  const ses = getSession(partition);
  for (const c of cookieList) {
    try {
      const rawDomain = c.domain || 'chatgpt.com';
      const cleanDomain = rawDomain.startsWith('.') ? rawDomain.slice(1) : rawDomain;
      const obj = {
        url: `https://${cleanDomain}${c.path || '/'}`,
        name: c.name, value: c.value, path: c.path || '/',
        secure: c.secure !== false, httpOnly: !!c.httpOnly,
        sameSite: SAMESITE_MAP[c.sameSite] || 'no_restriction',
        ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}),
      };
      if (!c.name.startsWith('__Host-')) obj.domain = rawDomain;
      else { obj.path = '/'; obj.secure = true; }
      await ses.cookies.set(obj);
    } catch (e) { console.warn(`Cookie skip [${c.name}]:`, e.message); }
  }
}
async function seedPartition(partition) {
  const accs = readJSON('accounts.json', {});
  const names = Object.keys(accs);
  if (!names.length) return;
  const name = (lastUsedAccount && accs[lastUsedAccount]) ? lastUsedAccount : names[0];
  await restoreCookies(accs[name].cookies, partition);
}

function createTabView(url = CHATGPT_URL, existingPartition = null, { noSeed = false } = {}) {
  const id = ++tabCounter;
  const partition = existingPartition || tabPartition(id);
  const ses = getSession(partition);

  const view = new BrowserView({
    webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true }
  });

  if (existingPartition) {
    // already has correct cookies, so navigate immediately
    view.webContents.loadURL(url);
  } else if (noSeed) {
    // caller owns cookies and will perform loadURL themselves, so do nothing here
  } else {
    // seed with last-used account then navigate
    seedPartition(partition).then(() => {
      if (!view.webContents.isDestroyed()) view.webContents.loadURL(url);
    }).catch(() => {
      if (!view.webContents.isDestroyed()) view.webContents.loadURL(url);
    });
  }

  view.webContents.on('dom-ready', () => injectNavigatorShareHook(view.webContents));

  view.webContents.on('page-title-updated', (_, title) => {
    const t = tabs.find(t => t.id === id);
    if (t) { t.title = title; pushTabsUpdate(); }
  });
  view.webContents.on('did-navigate', (_, navUrl) => {
    const t = tabs.find(t => t.id === id);
    if (t) t.url = navUrl;
  });
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const kb = keybindings;

    if (input.key === 'F12') {
      if (appSettings.devToolsEnabled !== false) {
        event.preventDefault();
        mainWin?.webContents.openDevTools({ mode: 'detach' });
      }
      return;
    }
    if (input.key === 'F5') {
      event.preventDefault();
      view.webContents.reload();
      return;
    }

    if (inputMatchesKeybinding(input, kb.toggleAccounts || { ctrl: false, alt: true, shift: false, key: 'a' })) {
      event.preventDefault();
      accountsSidebarOpen = !accountsSidebarOpen; applyActiveTab();
      mainWin?.webContents.send('accounts-sidebar-state', accountsSidebarOpen);
      return;
    }

    if (inputMatchesKeybinding(input, kb.newTab || { ctrl: true, alt: false, shift: false, key: 't' })) {
      event.preventDefault();
      const nt = createTabView(); activeTabId = nt.id; applyActiveTab(); pushTabsUpdate();
      return;
    }

    if (inputMatchesKeybinding(input, kb.reloadTab || { ctrl: true, alt: false, shift: false, key: 'r' })) {
      event.preventDefault();
      view.webContents.reload();
      return;
    }

    if (inputMatchesKeybinding(input, kb.closeTab || { ctrl: true, alt: false, shift: false, key: 'w' })) {
      event.preventDefault();
      closeTab(id);
      return;
    }

    if (inputMatchesKeybinding(input, kb.nextTab || { ctrl: true, alt: false, shift: false, key: 'Tab' })) {
      event.preventDefault();
      const idx = tabs.findIndex(t => t.id === activeTabId);
      activeTabId = tabs[(idx + 1) % tabs.length].id;
      applyActiveTab(); pushTabsUpdate();
      return;
    }
    if (inputMatchesKeybinding(input, kb.prevTab || { ctrl: true, alt: false, shift: true, key: 'Tab' })) {
      event.preventDefault();
      const idx = tabs.findIndex(t => t.id === activeTabId);
      activeTabId = tabs[(idx - 1 + tabs.length) % tabs.length].id;
      applyActiveTab(); pushTabsUpdate();
      return;
    }
    if (appSettings.devToolsEnabled !== false && input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
      view.webContents.openDevTools({ mode: 'detach' });
    }
  });

  const tab = { id, view, partition, title: 'ChatGPT', url };
  tabs.push(tab);
  return tab;
}

function getViewBounds() {
  if (!mainWin) return { x: 0, y: TOOLBAR_HEIGHT, width: 800, height: 600 };
  const [w, h] = mainWin.getContentSize();
  const sw = accountsSidebarOpen ? ACCOUNTS_SIDEBAR_WIDTH : 0;
  const nw = helpSidebarOpen ? HELP_SIDEBAR_WIDTH : 0;
  return { x: sw, y: TOOLBAR_HEIGHT, width: w - sw - nw, height: h - TOOLBAR_HEIGHT };
}

function applyActiveTab() {
  if (!mainWin) return;
  tabs.forEach(t => { try { mainWin.removeBrowserView(t.view); } catch (_) { } });
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  mainWin.addBrowserView(tab.view);
  tab.view.setBounds(getViewBounds());
  if (!mainWin.isMinimized()) mainWin.focus();

  // run safe focus events
  const wc = tab.view.webContents;
  const focusIfActive = () => { if (activeTabId === tab.id && !wc.isDestroyed()) wc.focus(); };
  setImmediate(focusIfActive);
  wc.once('did-start-navigation', focusIfActive);
  wc.once('did-finish-load', focusIfActive);
  wc.once('dom-ready', focusIfActive);
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx < 0) return;
  const tab = tabs[idx];
  try { mainWin?.removeBrowserView(tab.view); } catch (_) { }
  tab.view.webContents.destroy();
  tabs.splice(idx, 1);
  if (tabs.length === 0) { const nt = createTabView(); activeTabId = nt.id; }
  else if (activeTabId === id) activeTabId = tabs[Math.min(idx, tabs.length - 1)].id;
  applyActiveTab();
  pushTabsUpdate();
}

function pushTabsUpdate() {
  mainWin?.webContents.send('tabs-update', {
    tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url })),
    activeId: activeTabId
  });
}
// runs two methods in parallel;
// on a larger window, chatgpt opens a dialog. in this case we must manually
// click copy link options
//
// on smaller windows, copy automatically uses the navigator share api,
// which we hook
async function getShareLink() {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab) return null;
  const wc = activeTab.view.webContents;

  const currentUrl = wc.getURL();
  if (isShareUrl(currentUrl)) return currentUrl;

  await wc.executeJavaScript(`window.__interceptedShareUrl = null;`).catch(() => { });

  wc.focus();

  const clicked = await wc.executeJavaScript(`
    (() => {
      const btn =
        document.querySelector('[data-testid="share-chat-button"]') ||
        document.querySelector('[aria-label="Share"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `).catch(() => false);
  if (!clicked) return null;

  const SHARE_TIMEOUT = 13000;
  const SHARE_TICK = 200;
  const methodA = (async () => {
    let elapsed = 0;
    while (elapsed < SHARE_TIMEOUT) {
      await sleep(SHARE_TICK);
      elapsed += SHARE_TICK;
      const url = await wc.executeJavaScript(`window.__interceptedShareUrl || null`)
        .catch(() => null);
      if (url && isShareUrl(url)) return url;
    }
    return null;
  })();

  const methodB = (async () => {
    const copyPos = await wc.executeJavaScript(`
      new Promise(resolve => {
        const TIMEOUT = 12000, TICK = 300;
        let elapsed = 0;
        function findBtn() {
          const containers = [
            ...Array.from(document.querySelectorAll('[role="dialog"][data-state="open"]')),
            document.body
          ];
          for (const c of containers) {
            for (const b of c.querySelectorAll('button')) {
              if (!b.textContent.trim().includes('Copy link')) continue;
              if (b.disabled) continue;
              if (window.getComputedStyle(b).pointerEvents === 'none') continue;
              const r = b.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              resolve({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
              return true;
            }
          }
          return false;
        }
        function poll() {
          if (findBtn()) return;
          elapsed += TICK;
          if (elapsed >= TIMEOUT) { resolve(null); return; }
          setTimeout(poll, TICK);
        }
        setTimeout(poll, 600);
      })
    `).catch(() => null);
    if (!copyPos) return null;

    wc.sendInputEvent({ type: 'mouseMove', x: copyPos.x, y: copyPos.y });
    await sleep(60);
    wc.sendInputEvent({ type: 'mouseDown', x: copyPos.x, y: copyPos.y, button: 'left', clickCount: 1 });
    await sleep(80 + Math.round(Math.random() * 60));
    wc.sendInputEvent({ type: 'mouseUp', x: copyPos.x, y: copyPos.y, button: 'left', clickCount: 1 });

    await wc.executeJavaScript(`
      new Promise(resolve => {
        const TIMEOUT = 6000, TICK = 150;
        let elapsed = 0;
        function check() {
          const found = Array.from(document.querySelectorAll('div,span,p'))
            .some(el => { const t = el.textContent.trim(); return t === 'Link copied!' || t === 'Link copied'; });
          if (found) { resolve(true); return; }
          elapsed += TICK;
          if (elapsed >= TIMEOUT) { resolve(false); return; }
          setTimeout(check, TICK);
        }
        check();
      })
    `).catch(() => false);

    await sleep(300);
    const link = clipboard.readText();
    return isShareUrl(link) ? link : null;
  })();

  const result = await new Promise(resolve => {
    let settled = false;
    let pending = 2;
    function tryResolve(val) {
      if (settled) return;
      if (val && isShareUrl(val)) { settled = true; resolve(val); return; }
      pending--;
      if (pending === 0) resolve(null);
    }
    methodA.then(tryResolve).catch(() => tryResolve(null));
    methodB.then(tryResolve).catch(() => tryResolve(null));
  });

  // always to dismiss share dialog
  wc.executeJavaScript(`
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',code:'Escape',bubbles:true,cancelable:true}));
  `).catch(() => { });

  return result;
}
function setCompanionViewBounds() {
  if (!companionWin || !companionView) return;
  const [cw, ch] = companionWin.getContentSize();
  const top = TOOLBAR_HEIGHT + companionPanelH;
  companionView.setBounds({ x: 0, y: top, width: cw, height: Math.max(1, ch - top) });
}
function createPreferencesWindow() {
  if (prefsWin && !prefsWin.isDestroyed()) {
    prefsWin.focus();
    return;
  }
  prefsWin = new BrowserWindow({
    width: 640, height: 560, minWidth: 520, minHeight: 420,
    frame: false, backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
    title: 'Preferences',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 13 } }
      : {}),
  });
  prefsWin.loadFile(path.join(__dirname, 'ui', 'preferences.html'));
  prefsWin.webContents.once('did-finish-load', () => {
    prefsWin.webContents.send('platform', process.platform);
    prefsWin.webContents.send('keybindings-update', { keybindings, helpOverrides });
  });
  prefsWin.on('closed', () => { prefsWin = null; });
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 960, height: 800, minWidth: 800, minHeight: 500,
    frame: false, backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
    title: 'ChatGPT Desktop Client',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 13 } }
      : {}),
  });

  mainWin.loadFile(path.join(__dirname, 'ui', 'main.html'));

  // create a first tab if empty
  if (tabs.length === 0) {
    const firstTab = createTabView();
    activeTabId = firstTab.id;
  }

  mainWin.webContents.once('did-finish-load', () => {
    applyActiveTab();
    pushTabsUpdate();
    mainWin.webContents.send('accounts-update', accounts);
    mainWin.webContents.send('accounts-sidebar-state', accountsSidebarOpen);
    mainWin.webContents.send('help-sidebar-state', helpSidebarOpen);
    mainWin.webContents.send('platform', process.platform);
    mainWin.webContents.send('keybindings-update', { keybindings, helpOverrides });
  });

  mainWin.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const kb = keybindings;
    if (input.key === 'F12') {
      if (appSettings.devToolsEnabled !== false) mainWin.webContents.openDevTools({ mode: 'detach' });
      return;
    }
    if (inputMatchesKeybinding(input, kb.toggleAccounts || { ctrl: false, alt: true, shift: false, key: 'a' })) {
      event.preventDefault();
      accountsSidebarOpen = !accountsSidebarOpen; applyActiveTab();
      mainWin.webContents.send('accounts-sidebar-state', accountsSidebarOpen);
      return;
    }
    if (!input.control) return;
    if (appSettings.devToolsEnabled !== false && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
      tabs.find(t => t.id === activeTabId)?.view.webContents.openDevTools({ mode: 'detach' });
    }
    if (inputMatchesKeybinding(input, kb.nextTab || { ctrl: true, alt: false, shift: false, key: 'Tab' }) ||
      inputMatchesKeybinding(input, kb.prevTab || { ctrl: true, alt: false, shift: true, key: 'Tab' })) {
      event.preventDefault();
      const idx = tabs.findIndex(t => t.id === activeTabId);
      const fwd = inputMatchesKeybinding(input, kb.nextTab || { ctrl: true, alt: false, shift: false, key: 'Tab' });
      activeTabId = tabs[fwd ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length].id;
      applyActiveTab(); pushTabsUpdate();
    }
  });

  mainWin.on('resize', applyActiveTab);
  mainWin.on('restore', applyActiveTab);
  mainWin.on('show', applyActiveTab);
  mainWin.on('focus', applyActiveTab);
  mainWin.on('close', () => {
    tabs.forEach(t => { try { mainWin.removeBrowserView(t.view); } catch (_) { } });
  });
  mainWin.on('closed', () => { mainWin = null; });
}
function createCompanionWindow() {
  const state = readJSON('companion-state.json', { url: CHATGPT_URL });

  companionWin = new BrowserWindow({
    width: 398, height: 574, minWidth: 280, minHeight: 340,
    frame: false, alwaysOnTop: true, show: false,
    backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
    title: 'Companion',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 13 } }
      : {}),
  });

  companionWin.loadFile(path.join(__dirname, 'ui', 'companion.html'));

  companionView = new BrowserView({
    webPreferences: { session: companionSession(), nodeIntegration: false, contextIsolation: true }
  });

  companionWin.addBrowserView(companionView);
  companionView.webContents.loadURL(state.url || CHATGPT_URL);

  companionWin.webContents.once('did-finish-load', () => {
    setCompanionViewBounds();
    companionWin.webContents.send('platform', process.platform);
    companionWin.webContents.send('accounts-update', accounts);
    companionWin.webContents.send('keybindings-update', { keybindings, helpOverrides });
  });

  companionView.webContents.on('dom-ready', () => injectNavigatorShareHook(companionView.webContents));

  companionView.webContents.on('did-navigate', (_, url) => {
    if (!url.startsWith('file://')) writeJSON('companion-state.json', { url });
  });

  companionView.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const kb = keybindings;
    if (input.key === 'F12') {
      if (appSettings.devToolsEnabled !== false) {
        event.preventDefault();
        companionWin?.webContents.openDevTools({ mode: 'detach' });
      }
      return;
    }
    if (input.key === 'F5' || inputMatchesKeybinding(input, kb.reloadTab || { ctrl: true, alt: false, shift: false, key: 'r' })) {
      event.preventDefault();
      companionView.webContents.reload();
      return;
    }
    if (inputMatchesKeybinding(input, kb.toggleAccounts || { ctrl: false, alt: true, shift: false, key: 'a' })) {
      event.preventDefault();
      companionWin?.webContents.send('toggle-accounts-panel');
      return;
    }
  });

  companionWin.webContents.on('before-input-event', (_, input) => {
    if (input.key === 'F12' && input.type === 'keyDown' && appSettings.devToolsEnabled !== false) {
      companionWin.webContents.openDevTools({ mode: 'detach' });
    }
  });

  companionWin.on('resize', setCompanionViewBounds);
  companionWin.on('focus', focusCompanionView);
  companionWin.on('close', e => { e.preventDefault(); companionWin.hide(); companionVisible = false; });
}

function focusCompanionView() {
  if (!companionView || companionView.webContents.isDestroyed()) return;
  // small delay to give safety in finishing activating before stealing focus
  setImmediate(() => {
    if (!companionView || companionView.webContents.isDestroyed()) return;
    companionView.webContents.focus();
  });
}

function toggleCompanion() {
  if (!companionWin) return;
  if (companionVisible) { companionWin.hide(); companionVisible = false; }
  else {
    companionWin.show();
    companionWin.focus();
    companionVisible = true;
    focusCompanionView();
  }
}

ipcMain.handle('show-toast', (_, msg, type) => {
  // now rendered inline in main.html
});

ipcMain.handle('show-companion-toast', (_, msg, type) => {
  if (companionWin && !companionWin.isDestroyed()) {
    companionWin.webContents.send('companion-toast', msg, type);
  }
});
ipcMain.handle('get-init-data', () => ({
  tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url })),
  activeId: activeTabId, accounts: readJSON('accounts.json', {}),
  accountsSidebarOpen, platform: process.platform,
}));

ipcMain.handle('new-tab', (_, url) => {
  const tab = createTabView(url || CHATGPT_URL);
  activeTabId = tab.id; setTimeout(() => { applyActiveTab(); pushTabsUpdate(); }, 0);
  return tab.id;
});
ipcMain.handle('close-tab', (_, id) => closeTab(id));
ipcMain.handle('switch-tab', (_, id) => { activeTabId = id; setTimeout(() => { applyActiveTab(); pushTabsUpdate(); }, 0); });
ipcMain.handle('new-chat', (_, isComp) => {
  if (isComp) companionView?.webContents.loadURL(CHATGPT_URL);
  else tabs.find(t => t.id === activeTabId)?.view.webContents.loadURL(CHATGPT_URL);
});

ipcMain.handle('reorder-tabs', (_, orderedIds) => {
  const sorted = [];
  for (const id of orderedIds) { const t = tabs.find(t => t.id === id); if (t) sorted.push(t); }
  tabs.forEach(t => { if (!sorted.includes(t)) sorted.push(t); });
  tabs = sorted; pushTabsUpdate();
});

ipcMain.handle('toggle-accounts-sidebar', () => {
  accountsSidebarOpen = !accountsSidebarOpen; applyActiveTab();
  mainWin?.webContents.send('accounts-sidebar-state', accountsSidebarOpen);
  return accountsSidebarOpen;
});

ipcMain.handle('toggle-help-sidebar', () => {
  helpSidebarOpen = !helpSidebarOpen; applyActiveTab();
  mainWin?.webContents.send('help-sidebar-state', helpSidebarOpen);
  return helpSidebarOpen;
});

ipcMain.handle('window-control', (event, action) => {
  const src = event.sender;
  let win = null;
  if (src === mainWin?.webContents) win = mainWin;
  else if (src === companionWin?.webContents) win = companionWin;
  else if (src === prefsWin?.webContents) win = prefsWin;
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
});

function broadcastAccounts() {
  accounts = readJSON('accounts.json', {});
  mainWin?.webContents.send('accounts-update', accounts);
  companionWin?.webContents.send('accounts-update', accounts);
}

ipcMain.handle('save-account', async (_, name) => {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab) return false;
  const cookies = await getSession(activeTab.partition).cookies.get({});
  accounts = readJSON('accounts.json', {});
  accounts[name] = { cookies, savedAt: new Date().toISOString() };
  writeJSON('accounts.json', accounts);
  broadcastAccounts();
  return true;
});

ipcMain.handle('delete-account', (_, name) => {
  accounts = readJSON('accounts.json', {});
  delete accounts[name]; writeJSON('accounts.json', accounts);
  if (lastUsedAccount === name) lastUsedAccount = null;
  broadcastAccounts(); return true;
});

ipcMain.handle('reorder-accounts', (_, orderedNames) => {
  accounts = readJSON('accounts.json', {});
  const reordered = {};
  for (const name of orderedNames) { if (accounts[name]) reordered[name] = accounts[name]; }
  for (const name of Object.keys(accounts)) { if (!reordered[name]) reordered[name] = accounts[name]; }
  accounts = reordered;
  writeJSON('accounts.json', accounts);
  broadcastAccounts();
});

ipcMain.handle('clear-cookies', async () => {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab) return false;
  await clearCookies(activeTab.partition);
  activeTab.view.webContents.loadURL(CHATGPT_URL);
  return true;
});

ipcMain.handle('switch-account', async (_, { name }) => {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab) return { ok: false, error: 'No active tab' };
  accounts = readJSON('accounts.json', {});
  const data = accounts[name];
  if (!data) return { ok: false, error: 'Account not found' };
  await clearCookies(activeTab.partition);
  await restoreCookies(data.cookies, activeTab.partition);
  await getSession(activeTab.partition).cookies.flushStore();
  activeTab.view.webContents.loadURL(CHATGPT_URL);
  lastUsedAccount = name;
  return { ok: true };
});

ipcMain.handle('switch-with-context', async (_, name) => {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab) return { ok: false, error: 'No active tab' };
  accounts = readJSON('accounts.json', {});
  const data = accounts[name];
  if (!data) return { ok: false, error: 'Account not found' };
  let shareUrl = null;
  try { shareUrl = await getShareLink(); } catch (_) { }
  await clearCookies(activeTab.partition);
  await restoreCookies(data.cookies, activeTab.partition);
  await getSession(activeTab.partition).cookies.flushStore();
  activeTab.view.webContents.loadURL(shareUrl || CHATGPT_URL);
  lastUsedAccount = name;
  return { ok: true, shareUrl };
});

ipcMain.handle('get-share-link', async () => {
  const link = await getShareLink();
  if (link) {
    const current = tabs.find(t => t.id === activeTabId)?.view.webContents.getURL();
    if (isShareUrl(current)) clipboard.writeText(link);
  }
  return link;
});

ipcMain.handle('focus-main', () => {
  if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus(); }
  else createMainWindow();
});

ipcMain.handle('companion-panel-resize', (_, h) => {
  companionPanelH = h; setCompanionViewBounds();
});

ipcMain.handle('companion-switch-account', async (_, name) => {
  accounts = readJSON('accounts.json', {});
  const data = accounts[name];
  if (!data) return { ok: false, error: 'Account not found' };
  await clearCookies(COMPANION_PARTITION);
  await restoreCookies(data.cookies, COMPANION_PARTITION);
  await companionSession().cookies.flushStore();
  companionView?.webContents.loadURL(CHATGPT_URL);
  lastUsedAccount = name;
  return { ok: true };
});

ipcMain.handle('companion-switch-with-context', async (_, name) => {
  accounts = readJSON('accounts.json', {});
  const data = accounts[name];
  if (!data) return { ok: false, error: 'Account not found' };
  let shareUrl = null;
  const compUrl = companionView?.webContents.getURL();
  if (isShareUrl(compUrl)) shareUrl = compUrl;
  else try { shareUrl = await getShareLink(); } catch (_) { }
  await clearCookies(COMPANION_PARTITION);
  await restoreCookies(data.cookies, COMPANION_PARTITION);
  await companionSession().cookies.flushStore();
  companionView?.webContents.loadURL(shareUrl || CHATGPT_URL);
  lastUsedAccount = name;
  return { ok: true, shareUrl };
});

ipcMain.handle('open-in-main', async () => {
  const url = companionView?.webContents.getURL() || CHATGPT_URL;
  const cookies = await companionSession().cookies.get({});

  const tab = createTabView(CHATGPT_URL, null, { noSeed: true });
  await restoreCookies(cookies, tab.partition);
  await getSession(tab.partition).cookies.flushStore();

  const wc = tab.view.webContents;
  wc.loadURL(url);

  tab.url = url;
  activeTabId = tab.id;

  if (mainWin && !mainWin.isDestroyed()) {
    applyActiveTab();
    pushTabsUpdate();
    mainWin.show();
    mainWin.focus();
  } else {
    createMainWindow();
  }

  return true;
});

ipcMain.handle('export-accounts', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
    title: 'Export Account List',
    defaultPath: `chatgpt-accounts-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const data = readJSON('accounts.json', {});
  const payload = { version: 1, exportedAt: new Date().toISOString(), accounts: data };
  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    return { ok: true, count: Object.keys(data).length };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('import-accounts', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWin, {
    title: 'Import Account List',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  let payload;
  try { payload = JSON.parse(fs.readFileSync(filePaths[0], 'utf8')); }
  catch (e) { return { ok: false, error: 'Could not read file: ' + e.message }; }
  if (!payload || typeof payload.accounts !== 'object')
    return { ok: false, error: 'Invalid account file format.' };

  const incoming = payload.accounts;
  const existing = readJSON('accounts.json', {});
  const existingNames = new Set(Object.keys(existing));
  const conflicts = Object.keys(incoming).filter(n => existingNames.has(n));
  let added = 0;
  for (const [name, data] of Object.entries(incoming)) {
    if (existingNames.has(name)) {
      let newName = `${name} (imported)`, i = 2;
      while (existing[newName]) newName = `${name} (imported ${i++})`;
      existing[newName] = data;
    } else {
      existing[name] = data;
    }
    added++;
  }
  writeJSON('accounts.json', existing);
  broadcastAccounts();
  return { ok: true, added, conflicts: conflicts.length };
});

app.whenReady().then(() => {
  DATA_PATH = app.getPath('userData');
  accounts = readJSON('accounts.json', {});
  lastUsedAccount = readJSON('last-account.json', { name: null }).name;
  loadKeybindings();
  loadAppSettings();

  const loginEnabled = isLoginItemEnabled();
  if (loginEnabled !== (appSettings.openOnStartup !== false)) {
    setLoginItem(appSettings.openOnStartup !== false);
  }

  createMainWindow();
  createCompanionWindow();
  registerGlobalKeybindings();

  // startMinimized only applies when the OS launched the app at login,
  // not when the user opens it manually
  const launchedAtLogin = wasLaunchedAtLogin();
  if (appSettings.startMinimized && launchedAtLogin && mainWin) mainWin.minimize();
  if (!appSettings.companionOnTop && companionWin) companionWin.setAlwaysOnTop(false);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (companionView) {
    const url = companionView.webContents.getURL();
    if (url && !url.startsWith('file://')) writeJSON('companion-state.json', { url });
  }
  if (lastUsedAccount) writeJSON('last-account.json', { name: lastUsedAccount });
});

app.on('window-all-closed', () => { });

// on macOS, clicking the dock icon while the app is already running fires
// 'activate', not 'second-instance'. Without this handler, the click does nothing.
app.on('activate', () => {
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore();
    if (!mainWin.isVisible()) mainWin.show();
    mainWin.focus();
  } else {
    createMainWindow();
  }
});

// preferences window ipc
ipcMain.handle('open-preferences-win', () => createPreferencesWindow());

ipcMain.handle('suspend-global-keybindings', () => { globalShortcut.unregisterAll(); });
ipcMain.handle('resume-global-keybindings', () => { registerGlobalKeybindings(); });

ipcMain.handle('get-keybindings', () => ({ keybindings, helpOverrides }));

ipcMain.handle('save-keybindings', (_, payload) => {
  if (payload.keybindings) keybindings = { ...DEFAULT_KEYBINDINGS, ...payload.keybindings };
  if (payload.helpOverrides !== undefined) helpOverrides = payload.helpOverrides;
  saveKeybindings();
  registerGlobalKeybindings();
  broadcastKeybindings();
  return true;
});

ipcMain.handle('toggle-accounts-main', () => {
  accountsSidebarOpen = !accountsSidebarOpen; applyActiveTab();
  mainWin?.webContents.send('accounts-sidebar-state', accountsSidebarOpen);
  return accountsSidebarOpen;
});

ipcMain.handle('toggle-accounts-companion', () => {
  companionWin?.webContents.send('toggle-accounts-panel');
  return true;
});

ipcMain.handle('reload-tab', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.reload();
  return true;
});

ipcMain.handle('reload-companion', () => {
  if (companionView && !companionView.webContents.isDestroyed()) companionView.webContents.reload();
  return true;
});

ipcMain.handle('focus-companion-view', () => { focusCompanionView(); });

const DEFAULT_SETTINGS = {
  openOnStartup: true,
  startMinimized: true,
  companionOnTop: true,
  devToolsEnabled: true,
};
let appSettings = { ...DEFAULT_SETTINGS };

function loadAppSettings() {
  const saved = readJSON('settings.json', null);
  if (saved) appSettings = { ...DEFAULT_SETTINGS, ...saved };
}
function broadcastSettings() {
  [mainWin, companionWin, prefsWin].forEach(w => {
    if (w && !w.isDestroyed()) w.webContents.send('settings-update', appSettings);
  });
}
ipcMain.handle('get-app-settings', async () => {
  // sync the stored openOnStartup flag with the real OS login-item state
  // probably unnecessary but adds some safety
  try { appSettings.openOnStartup = isLoginItemEnabled(); } catch (_) { }
  return appSettings;
});
ipcMain.handle('get-default-settings', () => DEFAULT_SETTINGS);
ipcMain.handle('save-app-settings', async (_, opts) => {
  const prev = appSettings.openOnStartup;
  appSettings = { ...DEFAULT_SETTINGS, ...opts };
  writeJSON('settings.json', appSettings);
  broadcastSettings();
  if (companionWin && !companionWin.isDestroyed())
    companionWin.setAlwaysOnTop(!!appSettings.companionOnTop);
  // sync OS login item if openOnStartup changed
  if (appSettings.openOnStartup !== prev) {
    setLoginItem(appSettings.openOnStartup);
  }
  return true;
});