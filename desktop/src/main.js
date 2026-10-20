const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#EFEDE6',
    frame: true,
    titleBarStyle: 'default',
    title: 'Pain — Local Audio & Sync Companion',
    icon: process.platform === 'win32' ? path.join(__dirname, '..', 'assets', 'app-icon.ico') : path.join(__dirname, '..', 'assets', 'app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Wait for the actual listening port, including when 3000 is already occupied.
  process.env.OPEN_BROWSER='false';
  const server=require('./server.js');
  const load=()=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.loadURL(`http://localhost:${server.address().port}`);};
  if(server.listening)load();else server.once('listening',load);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
