const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

let mainWindow = null;
let tray = null;
let serverProcess = null;
const PORT = 3000;
const SERVER_URL = `http://localhost:${PORT}`;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function waitForServer(url, timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(url, (res) => {
          if (res.statusCode < 500) {
            resolve();
          } else {
            retry();
          }
        })
        .on('error', () => {
          retry();
        });
    };

    const retry = () => {
      if (Date.now() - start > timeout) {
        reject(new Error('Server start timed out'));
      } else {
        setTimeout(check, 500);
      }
    };

    check();
  });
}

function startNextServer() {
  const isDev = process.env.NODE_ENV !== 'production';
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = isDev ? ['run', 'dev'] : ['run', 'start'];

  serverProcess = spawn(npmCmd, args, {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(PORT) },
    shell: true,
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start Next.js process:', err);
  });

  serverProcess.on('exit', (code) => {
    console.log(`Next.js process exited with code ${code}`);
  });
}

function createMainWindow() {
  const iconPath = path.join(__dirname, 'public', 'logo-icon.png');
  const appIcon = nativeImage.createFromPath(iconPath);

  mainWindow = new BrowserWindow({
    width: 1300,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'Krayn AI - Autonomous Learning & Email Assistant',
    icon: appIcon,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#FFFFFF',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron', 'preload.js'),
    },
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in default OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Minimize to tray on close if user wants background email monitoring
  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'public', 'logo-icon.png');
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);
  tray.setToolTip('Krayn AI - Email Monitoring Active');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Krayn AI',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Autonomous Polling: Active',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit Krayn AI',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  // Start server if running standalone
  startNextServer();

  try {
    await waitForServer(SERVER_URL);
    createMainWindow();
    createTray();
  } catch (err) {
    console.error('Failed to connect to local server:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  app.isQuiting = true;
  if (serverProcess) {
    serverProcess.kill();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
