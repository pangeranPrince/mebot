// bot.js
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { app } = require('electron'); // Impor 'app' dari electron

// Fungsi untuk mendapatkan path executable puppeteer yang benar
const getPuppeteerExecPath = () => {
    // Jika aplikasi sudah di-package (produksi)
    if (app.isPackaged) {
        // Path ke folder node_modules di dalam resources/app.asar.unpacked/
        const unpackedDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');

        // Cek apakah puppeteer ada di sana
        if (fs.existsSync(path.join(unpackedDir, 'puppeteer'))) {
            try {
                // Gunakan puppeteer yang ada di sana untuk mendapatkan path executable
                const puppeteer = require(path.join(unpackedDir, 'puppeteer'));
                return puppeteer.executablePath();
            } catch (e) {
                console.error("Gagal memuat puppeteer dari unpacked dir:", e);
                return null;
            }
        }
    }
    // Jika masih dalam development, gunakan path normal
    try {
        return require('puppeteer').executablePath();
    } catch (e) {
        console.error("Gagal memuat puppeteer dari node_modules biasa:", e);
        return null;
    }
};


class WhatsAppBot extends EventEmitter {
    constructor(dataPath) {
        super();

        const puppeteerExecPath = getPuppeteerExecPath();
        if (!puppeteerExecPath) {
             this.emit('log', '❌ FATAL: Tidak dapat menemukan executable Chromium!');
        }

        this.client = new Client({
            authStrategy: new LocalAuth({ dataPath: dataPath }),
            puppeteer: {
                headless: true,
                // Beri tahu puppeteer di mana lokasi chrome.exe
                executablePath: puppeteerExecPath, 
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ],
            }
        });
        this.ready = false;
        this.scheduledJobs = [];
    }

    // ... sisa kode Anda dari sini ke bawah tetap sama persis ...

    initialize() {
        this.emit('log', '⏳ Menginisialisasi bot...');

        this.client.on('qr', (qr) => {
            this.emit('qr', qr);
            this.emit('log', '📲 Silakan scan QR Code untuk menghubungkan WhatsApp.');
        });

        this.client.on('ready', () => {
            this.ready = true;
            this.emit('ready');
        });
        
        this.client.on('disconnected', (reason) => {
            this.ready = false;
            this.emit('disconnected', reason);
        });

        this.client.initialize();
    }

    isReady() {
        return this.ready;
    }

    async getGroups() {
        if (!this.ready) return [];
        this.emit('log', '🔍 Mencari grup di mana bot adalah admin...');
        try {
            const botId = this.client.info.wid._serialized;
            const chats = await this.client.getChats();

            const adminGroups = chats.filter(chat => {
                if (chat.isGroup) {
                    const botParticipant = chat.participants.find(p => p.id._serialized === botId);
                    return botParticipant && botParticipant.isAdmin;
                }
                return false;
            });

            const groups = adminGroups.map(g => ({ id: g.id._serialized, name: g.name }));
            
            this.emit('log', `✅ Ditemukan ${groups.length} grup di mana bot adalah admin.`);
            return groups;
        } catch (error) {
            this.emit('log', `❌ GAGAL mengambil daftar grup: ${error.message}`);
            this.emit('log', 'INFO: Coba restart bot atau reset sesi jika masalah berlanjut.');
            return [];
        }
    }

    startSending(targetGroupIds, scheduledItems) {
        if (!this.ready) {
            this.emit('log', '❌ Bot tidak siap untuk mengirim pesan.');
            return;
        }

        this.emit('log', `▶️ Memulai proses pengiriman ke ${targetGroupIds.length} grup terpilih.`);
        this.clearScheduledJobs();

        this.client.getChats().then(chats => {
            const targetGroupChats = chats.filter(c => c.isGroup && targetGroupIds.includes(c.id._serialized));

            if (targetGroupChats.length === 0) {
                this.emit('log', `🚫 Tidak ada grup yang cocok dengan ID yang dipilih.`);
                return;
            }

            scheduledItems.forEach(item => {
                const [hours, minutes, seconds] = item.time.split(':').map(Number);
                const targetTime = new Date();
                targetTime.setHours(hours, minutes, seconds || 0, 0);

                let delayMs = targetTime.getTime() - new Date().getTime();
                if (delayMs < 0) {
                    delayMs += 24 * 60 * 60 * 1000;
                }

                const sendTimeStr = new Date(Date.now() + delayMs).toLocaleTimeString('id-ID');
                this.emit('log', `📌 jadwal "${item.id}" dikirim ~${sendTimeStr}`);

                const job = setTimeout(async () => {
                    this.emit('log', `🚀 Mengirim pesan terjadwal: "${item.id}"`);
                    for (const groupChat of targetGroupChats) {
                        try {
                            if (item.type === 'text') {
                                const content = Array.isArray(item.content) ? item.content.join('\n') : item.content;
                                await groupChat.sendMessage(content);
                            } else if (['image', 'video', 'document'].includes(item.type)) {
                                const mediaPath = item.path; 
                                if (!fs.existsSync(mediaPath)) {
                                    this.emit('log', `❌ Gagal: File tidak ditemukan di ${item.path} untuk item "${item.id}"`);
                                    continue;
                                }
                                const media = MessageMedia.fromFilePath(mediaPath);
                                const caption = Array.isArray(item.caption) ? item.caption.join('\n') : item.caption;
                                await groupChat.sendMessage(media, { caption: caption || '' });
                            }
                            this.emit('log', `✅ Terkirim "${item.id}" ke grup "${groupChat.name}"`);
                        } catch (err) {
                            this.emit('log', `❌ Gagal mengirim "${item.id}" ke "${groupChat.name}": ${err.message}`);
                        }
                    }
                }, delayMs);
                this.scheduledJobs.push(job);
            });
        });
    }

    clearScheduledJobs() {
        this.scheduledJobs.forEach(job => clearTimeout(job));
        this.scheduledJobs = [];
        this.emit('log', '🔄 Jadwal pengiriman sebelumnya telah dibersihkan.');
    }

    async stop() {
        if (this.client) {
            await this.client.destroy();
            this.ready = false;
            this.clearScheduledJobs();
            this.emit('log', '🔌 Sesi WhatsApp telah dihentikan.');
        }
    }
}

module.exports = WhatsAppBot;