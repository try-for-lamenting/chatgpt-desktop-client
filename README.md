# ChatGPT Desktop Client

A custom Electron-based desktop client for ChatGPT with multi-account management, tabbed browsing, and a floating companion window.

**Disclaimer: made primarily with Claude AI.**

---

## Features

### Multi-Account Management
- Save any number of named accounts as cookie snapshots
- Switch accounts instantly — cookies are swapped without a full sign-out
- **Load with Context** restores the previous conversation under the new account via share link
- Import and export accounts as JSON for backup or migration
- Drag to reorder accounts in the switcher panel

### Tabbed Browsing
- Open multiple isolated ChatGPT sessions in separate tabs
- Each tab runs in its own browser partition (no session bleed between tabs)
- Drag tabs to reorder; close with `Ctrl+W` or the × button
- The last active URL per tab is preserved across reloads

### Companion Window
- A slim, always-on-top floating window for quick queries without leaving your current app
- Toggle globally with `Win+Alt+/` (customizable) from anywhere on your system
- Has its own account panel — switch accounts without opening the main window
- **Open in Main** moves the current companion session into a full main-window tab

### Preferences


---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or later recommended)
- npm (bundled with Node.js)

### Install & Run

```bash
npm install
npm start
```

### Build

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

Builds are output to the `dist/` folder.

---

## Default Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+R` | Reload tab |
| `Alt+A` | Toggle account panel |
| `Win+Alt+/` | Toggle companion window (global) |

All shortcuts are remappable via **Preferences** (gear icon in the toolbar).

---

## Adding Accounts

1. Open the Account Switcher (`Alt+A` or the person icon in the toolbar)
2. Click **Clear Cookies** to sign out the current tab
3. Sign into ChatGPT with the account you want to save
4. Type a name (e.g. *Work*) and click **Save**
5. Repeat for each additional account