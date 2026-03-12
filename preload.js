const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getInitData: () => ipcRenderer.invoke('get-init-data'),
  newTab: (url) => ipcRenderer.invoke('new-tab', url),
  closeTab: (id) => ipcRenderer.invoke('close-tab', id),
  switchTab: (id) => ipcRenderer.invoke('switch-tab', id),
  reorderTabs: (ids) => ipcRenderer.invoke('reorder-tabs', ids),
  toggleAccountsSidebar: () => ipcRenderer.invoke('toggle-accounts-sidebar'),
  toggleHelpSidebar: () => ipcRenderer.invoke('toggle-help-sidebar'),
  windowControl: (a) => ipcRenderer.invoke('window-control', a),

  reorderAccounts: (names) => ipcRenderer.invoke('reorder-accounts', names),
  saveAccount: (name) => ipcRenderer.invoke('save-account', name),
  deleteAccount: (name) => ipcRenderer.invoke('delete-account', name),
  clearCookies: () => ipcRenderer.invoke('clear-cookies'),
  switchAccount: (name) => ipcRenderer.invoke('switch-account', { name }),
  switchWithContext: (name) => ipcRenderer.invoke('switch-with-context', name),
  getShareLink: () => ipcRenderer.invoke('get-share-link'),

  focusMain: () => ipcRenderer.invoke('focus-main'),
  openInMain: () => ipcRenderer.invoke('open-in-main'),
  reloadCompanion: () => ipcRenderer.invoke('reload-companion'),
  focusCompanionView: () => ipcRenderer.invoke('focus-companion-view'),
  companionPanelResize: (h) => ipcRenderer.invoke('companion-panel-resize', h),
  companionSwitchAccount: (name) => ipcRenderer.invoke('companion-switch-account', name),
  companionSwitchWithContext: (name) => ipcRenderer.invoke('companion-switch-with-context', name),

  exportAccounts: () => ipcRenderer.invoke('export-accounts'),
  importAccounts: () => ipcRenderer.invoke('import-accounts'),

  showToast: (msg, type) => ipcRenderer.invoke('show-toast', msg, type),
  showCompanionToast: (msg, type) => ipcRenderer.invoke('show-companion-toast', msg, type),

  reloadTab: () => ipcRenderer.invoke('reload-tab'),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),

  // preferences window
  openPreferencesWin: () => ipcRenderer.invoke('open-preferences-win'),
  suspendGlobalKeybindings: () => ipcRenderer.invoke('suspend-global-keybindings'),
  resumeGlobalKeybindings: () => ipcRenderer.invoke('resume-global-keybindings'),
  getKeybindings: () => ipcRenderer.invoke('get-keybindings'),
  saveKeybindings: (data) => ipcRenderer.invoke('save-keybindings', data),
  toggleAccountsMain: () => ipcRenderer.invoke('toggle-accounts-main'),
  toggleAccountsCompanion: () => ipcRenderer.invoke('toggle-accounts-companion'),

  // startup options
  getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
  getDefaultSettings: () => ipcRenderer.invoke('get-default-settings'),
  saveAppSettings: (opts) => ipcRenderer.invoke('save-app-settings', opts),

  onTabsUpdate: cb => ipcRenderer.on('tabs-update', (_, d) => cb(d)),
  onAccountsUpdate: cb => ipcRenderer.on('accounts-update', (_, d) => cb(d)),
  onAccountsSidebarState: cb => ipcRenderer.on('accounts-sidebar-state', (_, v) => cb(v)),
  onHelpSidebarState: cb => ipcRenderer.on('help-sidebar-state', (_, v) => cb(v)),
  onPlatform: cb => ipcRenderer.on('platform', (_, v) => cb(v)),
  onKeybindingsUpdate: cb => ipcRenderer.on('keybindings-update', (_, d) => cb(d)),
  onToggleAccountsPanel: cb => ipcRenderer.on('toggle-accounts-panel', () => cb()),
  onCompanionToast: cb => ipcRenderer.on('companion-toast', (_, msg, type) => cb(msg, type)),
  onSettingsUpdate: cb => ipcRenderer.on('settings-update', (_, d) => cb(d)),
});
