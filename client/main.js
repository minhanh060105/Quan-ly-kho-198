const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 768,
    title: 'Hệ thống Quản lý Kho - Khoa Vi sinh - Bệnh viện 198',
    icon: path.join(__dirname, 'src/assets/logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Print one page per label and honor the requested number of copies.
ipcMain.handle('print-barcode-ticket', async (event, barcodeData) => {
  if (event.sender !== mainWindow?.webContents) return { success: false, error: 'Nguồn yêu cầu không hợp lệ.' };
  let printWindow;
  try {
    const html = require('./labels').labelDocument(barcodeData);
    printWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return await new Promise(resolve => printWindow.webContents.print({ silent: false, printBackground: true }, (success, reason) => resolve({ success, error: success ? undefined : reason || 'Đã hủy in.' })));
  } catch (err) { return { success: false, error: err.message }; }
  finally { if (printWindow && !printWindow.isDestroyed()) printWindow.close(); }
});
