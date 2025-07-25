// renderer.js

// --- Elemen Global & Layar ---
const loginScreen = document.getElementById('login-screen');
const registerScreen = document.getElementById('register-screen');
const paymentScreen = document.getElementById('payment-screen');
const mainAppScreen = document.getElementById('main-app');
const allScreens = [loginScreen, registerScreen, paymentScreen, mainAppScreen];

// --- Elemen Layar Login & Daftar ---
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const btnLogin = document.getElementById('btn-login');
const loginError = document.getElementById('login-error');
const linkToRegister = document.getElementById('link-to-register');
const registerEmailInput = document.getElementById('register-email');
const registerPasswordInput = document.getElementById('register-password');
const btnRegister = document.getElementById('btn-register');
const registerError = document.getElementById('register-error');
const linkToLoginFromRegister = document.getElementById('link-to-login-from-register');
const paymentAmount = document.getElementById('payment-amount');
const btnBackToLogin = document.getElementById('btn-back-to-login');

// --- Elemen Aplikasi Utama ---
const scheduleList = document.getElementById('schedule-list');
const logArea = document.getElementById('log-area');
const qrContainer = document.getElementById('qr-code-container');
const btnRunSender = document.getElementById('btn-run-sender');

let messagesData = [];

// --- Fungsi Navigasi ---
const showScreen = (screenToShow) => {
    allScreens.forEach(screen => screen.classList.add('hidden'));
    screenToShow.classList.remove('hidden');
};

// --- Logika Navigasi ---
linkToRegister.addEventListener('click', (e) => { e.preventDefault(); showScreen(registerScreen); });
linkToLoginFromRegister.addEventListener('click', (e) => { e.preventDefault(); showScreen(loginScreen); });
btnBackToLogin.addEventListener('click', () => showScreen(loginScreen));

// --- Logika Login ---
btnLogin.addEventListener('click', async () => {
    const email = loginEmailInput.value;
    const password = loginPasswordInput.value;
    if (!email || !password) {
        loginError.textContent = 'Email dan password harus diisi.';
        loginError.classList.remove('hidden');
        return;
    }
    btnLogin.textContent = 'Mencoba Masuk...';
    btnLogin.disabled = true;
    loginError.classList.add('hidden');

    const result = await window.api.loginAttempt({ email, password });

    if (result.success) {
        showScreen(mainAppScreen);
        loadScheduleTable(); 
    } else {
        loginError.textContent = result.message;
        loginError.classList.remove('hidden');
    }
    btnLogin.textContent = 'Login';
    btnLogin.disabled = false;
});

// --- Logika Pendaftaran ---
btnRegister.addEventListener('click', async () => {
    const email = registerEmailInput.value;
    const password = registerPasswordInput.value;
    const durationElement = document.querySelector('input[name="duration"]:checked');
    if (!email || !password || !durationElement) {
        registerError.textContent = 'Harap isi semua kolom.';
        registerError.classList.remove('hidden');
        return;
    }
    const duration = durationElement.value;
    btnRegister.textContent = 'Memproses...';
    btnRegister.disabled = true;
    registerError.classList.add('hidden');

    const result = await window.api.registerAttempt({ email, password, duration });

    if (result.success) {
        const amount = result.paymentDetails.amount;
        paymentAmount.textContent = `Rp ${amount.toLocaleString('id-ID')}`;
        showScreen(paymentScreen);
    } else {
        registerError.textContent = result.message;
        registerError.classList.remove('hidden');
    }
    btnRegister.textContent = 'Lanjutkan ke Pembayaran';
    btnRegister.disabled = false;
});

// --- Fungsi Manajemen Jadwal (LOKAL) ---
const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString('id-ID');
    logArea.value += `[${timestamp}] ${message}\n`;
    logArea.scrollTop = logArea.scrollHeight;
};

const loadScheduleTable = async () => {
    try {
        messagesData = await window.api.getMessages();
        scheduleList.innerHTML = '';
        messagesData.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'schedule-item';
            div.innerHTML = `<span>${index + 1}</span><span>${item.id}</span><span>${item.time}</span><div class="action-buttons"><button class="btn-edit" data-index="${index}">EDIT</button><button class="btn-delete" data-index="${index}">HAPUS</button></div>`;
            scheduleList.appendChild(div);
        });
    } catch (error) {
        addLog(`❌ Gagal memuat messages.json: ${error.message}`);
    }
};

const openEditModal = (index) => {
    const modal = document.getElementById('edit-modal');
    const modalTitle = document.getElementById('modal-title');
    const editIndexInput = document.getElementById('edit-index');
    const editIdInput = document.getElementById('edit-id');
    const editTypeInput = document.getElementById('edit-type');
    const editTimeInput = document.getElementById('edit-time');
    const editPathInput = document.getElementById('edit-path');
    const editContentInput = document.getElementById('edit-content');
    
    if (index === -1) {
        modalTitle.textContent = 'Tambah Jadwal Baru';
        editIndexInput.value = -1;
        editIdInput.value = '';
        editTypeInput.value = 'text';
        editTimeInput.value = '00:00:00';
        editPathInput.value = '';
        editContentInput.value = '';
    } else {
        const item = messagesData[index];
        if (!item) return;
        modalTitle.textContent = 'Edit Jadwal';
        editIndexInput.value = index;
        editIdInput.value = item.id || '';
        editTypeInput.value = item.type || 'text';
        editTimeInput.value = item.time || '';
        editPathInput.value = item.path || '';
        const content = item.content || item.caption;
        editContentInput.value = Array.isArray(content) ? content.join('\n') : (content || '');
    }
    modal.classList.remove('hidden');
};

