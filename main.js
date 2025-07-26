// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { machineIdSync } = require('node-machine-id');
const keytar = require('keytar'); 

const { autoUpdater } = require('electron-updater'); 
const WhatsAppBot = require('./bot');
const QRCode = require('qrcode');

let mainWindow;
let bot;

const SERVICE_NAME = 'MEBOT';
const ACCOUNT_NAME = 'userCredentials';

// Anda perlu memindahkan fungsi ini ke sini agar bisa diakses oleh handler 'start-bot'
const getPuppeteerExecPath = () => {
    if (app.isPackaged) {
        try {
            const unpackedDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'puppeteer', '.local-chromium');
            if (fs.existsSync(unpackedDir)) {
                const versionFolders = fs.readdirSync(unpackedDir);
                const win64Folder = versionFolders.find(folder => folder.startsWith('win64-'));
                if (win64Folder) {
                    const execPath = path.join(unpackedDir, win64Folder, 'chrome-win', 'chrome.exe');
                    if (fs.existsSync(execPath)) { return execPath; }
                }
            }
        } catch (error) { console.error('Gagal menemukan puppeteer di unpacked dir:', error); }
    }
    try { return require('puppeteer').executablePath(); } 
    catch (e) { console.error("Gagal memuat puppeteer:", e); return null; }
};


function sendLog(message) {
    if (mainWindow) {
        mainWindow.webContents.send('log-message', `[Updater] ${message}`);
    }
}

// --- KONFIGURASI AUTO UPDATER ---
autoUpdater.on('checking-for-update', () => sendLog('Mencari pembaruan...'));
autoUpdater.on('update-available', (info) => sendLog(`Pembaruan tersedia: v${info.version}`));
autoUpdater.on('update-not-available', (info) => sendLog('Tidak ada pembaruan yang tersedia.'));
autoUpdater.on('error', (err) => sendLog(`Error saat memperbarui: ${err.message}`));
autoUpdater.on('download-progress', (progressObj) => {
    let log_message = `Mengunduh: ${progressObj.percent.toFixed(2)}%`;
    log_message = log_message + ` (${(progressObj.bytesPerSecond / 1024).toFixed(2)} KB/s)`;
    sendLog(log_message);
});
autoUpdater.on('update-downloaded', (info) => {
    sendLog(`Pembaruan v${info.version} telah diunduh. Menunggu konfirmasi pengguna.`);
    if (mainWindow) {
        console.log('✅ Jendela utama ditemukan. Mengirim event "update-ready" ke renderer...');
        mainWindow.webContents.send('update-ready', info.version);
    } else {
        console.error('❌ Jendela utama TIDAK ditemukan. Tidak dapat mengirim event "update-ready".');
    }
});
// ------------------------------------------------

const API_BASE_URL = 'https://us-central1-bot-lisensi-saya.cloudfunctions.net';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 750,
        icon: path.join(__dirname, 'logo.ico'),
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
    
    autoUpdater.checkForUpdates();

    setInterval(() => {
        autoUpdater.checkForUpdates();
    }, 3600000); 
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall();
});


// --- Handler untuk Login & Pendaftaran (Menghubungi Server) ---
ipcMain.handle('login-attempt', async (event, { email, password, rememberMe }) => {
    try {
        const id = machineIdSync();
        const response = await axios.post(`${API_BASE_URL}/login`, {
            email, password, machineId: id,
        });

        if (rememberMe) {
            await keytar.setPassword(SERVICE_NAME, 'userEmail', email);
            await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, password);
        } else {
            await keytar.deletePassword(SERVICE_NAME, 'userEmail');
            await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
        }

        return { success: true, ...response.data };
    } catch (error) {
        return { success: false, message: error.response?.data?.error || 'Tidak dapat terhubung ke server.' };
    }
});

ipcMain.handle('get-saved-credentials', async () => {
    try {
        const email = await keytar.getPassword(SERVICE_NAME, 'userEmail');
        const password = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
        if (email && password) {
            return { email, password };
        }
        return null;
    } catch (error) {
        console.error('Gagal mengambil kredensial:', error);
        return null;
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
    const userDataPath = app.getPath('userData');
    const filePath = path.join(userDataPath, 'messages.json');
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '[]', 'utf-8');
        return [];
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
});

ipcMain.handle('save-messages', async (event, messages) => {
    const userDataPath = app.getPath('userData');
    const filePath = path.join(userDataPath, 'messages.json');
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
    return result.filePaths[0]; 
});

// --- Handler Bot ---
ipcMain.on('start-bot', () => {
    // Pengecekan file puppeteer sebelum start bot
    const puppeteerPath = getPuppeteerExecPath();
    if (!fs.existsSync(puppeteerPath)) {
        dialog.showErrorBox(
            'Error Kritis', 
            'Komponen browser (Puppeteer) tidak ditemukan. Ini mungkin disebabkan oleh Antivirus. Coba install ulang aplikasi atau tambahkan folder instalasi MEBOT ke daftar pengecualian Antivirus Anda.'
        );
        return;
    }

    if (bot && bot.isReady()) {
        mainWindow.webContents.send('log-message', 'INFO: Bot sudah berjalan.');
        return;
    }

    const sessionPath = path.join(app.getPath('userData'), '.wwebjs_auth');
    bot = new WhatsAppBot(sessionPath);
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
    const sessionPath = path.join(app.getPath('userData'), '.wwebjs_auth');
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
        const userDataPath = app.getPath('userData');
        const filePath = path.join(userDataPath, 'messages.json');
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