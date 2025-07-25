// autoSender.js
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal'); // Tetap pakai ini untuk generate QR string
const path = require('path');
const fs = require('fs');

// Variabel global untuk instance client dan status bot
let client;
let isBotRunning = false;
let messageTimeouts = []; // Array untuk menyimpan semua timeout penjadwalan
let activeTargetGroupIds = []; // ID grup yang saat ini aktif dipilih oleh pengguna

// Fungsi untuk mengirim log ke proses utama Electron
let ipcSendLog;
let ipcSendQrCode;
let ipcSendGroupList;
let ipcSendBotStatus; // Tambahan: untuk mengirim status bot

// Fungsi inisialisasi untuk menerima fungsi IPC dari main process
const initIpcSenders = (logSender, qrSender, groupListSender, botStatusSender) => { // Tambah botStatusSender
    ipcSendLog = logSender;
    ipcSendQrCode = qrSender;
    ipcSendGroupList = groupListSender;
    ipcSendBotStatus = botStatusSender; // Inisialisasi
};

const sendLog = (message) => {
    if (ipcSendLog) {
        ipcSendLog(message);
    } else {
        console.log(message); // Fallback ke console log jika belum terinisialisasi
    }
};

const sendQrCode = (qr) => {
    if (ipcSendQrCode) {
        ipcSendQrCode(qr);
        qrcode.generate(qr, { small: true }); // Tetap tampilkan di terminal/console untuk debugging
    } else {
        qrcode.generate(qr, { small: true });
    }
};

const sendGroupList = (groups) => {
    if (ipcSendGroupList) {
        ipcSendGroupList(groups);
    } else {
        console.log('Daftar Grup:', groups); // Fallback ke console log
    }
};

const sendBotStatus = (status) => { // Fungsi baru untuk mengirim status
    if (ipcSendBotStatus) {
        ipcSendBotStatus(status);
    } else {
        console.log('Status Bot:', status);
    }
};


// --- FUNGSI preventLinkPreview yang Direvisi: Sisipkan ZWSP di protokol dan setelah titik ---
const preventLinkPreview = (text) => {
    if (typeof text !== 'string' || !text) return '';
    return text.replace(/(https?:\/\/[^\s]+)/gi, (match) => {
        let modifiedMatch = match
            .replace('https://', 'https://\u200B')   // Tambahkan ZWSP setelah `https://`
            .replace('http://', 'http://\u200B')    // Tambahkan ZWSP setelah `http://`
            .replace(/\./g, '.\u200B');              // Tambahkan ZWSP setelah titik
        return modifiedMatch;
    });
};
// --- AKHIR FUNGSI preventLinkPreview yang Direvisi ---

// Helper function to process text content (string or array)
const processTextContent = (textOrArray) => {
    if (Array.isArray(textOrArray)) {
        return textOrArray.join('\n'); // Gabungkan array dengan newline
    }
    return String(textOrArray || ''); // Pastikan selalu string
};