const closeEditModal = () => { document.getElementById('edit-modal').classList.add('hidden'); };

const saveChanges = async () => {
    const editIndexInput = document.getElementById('edit-index');
    const index = parseInt(editIndexInput.value, 10);
    const newItem = {
        id: document.getElementById('edit-id').value,
        type: document.getElementById('edit-type').value,
        time: document.getElementById('edit-time').value,
    };
    const contentOrCaption = document.getElementById('edit-content').value.split('\n');
    if (newItem.type === 'text') {
        newItem.content = contentOrCaption;
    } else {
        newItem.path = document.getElementById('edit-path').value;
        newItem.caption = contentOrCaption;
    }
    if (index === -1) {
        messagesData.push(newItem);
    } else {
        if (messagesData[index]) {
            messagesData[index] = newItem;
        }
    }
    try {
        await window.api.saveMessages(messagesData);
        addLog(`✅ Jadwal berhasil disimpan di messages.json.`);
        await loadScheduleTable();
        closeEditModal();
    } catch (error) {
        addLog(`❌ Gagal menyimpan perubahan: ${error.message}`);
    }
};

const handleDeleteTask = async (index) => {
    const item = messagesData[index];
    if (!item) return;
    if (confirm(`Yakin ingin menghapus tugas "${item.id}"?`)) {
        messagesData.splice(index, 1);
        try {
            await window.api.saveMessages(messagesData);
            addLog(`🗑️ Tugas berhasil dihapus dari messages.json.`);
            await loadScheduleTable();
        } catch (error) {
            addLog(`❌ Gagal menghapus tugas: ${error.message}`);
            messagesData.splice(index, 0, item);
        }
    }
};

// --- Event Listeners ---
document.getElementById('schedule-list').addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('btn-edit')) { openEditModal(parseInt(target.getAttribute('data-index'), 10)); }
    else if (target.classList.contains('btn-delete')) { handleDeleteTask(parseInt(target.getAttribute('data-index'), 10)); }
});

document.getElementById('btn-add-task').addEventListener('click', () => { openEditModal(-1); });
document.getElementById('btn-browse-path').addEventListener('click', async () => {
    const filePath = await window.api.selectFile();
    if (filePath) { document.getElementById('edit-path').value = filePath; }
});
document.getElementById('btn-save').addEventListener('click', saveChanges);
document.getElementById('btn-cancel').addEventListener('click', closeEditModal);

document.getElementById('btn-start').addEventListener('click', () => window.api.startBot());
document.getElementById('btn-stop').addEventListener('click', () => window.api.stopBot());
document.getElementById('btn-reset').addEventListener('click', () => window.api.resetWA());

btnRunSender.addEventListener('click', () => {
    const selectedGroups = Array.from(document.querySelectorAll('.group-checkbox:checked')).map(cb => cb.value);
    if (selectedGroups.length > 0) {
        window.api.runSender({ groupIds: selectedGroups });
    } else {
        addLog('⚠️ Peringatan: Pilih grup terlebih dahulu.');
    }
});

// --- Handler dari Main Process ---
window.api.on('log-message', (message) => { addLog(message); });

window.api.on('display-qr', (url) => {
    logArea.value = '';
    qrContainer.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    qrContainer.appendChild(img);
    qrContainer.classList.remove('hidden');
});

window.api.on('bot-ready', () => {
    qrContainer.classList.add('hidden');
    btnRunSender.disabled = false;
});

window.api.on('bot-stopped', () => {
    btnRunSender.disabled = true;
    document.getElementById('group-list').innerHTML = '<p>Bot dihentikan.</p>';
});

window.api.on('update-groups', (groups) => {
    const groupListContainer = document.getElementById('group-list');
    groupListContainer.innerHTML = '';
    if (groups.length === 0) {
        groupListContainer.innerHTML = '<p>Tidak ada grup (di mana Anda admin) yang ditemukan.</p>';
        return;
    }
    groups.forEach(group => {
        const label = document.createElement('label');
        label.className = 'group-item';
        label.innerHTML = `<input type="checkbox" class="group-checkbox" value="${group.id}"> ${group.name}`;
        groupListContainer.appendChild(label);
    });
});

// BARU: Handler untuk menampilkan pop-up update kustom
window.api.on('update-ready', (version) => {
    const modal = document.getElementById('update-modal');
    const title = document.getElementById('update-title');
    const message = document.getElementById('update-message');
    const btnLater = document.getElementById('btn-update-later');
    const btnNow = document.getElementById('btn-update-now');

    title.textContent = `Update MEBOT v${version}`;
    message.textContent = `Versi ${version} telah siap. Mulai ulang aplikasi untuk menyelesaikan pembaruan.`;
    
    // Fungsi untuk menutup modal
    const closeModal = () => modal.classList.add('hidden');

    // Tampilkan modal
    modal.classList.remove('hidden');

    // Event listener untuk tombol (gunakan .onclick agar tidak menumpuk listener)
    btnLater.onclick = closeModal;
    btnNow.onclick = () => {
        // Kirim sinyal ke main process untuk install
        window.api.installUpdate();
    };
});