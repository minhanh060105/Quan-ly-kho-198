const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  printBarcodeTicket: (barcodeData) => ipcRenderer.invoke('print-barcode-ticket', barcodeData)
});
