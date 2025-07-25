// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { machineIdSync } = require('node-machine-id');

const { autoUpdater } = require('electron-updater'); 

const WhatsAppBot = require('./bot');
const QRCode = require('qrcode');

let mainWindow;
let bot;

const API_BASE_URL = 'https://us-central1-bot-lisensi-saya.cloudfunctions.net';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 750,
        icon: path.join(__dirname, 'logo.ico'), // <-- DIUBAH
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    mainWindow.loadFile('index.html');
    mainWindow.setMenu(null);
}

app.whenReady().then(() => {
    createWindow();
    
    autoUpdater.checkForUpdatesAndNotify();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ... Sisa kode main.js Anda tetap sama ...
// --- Handler untuk Login & Pendaftaran (Menghubungi Server) ---
ipcMain.handle('login-attempt', async (event, { email, password }) => {
    try {
        const id = machineIdSync();
        const response = await axios.post(`${API_BASE_URL}/login`, {
            email, password, machineId: id,
        });
        return { success: true, ...response.data };
    } catch (error) {
        return { success: false, message: error.response?.data?.error || 'Tidak dapat terhubung ke server.' };
    }
});

ipcMain.handle('register-attempt', async (event, { email, password, duration }) => {
    try {
        const response = await axios.post(`${API_BASE_URL}/register`, {
            email, password, duration,
        });
        return { success: true, ...response.data };
    } catch (error) {
        return { success: false, message: error.response?.data?.error || 'Gagal melakukan pendaftaran.' };
    }
});

// --- Handler untuk Jadwal (Lokal) ---
ipcMain.handle('get-messages', async () => {
    const filePath = path.join(__dirname, 'messages.json');
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '[]', 'utf-8');
        return [];
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
});

ipcMain.handle('save-messages', async (event, messages) => {
    const filePath = path.join(__dirname, 'messages.json');
    fs.writeFileSync(filePath, JSON.stringify(messages, null, 2));
    return { success: true };
});

// --- Handler Lainnya (Lokal) ---
ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [ { name: 'Media', extensions: ['jpg', 'png', 'mp4', 'pdf'] } ]
    });
    if (result.canceled) return null;
    return './' + path.relative(__dirname, result.filePaths[0]).replace(/\\/g, '/');
});

// --- Handler Bot ---
ipcMain.on('start-bot', () => {
    if (bot && bot.isReady()) {
        mainWindow.webContents.send('log-message', 'INFO: Bot sudah berjalan.');
        return;
    }
    bot = new WhatsAppBot();
    bot.on('qr', (qr) => {
        QRCode.toDataURL(qr, (err, url) => {
            if (err) return;
            mainWindow.webContents.send('display-qr', url);
        });
    });
    bot.on('ready', () => {
        mainWindow.webContents.send('bot-ready');
        mainWindow.webContents.send('log-message', '✅ Bot WhatsApp aktif dan terhubung.');
        bot.getGroups().then(groups => mainWindow.webContents.send('update-groups', groups));
    });
    bot.on('log', (message) => mainWindow.webContents.send('log-message', message));
    bot.on('disconnected', () => {
        mainWindow.webContents.send('log-message', '🔌 Bot terputus.');
        bot = null;
    });
    bot.initialize();
});

ipcMain.on('stop-bot', () => {
    if (bot) {
        bot.stop();
        bot = null;
        mainWindow.webContents.send('bot-stopped');
        mainWindow.webContents.send('log-message', '🛑 Bot telah dihentikan.');
    }
});

ipcMain.on('reset-wa', () => {
    if (bot) { bot.stop(); bot = null; }
    const sessionPath = path.join(__dirname, '.wwebjs_auth');
    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        mainWindow.webContents.send('bot-stopped');
        mainWindow.webContents.send('log-message', '🔄 Sesi WhatsApp berhasil direset.');
    } else {
        mainWindow.webContents.send('log-message', 'INFO: Tidak ada sesi yang perlu direset.');
    }
});

ipcMain.on('run-sender', (event, { groupIds }) => {
    if (bot && bot.isReady()) {
        const filePath = path.join(__dirname, 'messages.json');
        if (!fs.existsSync(filePath)) {
            mainWindow.webContents.send('log-message', '❌ Gagal memulai: file messages.json tidak ditemukan.');
            return;
        }
        const data = fs.readFileSync(filePath, 'utf-8');
        bot.startSending(groupIds, JSON.parse(data));
    } else {
        mainWindow.webContents.send('log-message', '❌ Bot belum siap. Silakan klik "Start Bot" terlebih dahulu.');
    }
});