// Fungsi untuk memulai bot
const startBot = async () => {
    if (isBotRunning) {
        sendLog('Bot sudah berjalan.');
        sendBotStatus('running'); //
        return 'Bot sudah berjalan.';
    }

    sendLog('Memulai bot WhatsApp...');
    isBotRunning = true;
    sendBotStatus('starting'); // Mengirim status 'starting'

    client = new Client({
        authStrategy: new LocalAuth({ clientId: "whatsapp-gui-bot" }), // Memberi nama client ID
        puppeteer: {
            // Ini penting untuk Electron! Jalankan tanpa sandbox, mungkin perlu diatur tergantung OS
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
    });

    client.on('qr', qr => {
        sendQrCode(qr); //
        sendLog('Silakan scan QR Code yang muncul di terminal/konsol atau di aplikasi.');
        sendBotStatus('qr_received'); // Mengirim status 'qr_received'
    });

    client.on('ready', async () => {
        sendLog('✅ Bot WhatsApp aktif dan terhubung ke perangkat.');
        sendBotStatus('ready'); // Mengirim status 'ready'

        // Dapatkan daftar grup dan kirim ke GUI
        try {
            const chats = await client.getChats(); //
            const groups = chats.filter(c => c.isGroup).map(g => ({ //
                id: g.id._serialized, //
                name: g.name //
            }));
            sendGroupList(groups); //
            sendLog('Daftar grup berhasil dimuat dan dikirim ke GUI.');
        } catch (err) {
            sendLog(`❌ Gagal mendapatkan daftar chat untuk debugging ID: ${err.message}`);
        }

        sendLog('Bot siap. Menunggu pemilihan grup dari GUI untuk memulai penjadwalan.');
    });

    client.on('disconnected', (reason) => {
        sendLog(`Bot terputus dari WhatsApp: ${reason}`);
        isBotRunning = false;
        sendBotStatus('disconnected'); // Mengirim status 'disconnected'
        clearAllScheduledMessages(); // Hentikan semua penjadwalan jika terputus
        if (client) { // Pastikan client tidak null sebelum destroy
            client.destroy(); //
            client = null; //
        }
        sendLog('Bot telah dihentikan karena terputus.');
    });

    client.on('auth_failure', (msg) => {
        sendLog(`❌ Autentikasi gagal: ${msg}. Mungkin perlu reset sesi.`);
        isBotRunning = false;
        sendBotStatus('auth_failure'); // Mengirim status 'auth_failure'
        clearAllScheduledMessages(); //
        if (client) { // Pastikan client tidak null sebelum destroy
            client.destroy(); //
            client = null; //
        }
    });

    try {
        await client.initialize(); //
        return 'Bot sedang diinisialisasi. Tunggu QR Code atau koneksi.';
    } catch (error) {
        sendLog(`❌ Gagal menginisialisasi client: ${error.message}`);
        isBotRunning = false;
        sendBotStatus('error'); // Mengirim status 'error'
        return `Gagal memulai bot: ${error.message}`;
    }
};

// Fungsi untuk membersihkan semua timeout penjadwalan yang aktif
const clearAllScheduledMessages = () => {
    messageTimeouts.forEach(timeoutId => clearTimeout(timeoutId)); //
    messageTimeouts = []; //
    sendLog('Semua penjadwalan pesan yang tertunda telah dibersihkan.');
};


// Fungsi untuk memulai penjadwalan setelah grup dipilih
const startScheduling = async (targetGroupIdsFromGui) => {
    if (!client || !client.isReady) {
        sendLog('Bot belum siap atau tidak terhubung. Harap tunggu atau mulai bot terlebih dahulu.');
        return 'Bot belum siap untuk penjadwalan.';
    }

    if (!targetGroupIdsFromGui || targetGroupIdsFromGui.length === 0) {
        sendLog('🚫 Tidak ada grup yang dipilih. Penjadwalan tidak dapat dimulai.');
        return 'Tidak ada grup yang dipilih.';
    }

    activeTargetGroupIds = targetGroupIdsFromGui; // Simpan ID grup yang dipilih
    sendLog(`✅ Grup target dipilih: ${activeTargetGroupIds.join(', ')}. Memulai penjadwalan pesan.`);

    // Hentikan penjadwalan lama jika ada sebelum memulai yang baru
    clearAllScheduledMessages(); //

    let scheduledItems = [];
    try {
        const rawdata = fs.readFileSync(path.join(__dirname, 'messages.json')); //
        scheduledItems = JSON.parse(rawdata); //
        sendLog('✅ Data pesan berhasil dimuat dari messages.json untuk penjadwalan.');
    } catch (error) {
        sendLog(`❌ Gagal membaca atau mengurai messages.json untuk penjadwalan: ${error.message}`);
        sendLog('Pastikan file messages.json ada di direktori yang sama dan formatnya benar.');
        return 'Gagal memuat jadwal pesan.';
    }

    const chats = await client.getChats(); //
    const targetGroupChats = chats.filter(c => c.isGroup && activeTargetGroupIds.includes(c.id._serialized)); //

    if (targetGroupChats.length === 0) {
        sendLog(`🚫 Tidak ada grup yang ditemukan dari daftar ID yang dipilih: ${activeTargetGroupIds.join(', ')}`);
        sendLog(`Pastikan bot sudah bergabung dengan grup-grup tersebut dan ID grup yang dimasukkan benar.`);
        sendLog(`🚨 Penjadwalan pesan dibatalkan karena tidak ada grup yang ditemukan.`);
        return 'Tidak ada grup yang cocok ditemukan.';
    }

    targetGroupChats.forEach(group => {
        sendLog(`   - Grup Target: "${group.name}" (ID: ${group.id._serialized})`);
    });

    // Loop melalui item yang dijadwalkan dari messages.json dan atur timer
    scheduledItems.forEach(item => {
        if (!item.time || (!item.content && !item.path)) {
            sendLog(`⚠️ Item jadwal dilewati: waktu atau konten/path tidak ditemukan. ${JSON.stringify(item)}`);
            return;
        }

        const scheduleMessage = () => {
            const [hours, minutes, seconds] = item.time.split(':').map(Number); //
            const targetTime = new Date(); //
            targetTime.setHours(hours, minutes, seconds || 0, 0); //

            const now = new Date(); //
            let delayMs = targetTime - now; //

            if (delayMs <= 0) {
                delayMs += 24 * 60 * 60 * 1000; // Jadwalkan untuk hari berikutnya
                targetTime.setDate(targetTime.getDate() + 1); //
            }

            const sendTimeStr = targetTime.toTimeString().split(' ')[0]; //
            sendLog(`📌 Menjadwalkan item "${item.id || 'tanpa-id'}" (${item.type || 'unknown'}): akan dikirim jam ${sendTimeStr} (dalam ${Math.round(delayMs / 1000 / 60)} menit).`);

            const timeoutId = setTimeout(async () => {
                for (const groupChat of targetGroupChats) {
                    try {
                        if (item.type === 'text') {
                            let messageContent = processTextContent(item.content); //
                            if (item.preventPreview === true) {
                                messageContent = preventLinkPreview(messageContent); //
                            }
                            await groupChat.sendMessage(messageContent); //
                            const displayContent = Array.isArray(item.content) ? item.content[0] : item.content;
                            sendLog(`✅ Terkirim teks pada ${sendTimeStr} ke grup "${groupChat.name}" (ID: ${item.id || 'tanpa-id'}): "${String(displayContent).substring(0, Math.min(String(displayContent).length, 50))}..."`);
                        } else if (item.type === 'image' || item.type === 'video' || item.type === 'document') {
                            const mediaSourcePath = item.path || item.imagePath; //

                            if (!mediaSourcePath) {
                                sendLog(`❌ Gagal mengirim ${item.type}: 'path' atau 'imagePath' tidak ditemukan untuk item (ID: ${item.id || 'tanpa-id'}) pada ${sendTimeStr}.`);
                                continue;
                            }

                            const mediaPath = path.join(__dirname, mediaSourcePath); //

                            if (!fs.existsSync(mediaPath)) {
                                sendLog(`❌ Gagal mengirim ${item.type}: File tidak ditemukan di ${mediaPath} untuk item (ID: ${item.id || 'tanpa-id'}).`);
                                continue;
                            }

                            const mediaToSend = MessageMedia.fromFilePath(mediaPath); //
                            let options = {}; //
                            if (item.caption) {
                                let processedCaption = processTextContent(item.caption); //
                                options.caption = (item.preventPreviewCaption === true) ? preventLinkPreview(processedCaption) : processedCaption; //
                            }
                            if (item.type === 'document' && item.filename) {
                                options.filename = item.filename; //
                            }

                            await groupChat.sendMessage(mediaToSend, options); //
                            sendLog(`✅ Terkirim ${item.type} dari ${mediaSourcePath} pada ${sendTimeStr} ke grup "${groupChat.name}" (ID: ${item.id || 'tanpa-id'})`);
                        } else {
                            sendLog(`⚠️ Tipe item tidak dikenal: "${item.type}". Item dilewati (ID: ${item.id || 'tanpa-id'}).`);
                        }
                    } catch (err) {
                        sendLog(`❌ Gagal mengirim item (ID: ${item.id || 'tanpa-id'}) ke grup "${groupChat.name}" pada ${sendTimeStr}: ${err.message}`);
                    }
                }
                // Setelah pesan terkirim, jadwalkan ulang untuk hari berikutnya
                scheduleMessage(); //
            }, delayMs);
            messageTimeouts.push(timeoutId); // Simpan ID timeout
        };
        scheduleMessage(); // Panggil pertama kali untuk menjadwalkan
    });

    return 'Penjadwalan pesan berhasil diatur untuk pengiriman harian.';
};


// Fungsi untuk menghentikan bot
const stopBot = async () => {
    if (!isBotRunning) {
        sendLog('Bot tidak berjalan.');
        return 'Bot tidak berjalan.';
    }

    sendLog('Menghentikan bot WhatsApp...');
    isBotRunning = false;
    sendBotStatus('stopping'); // Mengirim status 'stopping'

    clearAllScheduledMessages(); // Hentikan semua penjadwalan

    if (client) {
        try {
            await client.destroy(); //
            client = null; //
            sendLog('✅ Bot WhatsApp berhasil dihentikan.');
            sendBotStatus('stopped'); // Mengirim status 'stopped'
            return 'Bot berhasil dihentikan.';
        } catch (error) {
            sendLog(`❌ Gagal menghentikan client: ${error.message}`);
            client = null; // Pastikan client di-null-kan meskipun ada error destroy
            sendBotStatus('error'); // Mengirim status 'error'
            return `Gagal menghentikan bot: ${error.message}`;
        }
    }
    return 'Bot tidak aktif.';
};


// Fungsi untuk mereset WhatsApp (menghapus sesi)
const resetWhatsapp = async () => {
    sendLog('Mereset sesi WhatsApp (menghapus file sesi)...');
    await stopBot(); // Pastikan bot dihentikan terlebih dahulu

    const sessionPath = path.join(__dirname, '.wwebjs_auth'); //
    const cachePath = path.join(__dirname, '.wwebjs_cache'); //

    try {
        if (fs.existsSync(sessionPath)) { //
            fs.rmSync(sessionPath, { recursive: true, force: true }); //
            sendLog('✅ Folder sesi .wwebjs_auth berhasil dihapus.');
        } else {
            sendLog('Folder sesi .wwebjs_auth tidak ditemukan, tidak perlu dihapus.');
        }

        if (fs.existsSync(cachePath)) { //
            fs.rmSync(cachePath, { recursive: true, force: true }); //
            sendLog('✅ Folder cache .wwebjs_cache berhasil dihapus.');
        } else {
            sendLog('Folder cache .wwebjs_cache tidak ditemukan, tidak perlu dihapus.');
        }

        sendLog('✅ Sesi WhatsApp berhasil direset. Silakan mulai ulang bot untuk mendapatkan QR baru.');
        sendBotStatus('reset'); // Mengirim status 'reset'
        return 'Sesi WhatsApp berhasil direset.';
    } catch (error) {
        sendLog(`❌ Gagal mereset sesi WhatsApp: ${error.message}`);
        sendBotStatus('error'); // Mengirim status 'error'
        return `Gagal mereset sesi: ${error.message}`;
    }
};

// Mengekspor fungsi-fungsi agar bisa diakses dari main.js
module.exports = {
    startBot,
    stopBot,
    resetWhatsapp,
    startScheduling,
    initIpcSenders,
    sendLog, // Ekspor sendLog agar main.js bisa menggunakannya
    isBotRunning: () => isBotRunning // Export status bot
};

