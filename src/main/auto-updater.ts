import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow } from 'electron';

/**
 * Auto-updater module using electron-updater.
 * Checks for updates on GitHub Releases and notifies the user.
 */
export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  // Don't check in development
  if (process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged) {
    console.log('[AutoUpdater] Skipping — not packaged');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log(`[AutoUpdater] Update available: v${info.version}`);
    const win = getWindow();
    if (win) {
      win.webContents.send('updater:available', {
        version: info.version,
        releaseNotes: info.releaseNotes,
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdater] Already up to date');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[AutoUpdater] Download: ${Math.round(progress.percent)}%`);
    const win = getWindow();
    if (win) {
      win.webContents.send('updater:progress', {
        percent: Math.round(progress.percent),
        bytesPerSecond: progress.bytesPerSecond,
      });
    }
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    console.log(`[AutoUpdater] Downloaded v${info.version}, will install on quit`);
    const win = getWindow();
    if (win) {
      win.webContents.send('updater:downloaded', { version: info.version });
    }
  });

  autoUpdater.on('error', (err: Error) => {
    console.error('[AutoUpdater] Error:', err.message);
  });

  // Check on startup (after 10 seconds)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[AutoUpdater] Check failed:', err.message);
    });
  }, 10000);

  // Check every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 4 * 60 * 60 * 1000);
}
