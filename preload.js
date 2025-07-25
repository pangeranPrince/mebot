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

    // Menerima event dari Main
    on: (channel, func) => {
        const validChannels = ['display-qr', 'log-message', 'bot-ready', 'bot-stopped', 'update-groups'];
        if (validChannels.includes(channel)) {
            ipcRenderer.removeAllListeners(channel);
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    },
});