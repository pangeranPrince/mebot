// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Fungsi Otentikasi (Server)
    loginAttempt: (credentials) => ipcRenderer.invoke('login-attempt', credentials),
    registerAttempt: (data) => ipcRenderer.invoke('register-attempt', data),

    // Fungsi Jadwal (Lokal)
    getMessages: () => ipcRenderer.invoke('get-messages'),
    saveMessages: (messages) => ipcRenderer.invoke('save-messages', messages),

    // Fungsi Lainnya (Lokal)
    selectFile: () => ipcRenderer.invoke('select-file'),

    // Fungsi Bot
    startBot: () => ipcRenderer.send('start-bot'),
    stopBot: () => ipcRenderer.send('stop-bot'),
    resetWA: () => ipcRenderer.send('reset-wa'),
    runSender: (data) => ipcRenderer.send('run-sender', data),

    // BARU: Fungsi untuk memicu instalasi update
    installUpdate: () => ipcRenderer.send('install-update'),

    // Menerima event dari Main
    on: (channel, func) => {
        // BARU: Tambahkan 'update-ready' ke channel yang valid
        const validChannels = ['display-qr', 'log-message', 'bot-ready', 'bot-stopped', 'update-groups', 'update-ready'];
        if (validChannels.includes(channel)) {
            // Hapus listener lama untuk menghindari duplikasi
            ipcRenderer.removeAllListeners(channel); 
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    },
});