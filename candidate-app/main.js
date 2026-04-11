const { app, BrowserWindow, ipcMain, globalShortcut, powerSaveBlocker, screen } = require('electron');
const path = require('path');

let mainWindow;
let blocker;
let monitoring = false;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1100, width - 80),
    height: Math.min(760, height - 80),
    minWidth: 860,
    minHeight: 620,
    backgroundColor: '#050507',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.session.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission === 'media');
  });

  mainWindow.on('blur', () => {
    if (monitoring) mainWindow.webContents.send('focus-lost');
  });
  mainWindow.on('focus', () => {
    if (monitoring) mainWindow.webContents.send('focus-gained');
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ─── IPC ──────────────────────────────────────────────────────────────
ipcMain.handle('session:start', async (_, { sessionCode, candidateName }) => {
  if (!sessionCode || !/^TRV-[A-Z0-9]{6}$/i.test(sessionCode)) {
    return { ok: false, error: 'Please enter a valid session code like TRV-8FR2XP.' };
  }
  monitoring = true;
  try { blocker = powerSaveBlocker.start('prevent-display-sleep'); } catch {}
  // Block common escape shortcuts during the session
  try {
    globalShortcut.registerAll([
      'Alt+F4', 'CommandOrControl+W', 'CommandOrControl+Q', 'F11'
    ], () => {
      if (mainWindow) mainWindow.webContents.send('shortcut-blocked');
    });
  } catch {}
  return { ok: true, sessionCode: sessionCode.toUpperCase(), candidateName: (candidateName || '').trim() };
});

ipcMain.handle('session:end', async () => {
  monitoring = false;
  try { globalShortcut.unregisterAll(); } catch {}
  try { if (blocker !== undefined) powerSaveBlocker.stop(blocker); } catch {}
  return { ok: true };
});

ipcMain.handle('app:quit', () => {
  monitoring = false;
  try { globalShortcut.unregisterAll(); } catch {}
  app.quit();
});

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch {}
  try { if (blocker !== undefined) powerSaveBlocker.stop(blocker); } catch {}
});
