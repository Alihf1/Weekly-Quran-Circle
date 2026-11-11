// =====================================================================
// إعداد Firebase — الصق إعداد مشروعك هنا (اتبع الخطوات في FIREBASE-SETUP.md)
// إذا تركت القيم كما هي (YOUR_...) فالتطبيق يعمل بالوضع المحلي على هذا الجهاز
// =====================================================================
// تقدر تحقن الإعداد بدون تعديل الملف: ضع window.__FIREBASE_CONFIG__ قبل تحميل script.js
const firebaseConfig = (typeof window !== 'undefined' && window.__FIREBASE_CONFIG__)
    ? window.__FIREBASE_CONFIG__
    : {
        apiKey: "AIzaSyDGlgZMSFxu5qH2s23EMpLhgiTlQAWAYoM",
        authDomain: "quran-circle-app-88100.firebaseapp.com",
        projectId: "quran-circle-app-88100",
        storageBucket: "quran-circle-app-88100.firebasestorage.app",
        messagingSenderId: "676504505232",
        appId: "1:676504505232:web:fdb19b608ac7afb7d20115"
    };

let USE_FIREBASE = false;
let fbAuth = null;
let fbDb = null;
try {
    if (typeof firebase !== 'undefined' && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR_')) {
        firebase.initializeApp(firebaseConfig);
        fbAuth = firebase.auth();
        fbDb = firebase.firestore();
        USE_FIREBASE = true;
        console.log('🔥 Firebase mode enabled');
    }
} catch (e) {
    console.error('Firebase init failed — falling back to local mode:', e);
}

const fbUnsubscribers = [];
let cachedFbUsers = [];

function isFirebaseReady() {
    return USE_FIREBASE && fbAuth && fbDb;
}

function fbUnsubscribeAll() {
    while (fbUnsubscribers.length) {
        try { fbUnsubscribers.pop()(); } catch { /* ignore */ }
    }
}

// رسالة خطأ عربيّة مقروءة من أخطاء Firebase
function fbErrorMessage(err) {
    const code = (err && err.code) || '';
    const map = {
        'auth/invalid-email': 'البريد الإلكتروني غير صالح',
        'auth/user-not-found': 'لا يوجد حساب بهذا البريد',
        'auth/wrong-password': 'كلمة المرور غير صحيحة',
        'auth/invalid-credential': 'بيانات الدخول غير صحيحة',
        'auth/email-already-in-use': 'هذا البريد مسجل مسبقاً',
        'auth/weak-password': 'كلمة المرور ضعيفة (6 أحرف فأكثر)',
        'auth/network-request-failed': 'تعذر الاتصال — تحقق من الإنترنت أو مانع الإعلانات',
        'auth/too-many-requests': 'محاولات كثيرة، حاول لاحقاً',
        'auth/operation-not-allowed': 'تسجيل الدخول غير مفعّل — فعّل Email/Password من Firebase Console ← Authentication ← Sign-in method',
        'auth/invalid-api-key': 'مفتاح API غير صالح — تأكد من نسخ firebaseConfig كاملاً',
        'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'مفتاح API غير صالح — تأكد من نسخ firebaseConfig كاملاً',
        'auth/configuration-not-found': 'إعدادات المشروع غير مكتملة في Firebase',
        'auth/app-not-authorized': 'هذا التطبيق غير مصرح له — راجع Authorized domains في Authentication',
        'auth/internal-error': 'خطأ داخلي في Firebase',
        'permission-denied': 'لا تملك صلاحية لهذه العملية — راجع قواعد Firestore'
    };
    return map[code] || ('خطأ غير متوقع: ' + ((err && err.message) || code || 'unknown'));
}

// Inline error display on the auth screen (always visible — above the forms)
function showAuthError(msg) {
    const box = document.getElementById('auth-error');
    const text = document.getElementById('auth-error-text');
    if (box && text) {
        text.textContent = msg;
        box.classList.remove('hidden');
    } else {
        showToast(msg, 'error');
    }
}
function clearAuthError() {
    const box = document.getElementById('auth-error');
    if (box) box.classList.add('hidden');
}

// --- STORAGE KEYS ---
const LS = {
    users: 'quran_app_users',
    session: 'quran_app_session',
    appData: 'quran_app_data',
    rides: 'quran_app_rides'
};

// --- SAFE STORAGE (works even if the browser blocks localStorage, e.g. sandboxed preview) ---
const memoryStore = {};
const storage = {
    getItem(k) {
        try { return localStorage.getItem(k); } catch { return (k in memoryStore ? memoryStore[k] : null); }
    },
    setItem(k, v) {
        try { localStorage.setItem(k, String(v)); } catch { memoryStore[k] = String(v); }
    },
    removeItem(k) {
        try { localStorage.removeItem(k); } catch { delete memoryStore[k]; }
    }
};
const storageIsPersistent = (() => {
    try {
        localStorage.setItem('__quran_test__', '1');
        localStorage.removeItem('__quran_test__');
        return true;
    } catch {
        return false;
    }
})();

// --- APP STATE ---
let selectedSeatsCapacity = 5;
let activeBookedCarId = null;
let currentUser = null;
let emailVerificationPending = false; // true after email change is requested (verify-before-update flow)

// --- DEFAULT DATA ---
const DEFAULT_APP_DATA = {
    bestReader: {
        name: 'الشيخ / عبد الرحمن السالم',
        desc: 'إتقان التجويد وحسن الصوت',
        img: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'
    },
    bestContemplator: {
        name: 'المهندس / فيصل العتيبي',
        desc: 'تميز بطرح استنباطات قرآنية عميقة',
        img: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80'
    },
    stopPoint: {
        juz: '15',
        surah: 'الكهف',
        ayah: '110',
        page: '293'
    },
    meeting: {
        date: '2026-11-20',
        time: '20:30'
    },
    adminContacts: [],
    notifications: [],
    location: {
        host: 'بيت الأخ / أبو محمد الدوسري',
        address: 'حي النزهة - شارع الأمل - فيلا رقم 42',
        mapLink: 'https://maps.google.com',
        img: ''
    }
};

const DEFAULT_RIDES = [
    {
        id: 1,
        driverName: "سعد الماجد",
        phone: "0501112233",
        seatsTotal: 7,
        seatsBooked: 4,
        area: "حي النخيل والشمال",
        radius: 1500,
        passengers: ["عمر", "خالد", "ياسر", "محمد"]
    },
    {
        id: 2,
        driverName: "د. خالد السليمان",
        phone: "0554445566",
        seatsTotal: 5,
        seatsBooked: 5, // Fully booked car
        area: "حي السليمانية والورود",
        radius: 800,
        passengers: ["أحمد", "سلمان", "فهد", "حسن", "إبراهيم"]
    },
    {
        id: 3,
        driverName: "أبو فهد التميمي",
        phone: "0569998877",
        seatsTotal: 9,
        seatsBooked: 2,
        area: "حي الريان والشرق",
        radius: 2000,
        passengers: ["طارق", "وليد"]
    }
];

const ADMIN_ACCOUNT = {
    id: 'admin-1',
    name: 'المدير العام',
    phone: '0500000000',
    email: 'admin@quran.app',
    password: 'admin123',
    role: 'admin',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    stats: { volunteer: 0, passenger: 0, bestReader: 0, bestContemplator: 0 }
};

// --- STORAGE HELPERS ---
function loadUsers() {
    try { return JSON.parse(storage.getItem(LS.users)) || []; } catch { return []; }
}
function saveUsers(users) {
    storage.setItem(LS.users, JSON.stringify(users));
}
// Migrate stop-point fields saved inside bestContemplator by older versions
function migrateAppData(saved) {
    const d = saved || {};
    const bc = d.bestContemplator || {};
    const digits = v => toLatinDigits(v == null ? '' : v).replace(/[^0-9]/g, '');
    const fromOld = {}; // only non-empty values so defaults are not wiped
    if (digits(bc.juz)) fromOld.juz = digits(bc.juz);
    const surahClean = String(bc.surah || '').replace(/^سورة\s*/, '').trim();
    if (surahClean) fromOld.surah = surahClean;
    if (digits(bc.page)) fromOld.page = digits(bc.page);
    // Normalize any saved stopPoint values to Latin digits
    const spRaw = { ...(d.stopPoint || {}) };
    for (const k of ['juz', 'ayah', 'page']) {
        if (spRaw[k] != null) spRaw[k] = toLatinDigits(spRaw[k]);
    }
    return {
        bestReader: { ...DEFAULT_APP_DATA.bestReader, ...(d.bestReader || {}) },
        bestContemplator: { ...DEFAULT_APP_DATA.bestContemplator, ...((({ juz, surah, page, ...rest }) => rest)(bc)) },
        stopPoint: { ...DEFAULT_APP_DATA.stopPoint, ...fromOld, ...spRaw },
        meeting: { ...DEFAULT_APP_DATA.meeting, ...(d.meeting || {}) },
        adminContacts: Array.isArray(d.adminContacts) ? d.adminContacts : [],
        notifications: Array.isArray(d.notifications) ? d.notifications.slice(0, 20) : [],
        location: { ...DEFAULT_APP_DATA.location, ...(d.location || {}) }
    };
}

function loadAppData() {
    try {
        const saved = JSON.parse(storage.getItem(LS.appData));
        return saved ? migrateAppData(saved) : JSON.parse(JSON.stringify(DEFAULT_APP_DATA));
    } catch { return JSON.parse(JSON.stringify(DEFAULT_APP_DATA)); }
}
function saveAppData(data) {
    storage.setItem(LS.appData, JSON.stringify(data));
}
function loadRides() {
    try {
        const saved = JSON.parse(storage.getItem(LS.rides));
        return saved || JSON.parse(JSON.stringify(DEFAULT_RIDES));
    } catch { return JSON.parse(JSON.stringify(DEFAULT_RIDES)); }
}
function saveRides() {
    storage.setItem(LS.rides, JSON.stringify(ridesData));
}
function getSession() {
    try { return JSON.parse(storage.getItem(LS.session)); } catch { return null; }
}
function setSession(userId) {
    storage.setItem(LS.session, JSON.stringify({ userId }));
}
function clearSession() {
    storage.removeItem(LS.session);
}

// Ensure the default admin account always exists
function ensureSeedData() {
    const users = loadUsers();
    if (!users.some(u => u.email === ADMIN_ACCOUNT.email)) {
        users.push({ ...ADMIN_ACCOUNT, stats: { ...ADMIN_ACCOUNT.stats } });
        saveUsers(users);
    }
    if (!storage.getItem(LS.appData)) saveAppData(DEFAULT_APP_DATA);
    if (!storage.getItem(LS.rides)) storage.setItem(LS.rides, JSON.stringify(DEFAULT_RIDES));
}

// In Firebase mode, rides/data come from Firestore (live), not localStorage
let ridesData = isFirebaseReady() ? [] : loadRides();
let appData = isFirebaseReady() ? JSON.parse(JSON.stringify(DEFAULT_APP_DATA)) : loadAppData();

// --- INIT APP ---
window.onload = function() {
    try {
        if (isFirebaseReady()) {
            // Firebase Auth restores the session itself
            fbAuth.onAuthStateChanged(async (fbUser) => {
                try {
                    if (fbUser) {
                        const profile = await getFirebaseUser(fbUser.uid);
                        if (profile) { enterApp(profile); return; }
                    }
                } catch (e) {
                    console.error('Firebase session restore failed:', e);
                }
                showAuthScreen();
            });
            return;
        }

        ensureSeedData();
        ridesData = loadRides();
        appData = loadAppData();

        const session = getSession();
        const user = session ? loadUsers().find(u => u.id === session.userId) : null;

        if (user) {
            enterApp(user);
        } else {
            showAuthScreen();
        }
    } catch (err) {
        // Never leave the user on a blank screen
        console.error('App init failed:', err);
        try { showAuthScreen(); } catch { /* ignore */ }
    }
};

// Firebase: fetch the profile doc of a signed-in user
async function getFirebaseUser(uid) {
    const snap = await fbDb.collection('users').doc(uid).get();
    if (!snap.exists) return null;
    return { id: uid, ...snap.data() };
}

// --- AUTH LOGIC ---
function showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
}
function hideAuthScreen() {
    document.getElementById('auth-screen').classList.add('hidden');
}

function toggleAuthMode(mode) {
    clearAuthError();
    const loginForm = document.getElementById('auth-login-form');
    const registerForm = document.getElementById('auth-register-form');
    const loginTab = document.getElementById('auth-tab-login');
    const registerTab = document.getElementById('auth-tab-register');

    if (mode === 'login') {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        loginTab.className = 'py-2 rounded-xl text-xs font-bold transition bg-emerald-600 text-white shadow';
        registerTab.className = 'py-2 rounded-xl text-xs font-bold transition text-slate-500';
    } else {
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
        registerTab.className = 'py-2 rounded-xl text-xs font-bold transition bg-amber-500 text-white shadow';
        loginTab.className = 'py-2 rounded-xl text-xs font-bold transition text-slate-500';
    }
}

function enterApp(user) {
    currentUser = user;
    hideAuthScreen();

    // Show/hide admin-only navigation buttons
    document.querySelectorAll('.admin-only').forEach(el => {
        el.classList.toggle('hidden', user.role !== 'admin');
    });

    // Subscribe to real-time data (Firebase mode)
    if (isFirebaseReady()) {
        fbSubscribeAll();
        if (isAdmin()) fbSyncAdminContact();
    }

    try {
        switchTab('home');
        renderAll();
        refreshMyBookingState();
    } catch (err) {
        console.error('Render failed:', err);
        showToast('حدث خطأ أثناء عرض البيانات، حاول مرة أخرى', 'error');
    }

    if (!isFirebaseReady() && !storageIsPersistent) {
        showToast('تنبيه: متصفحك لا يسمح بالحفظ المحلي، بياناتك ستبقى لهذه الجلسة فقط', 'error');
    }
}

// Subscribe to config, rides (all members) and users (admin only) — live sync
function fbSubscribeAll() {
    fbUnsubscribeAll();

    // Site config doc (bestReader / contemplator / stop point / meeting / location)
    fbUnsubscribers.push(
        fbDb.collection('config').doc('site').onSnapshot(snap => {
            appData = snap.exists
                ? migrateAppData(snap.data())
                : JSON.parse(JSON.stringify(DEFAULT_APP_DATA));
            try { renderHome(); } catch (e) { console.error(e); }
            try { renderNotifications(); } catch (e) { console.error(e); }
            if (isAdmin() && !document.getElementById('tab-admin').classList.contains('hidden')) {
                try { renderAdminPanel(); } catch (e) { console.error(e); }
            }
        }, err => console.error('config sync failed:', err))
    );

    // Rides collection — visible to every signed-in member
    fbUnsubscribers.push(
        fbDb.collection('rides').onSnapshot(snap => {
            ridesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            try { refreshMyBookingState(); renderRidesList(); } catch (e) { console.error(e); }
            if (isAdmin()) { try { renderAdminRides(); } catch (e) { console.error(e); } }
        }, err => console.error('rides sync failed:', err))
    );

    // Users collection — admin only
    if (isAdmin()) {
        fbUnsubscribers.push(
            fbDb.collection('users').onSnapshot(snap => {
                cachedFbUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                try { renderUsersList(); } catch (e) { console.error(e); }
            }, err => console.error('users sync failed:', err))
        );
    }
}

// Work out whether the current user has an active booking, from ridesData
function refreshMyBookingState() {
    if (!currentUser) return;
    let mine = null;
    for (const ride of ridesData) {
        if (USE_FIREBASE) {
            if (Array.isArray(ride.passengers) && ride.passengers.some(p => p && p.uid === currentUser.id)) { mine = ride; break; }
        } else if (String(ride.id) === String(activeBookedCarId)) {
            mine = ride; break;
        }
    }
    const banner = document.getElementById('user-booking-status');
    if (mine) {
        activeBookedCarId = mine.id;
        document.getElementById('booked-driver-name').textContent = mine.driverName;
        banner.classList.remove('hidden');
    } else {
        activeBookedCarId = null;
        banner.classList.add('hidden');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    clearAuthError();
    const identifier = document.getElementById('login-identifier').value.trim();
    const password = document.getElementById('login-password').value;

    if (isFirebaseReady()) {
        if (!identifier.includes('@')) {
            showAuthError('سجّل دخولك بالبريد الإلكتروني');
            return;
        }
        try {
            const cred = await fbAuth.signInWithEmailAndPassword(identifier, password);
            const profile = await getFirebaseUser(cred.user.uid);
            if (!profile) {
                await fbAuth.signOut();
                showAuthError('حسابك غير موجود في قاعدة البيانات');
                return;
            }
            document.getElementById('auth-login-form').reset();
            enterApp(profile);
            showToast(`أهلاً بك، ${profile.name} 🌿`);
        } catch (err) {
            console.error(err);
            showAuthError(fbErrorMessage(err));
        }
        return;
    }

    const users = loadUsers();
    const user = users.find(u => (u.phone === identifier || u.email.toLowerCase() === identifier.toLowerCase()));

    if (!user || user.password !== password) {
        showAuthError('بيانات الدخول غير صحيحة، تحقق من الجوال/البريد وكلمة المرور');
        return;
    }

    setSession(user.id);
    document.getElementById('auth-login-form').reset();
    enterApp(user);
    showToast(`أهلاً بك، ${user.name} 🌿`);
}

async function handleRegister(e) {
    e.preventDefault();
    clearAuthError();
    const name = document.getElementById('reg-name').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const email = document.getElementById('reg-email').value.trim().toLowerCase();
    const password = document.getElementById('reg-password').value;

    if (password.length < 6) {
        showAuthError('كلمة المرور يجب أن تكون 6 أحرف فأكثر');
        return;
    }

    if (isFirebaseReady()) {
        try {
            const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
            const newProfile = {
                name,
                phone,
                email,
                role: 'user',
                avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
                stats: { volunteer: 0, passenger: 0, bestReader: 0, bestContemplator: 0 },
                createdAt: new Date().toISOString()
            };
            await fbDb.collection('users').doc(cred.user.uid).set(newProfile);
            document.getElementById('auth-register-form').reset();
            enterApp({ id: cred.user.uid, ...newProfile });
            showToast('تم إنشاء حسابك بنجاح، أهلاً بك في المجلس! 🌿');
        } catch (err) {
            console.error(err);
            showAuthError(fbErrorMessage(err));
        }
        return;
    }

    const users = loadUsers();
    if (users.some(u => u.phone === phone)) {
        showAuthError('رقم الجوال مسجل مسبقاً');
        return;
    }
    if (users.some(u => u.email.toLowerCase() === email)) {
        showAuthError('البريد الإلكتروني مسجل مسبقاً');
        return;
    }

    const newUser = {
        id: 'user-' + Date.now(),
        name,
        phone,
        email,
        password,
        role: 'user',
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        stats: { volunteer: 0, passenger: 0, bestReader: 0, bestContemplator: 0 }
    };

    users.push(newUser);
    saveUsers(users);
    setSession(newUser.id);

    document.getElementById('auth-register-form').reset();
    enterApp(newUser);
    showToast('تم إنشاء حسابك بنجاح، أهلاً بك في المجلس! 🌿');
}

function logout() {
    fbUnsubscribeAll();
    if (isFirebaseReady()) {
        fbAuth.signOut().catch(() => {});
    }
    clearSession();
    currentUser = null;
    cachedFbUsers = [];
    activeBookedCarId = null;
    document.getElementById('user-booking-status').classList.add('hidden');
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    switchTab('home');
    toggleAuthMode('login');
    showAuthScreen();
}

// Persist the current user's record (stats, avatar) back to storage
function persistCurrentUser() {
    if (!currentUser) return;

    if (isFirebaseReady()) {
        const { id, ...data } = currentUser;
        return fbDb.collection('users').doc(id).set(data, { merge: true })
            .catch(err => console.error('profile persist failed:', err));
    }

    const users = loadUsers();
    const idx = users.findIndex(u => u.id === currentUser.id);
    if (idx !== -1) {
        users[idx] = currentUser;
        saveUsers(users);
    }
}

// --- TAB SWITCHER LOGIC ---
function switchTab(tabName) {
    // Guard: admin tabs are for admins only
    if ((tabName === 'admin' || tabName === 'users') && (!currentUser || currentUser.role !== 'admin')) {
        showToast('هذه الصفحة مخصصة للمدير فقط', 'error');
        return;
    }

    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));

    // Reset active styles on tabs
    document.querySelectorAll('.nav-tab').forEach(el => {
        el.classList.remove('text-emerald-600', 'text-amber-600', 'font-bold');
        el.classList.add('text-slate-400');
    });

    // Show selected tab & set active navigation button
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    const activeBtn = document.getElementById(`nav-btn-${tabName}`);
    activeBtn.classList.remove('text-slate-400');
    activeBtn.classList.add(tabName === 'admin' ? 'text-amber-600' : 'text-emerald-600', 'font-bold');

    if (tabName === 'admin') renderAdminPanel();
    if (tabName === 'users') renderUsersList();
    if (tabName === 'profile') {
        renderNotifications();
        markNotifsSeen();
    }
}

// --- RENDER EVERYTHING ---
function renderAll() {
    renderHome();
    renderRidesList();
    updateProfileUI();
    renderNotifications();
    if (currentUser && currentUser.role === 'admin') {
        renderAdminPanel();
        renderUsersList();
    }
}

// --- HOME PAGE RENDER (from appData) ---
function renderHome() {
    document.getElementById('home-best-reader-name').textContent = appData.bestReader.name;
    document.getElementById('home-best-reader-desc').innerHTML = `<i class="fa-solid fa-circle-check ml-1"></i> ${escapeHtml(appData.bestReader.desc)}`;
    if (appData.bestReader.img) document.getElementById('home-best-reader-img').src = appData.bestReader.img;

    document.getElementById('home-best-contemplator-name').textContent = appData.bestContemplator.name;
    document.getElementById('home-best-contemplator-desc').textContent = appData.bestContemplator.desc;
    if (appData.bestContemplator.img) document.getElementById('home-best-contemplator-img').src = appData.bestContemplator.img;

    // نقطة التوقف (منفصلة عن أفضل متدبر)
    document.getElementById('home-juz-num').textContent = toLatinDigits(appData.stopPoint.juz);
    document.getElementById('home-surah-name').textContent = appData.stopPoint.surah;
    document.getElementById('home-ayah-num').textContent = toLatinDigits(appData.stopPoint.ayah);
    document.getElementById('home-page-num').textContent = toLatinDigits(appData.stopPoint.page);

    // موعد اللقاء القادم (تحت نقطة التوقف)
    const meetingText = formatMeetingDateTime(appData.meeting.date, appData.meeting.time);
    document.getElementById('home-meeting-datetime').textContent = meetingText;

    document.getElementById('host-name').textContent = appData.location.host;
    document.getElementById('host-address').textContent = appData.location.address;
    document.getElementById('host-map-link').href = appData.location.mapLink || 'https://maps.google.com';
    const houseImg = document.getElementById('host-house-img');
    if (houseImg) {
        if (appData.location.img) {
            houseImg.src = appData.location.img;
            houseImg.classList.remove('hidden');
        } else {
            houseImg.classList.add('hidden');
        }
    }
}

// مثال: "الجمعة 27 نوفمبر 2026 - الساعة 7:45 م" (أرقام إنجليزية/لاتينية)
function formatMeetingDateTime(dateStr, timeStr) {
    try {
        const d = new Date(`${dateStr}T${timeStr || '00:00'}`);
        if (isNaN(d)) return 'لم يُحدد الموعد بعد';
        const datePart = new Intl.DateTimeFormat('ar-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
        const timePart = new Intl.DateTimeFormat('ar-u-nu-latn', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
        return `${datePart} - الساعة ${timePart}`;
    } catch {
        return 'لم يُحدد الموعد بعد';
    }
}
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Convert Eastern/Persian Arabic digits to Latin 0-9 (so every number shows in English)
function toLatinDigits(s) {
    if (s == null) return s;
    const eastern = '٠١٢٣٤٥٦٧٨٩';
    const persian = '۰۱۲۳۴۵۶۷۸۹';
    return String(s).replace(/[٠-٩۰-۹]/g, d => {
        let i = eastern.indexOf(d);
        if (i > -1) return String(i);
        i = persian.indexOf(d);
        return i > -1 ? String(i) : d;
    });
}

// --- MAP (Leaflet + OpenStreetMap) ---
const RIYADH = { lat: 24.7136, lng: 46.6753 };
let volunteerMap = null, volunteerMarker = null, volunteerCircle = null;
let selectedVolLat = null, selectedVolLng = null;
let rideMapInstance = null, rideMapLayerGroup = null;

function initVolunteerMap() {
    const container = document.getElementById('volunteer-map');
    if (!container) return;

    if (typeof L === 'undefined') {
        container.innerHTML = '<p class="text-center text-[11px] text-slate-400 p-6">تعذر تحميل الخريطة — تحقق من الاتصال بالإنترنت</p>';
        return;
    }

    if (volunteerMap) {
        setTimeout(() => volunteerMap.invalidateSize(), 150);
        return;
    }

    volunteerMap = L.map('volunteer-map', { center: [RIYADH.lat, RIYADH.lng], zoom: 11 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(volunteerMap);

    volunteerMap.on('click', e => setVolunteerMarker(e.latlng.lat, e.latlng.lng));
    setTimeout(() => volunteerMap.invalidateSize(), 150);
}

function setVolunteerMarker(lat, lng) {
    selectedVolLat = lat;
    selectedVolLng = lng;

    const hint = document.getElementById('volunteer-map-hint');
    if (hint) hint.textContent = 'تم تحديد الموقع ✅ — اضغط لتحريك الماركر أو اسحبه، والدائرة تتبع مؤشر القطر بالأسفل';

    if (!volunteerMap) return; // Leaflet not loaded (offline) — coords still saved

    if (volunteerMarker) {
        volunteerMarker.setLatLng([lat, lng]);
    } else {
        volunteerMarker = L.marker([lat, lng], { draggable: true }).addTo(volunteerMap);
        volunteerMarker.on('dragend', e => {
            const p = e.target.getLatLng();
            setVolunteerMarker(p.lat, p.lng);
        });
    }
    updateVolunteerCircle();
}

function updateVolunteerCircle() {
    if (!volunteerMap) return;
    const radius = parseInt(toLatinDigits(document.getElementById('volunteer-radius').value), 10) || 1000;
    if (selectedVolLat === null) return;

    const latlng = [selectedVolLat, selectedVolLng];
    if (volunteerCircle) {
        volunteerCircle.setLatLng(latlng).setRadius(radius);
    } else {
        volunteerCircle = L.circle(latlng, {
            radius,
            color: '#059669',
            weight: 2,
            fillColor: '#10b981',
            fillOpacity: 0.25
        }).addTo(volunteerMap);
    }
    if (volunteerMarker) volunteerMarker.setZIndexOffset(1000);
}

function resetVolunteerMapSelection() {
    selectedVolLat = null;
    selectedVolLng = null;
    if (volunteerMarker && volunteerMap) { volunteerMap.removeLayer(volunteerMarker); }
    volunteerMarker = null;
    if (volunteerCircle && volunteerMap) { volunteerMap.removeLayer(volunteerCircle); }
    volunteerCircle = null;
    const hint = document.getElementById('volunteer-map-hint');
    if (hint) hint.textContent = 'اضغط على الخريطة لتحديد المكان — الدائرة هي قطر التغطية (يتغير مع المؤشر بالأسفل)';
}

function useMyLocation() {
    if (!navigator.geolocation) {
        showToast('الموقع غير مدعوم في متصفحك', 'error');
        return;
    }
    navigator.geolocation.getCurrentPosition(
        pos => {
            const { latitude, longitude } = pos.coords;
            if (volunteerMap) {
                volunteerMap.setView([latitude, longitude], 15);
                setVolunteerMarker(latitude, longitude);
            } else {
                selectedVolLat = latitude;
                selectedVolLng = longitude;
                showToast('تم تحديد موقعك الحالي ✅');
            }
        },
        () => showToast('تعذر الحصول على موقعك — اسمح بالوصول للموقع من المتصفح', 'error'),
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// Passenger/viewer side: open the coverage map for a ride
function openRideMap(rideId) {
    const ride = ridesData.find(r => String(r.id) === String(rideId));
    if (!ride || ride.lat == null || ride.lng == null) {
        showToast('هذا السائق لم يحدد موقعه على الخريطة', 'error');
        return;
    }
    const modal = document.getElementById('ride-map-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    const title = document.getElementById('ride-map-title');
    if (title) title.textContent = `تغطية ${ride.driverName}`;
    const caption = document.getElementById('ride-map-caption');
    if (caption) caption.textContent = `${ride.area} — قطر التغطية: ${ride.radius >= 1000 ? (ride.radius / 1000) + ' كم' : ride.radius + ' متر'}`;

    setTimeout(() => {
        const container = document.getElementById('ride-map');
        if (typeof L === 'undefined') {
            container.innerHTML = '<p class="text-center text-xs text-slate-400 p-8">تعذر تحميل الخريطة — تحقق من الإنترنت</p>';
            return;
        }

        if (!rideMapInstance) {
            rideMapInstance = L.map('ride-map', { center: [ride.lat, ride.lng], zoom: 13 });
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© OpenStreetMap contributors'
            }).addTo(rideMapInstance);
        } else {
            if (rideMapLayerGroup) { rideMapInstance.removeLayer(rideMapLayerGroup); rideMapLayerGroup = null; }
        }

        const radius = ride.radius || 1000;
        const marker = L.marker([ride.lat, ride.lng]);
        const circle = L.circle([ride.lat, ride.lng], {
            radius,
            color: '#059669',
            weight: 2,
            fillColor: '#10b981',
            fillOpacity: 0.25
        });
        rideMapLayerGroup = L.layerGroup([marker, circle]).addTo(rideMapInstance);
        rideMapInstance.invalidateSize();
        try { rideMapInstance.fitBounds(circle.getBounds().pad(0.2)); } catch { rideMapInstance.setView([ride.lat, ride.lng], 13); }
    }, 150);
}

function closeRideMap() {
    const modal = document.getElementById('ride-map-modal');
    if (modal) modal.classList.add('hidden');
}

// --- NOTIFICATIONS (الإشعارات) — بثوث المدير لكل الأعضاء ---
const NOTIF_SEEN_KEY = 'quran_notif_seen';
const MAX_NOTIFICATIONS = 20;

function getNotifs() {
    return Array.isArray(appData.notifications) ? appData.notifications : [];
}

function notifSeenKey() {
    // Per-account read receipt (each member has their own seen marker on their device)
    return (typeof currentUser !== 'undefined' && currentUser && currentUser.id)
        ? `${NOTIF_SEEN_KEY}_${currentUser.id}`
        : NOTIF_SEEN_KEY;
}
function notifSeenId() {
    try { return storage.getItem(notifSeenKey()) || null; } catch { return null; }
}
function setNotifSeen(id) {
    try { storage.setItem(notifSeenKey(), id); } catch { /* memory fallback handled by storage */ }
}
function countUnreadNotifs() {
    const notifs = getNotifs();
    const seen = notifSeenId();
    if (!seen) return notifs.length;
    const idx = notifs.findIndex(n => n.id === seen);
    return idx === -1 ? notifs.length : idx;
}
function markNotifsSeen() {
    const notifs = getNotifs();
    if (notifs.length) setNotifSeen(notifs[0].id); else setNotifSeen('');
    updateNotifBell();
}

function updateNotifBell() {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    const count = countUnreadNotifs();
    if (count > 0) {
        badge.textContent = count > 9 ? '9+' : String(count);
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function formatNotifDate(iso) {
    try {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return new Intl.DateTimeFormat('ar-u-nu-latn', {
            day: 'numeric', month: 'short',
            hour: 'numeric', minute: '2-digit', hour12: true
        }).format(d);
    } catch { return ''; }
}

function notificationItemHtml(n) {
    const admin = isAdmin();

    // Inline edit mode (admin only)
    if (editingNotifId === n.id) {
        return `
        <div class="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-2">
            <textarea id="notif-edit-textarea" rows="4" class="w-full p-2 border border-amber-300 rounded-lg text-xs focus:ring-2 focus:ring-amber-500 outline-none">${escapeHtml(n.text)}</textarea>
            <div class="flex gap-2 justify-end">
                <button onclick="cancelNotifEdit()" class="px-3 py-1.5 text-[11px] bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 font-bold transition">إلغاء</button>
                <button onclick="saveNotifEdit()" class="px-3 py-1.5 text-[11px] bg-amber-500 hover:bg-amber-600 rounded-lg text-white font-bold transition"><i class="fa-solid fa-check ml-1"></i>حفظ التعديل</button>
            </div>
        </div>`;
    }

    return `
        <div class="bg-amber-50/70 border border-amber-200 rounded-xl p-3">
            <p class="text-[11px] text-slate-800 leading-relaxed whitespace-pre-line">${escapeHtml(n.text)}</p>
            <div class="flex items-center justify-between mt-1.5 text-[9px] text-slate-400">
                <span><i class="fa-solid fa-shield-halved text-amber-600 ml-1"></i>${escapeHtml(n.author || 'المدير')}</span>
                <span>${formatNotifDate(n.at)}</span>
            </div>
            ${admin ? `
            <div class="flex items-center gap-1.5 mt-2 pt-2 border-t border-amber-200/70 justify-end">
                <button onclick="editNotification('${escapeHtml(n.id)}')" title="تعديل الإشعار"
                        class="w-7 h-7 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center transition">
                    <i class="fa-solid fa-pen text-[10px]"></i>
                </button>
                <button onclick="deleteNotification('${escapeHtml(n.id)}')" title="حذف الإشعار"
                        class="w-7 h-7 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition">
                    <i class="fa-solid fa-trash-can text-[10px]"></i>
                </button>
            </div>` : ''}
        </div>
    `;
}

function renderNotifications() {
    const notifs = getNotifs();
    const html = notifs.length
        ? notifs.map(notificationItemHtml).join('')
        : '<p class="text-center text-xs text-slate-400 py-6"><i class="fa-regular fa-bell-slash text-xl block mb-2 text-slate-300"></i>لا توجد إشعارات حالياً 🔔</p>';

    const profileList = document.getElementById('notifications-list');
    if (profileList) profileList.innerHTML = html;

    const modalList = document.getElementById('notif-modal-list');
    if (modalList) modalList.innerHTML = html;
    const modalEmpty = document.getElementById('notif-modal-empty');
    if (modalEmpty) modalEmpty.classList.toggle('hidden', notifs.length > 0);

    const counter = document.getElementById('notifications-count');
    if (counter) counter.textContent = String(notifs.length);

    updateNotifBell();
}

// Admin: send a notification to every member
async function sendNotification() {
    if (!isAdmin()) {
        showToast('هذه الصلاحية للمدير فقط', 'error');
        return;
    }
    const textarea = document.getElementById('admin-notif-text');
    const text = (textarea ? textarea.value : '').trim();
    if (!text) {
        showToast('اكتب الإشعار أولاً', 'error');
        return;
    }

    const newNotif = {
        id: 'n-' + Date.now(),
        text,
        author: (currentUser && currentUser.name) || 'المدير',
        at: new Date().toISOString()
    };
    const updated = [newNotif, ...getNotifs()].slice(0, MAX_NOTIFICATIONS);

    const ok = await saveNotificationsArray(updated, 'تم إرسال الإشعار لجميع الأعضاء 🔔');
    if (!ok) return;

    if (textarea) textarea.value = '';
    setNotifSeen(newNotif.id); // sender doesn't get a badge for their own notice
    updateNotifBell();
}

function openNotifModal() {
    renderNotifications();
    markNotifsSeen();
    document.getElementById('notif-modal').classList.remove('hidden');
}
function closeNotifModal() {
    document.getElementById('notif-modal').classList.add('hidden');
}

// --- IN-APP CONFIRM (replaces native confirm() — native dialogs freeze mobile pages) ---
let confirmCallback = null;
function showConfirm({ title = 'تأكيد', message = '', okLabel = 'حسنًا', onConfirm = null } = {}) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const okBtn = document.getElementById('confirm-ok-btn');
    if (okBtn) okBtn.textContent = okLabel;
    confirmCallback = onConfirm;
    document.getElementById('confirm-modal').classList.remove('hidden');
}
function closeConfirm() {
    document.getElementById('confirm-modal').classList.add('hidden');
    confirmCallback = null;
}
function confirmOk() {
    const cb = confirmCallback;
    closeConfirm();
    if (typeof cb === 'function') cb();
}

// --- NOTIFICATION EDIT & DELETE (admin only) ---
let editingNotifId = null;

function editNotification(id) {
    if (!isAdmin()) return;
    editingNotifId = id;
    renderNotifications();
}
function cancelNotifEdit() {
    editingNotifId = null;
    renderNotifications();
}
async function saveNotifEdit() {
    if (!isAdmin()) return;
    const textarea = document.getElementById('notif-edit-textarea');
    const text = textarea ? textarea.value.trim() : '';
    if (!text) {
        showToast('الإشعار لا يمكن أن يكون فارغاً', 'error');
        return;
    }
    const updated = getNotifs().map(n => n.id === editingNotifId ? { ...n, text } : n);
    const ok = await saveNotificationsArray(updated, 'تم تعديل الإشعار ✏️');
    if (ok) editingNotifId = null;
    renderNotifications();
}
function deleteNotification(id) {
    if (!isAdmin()) return;
    const n = getNotifs().find(x => x.id === id);
    if (!n) return;
    showConfirm({
        title: 'حذف الإشعار',
        message: 'هل أنت متأكد من حذف هذا الإشعار؟ لن يظهر عند الأعضاء بعد الحذف.',
        okLabel: 'حذف',
        onConfirm: async () => {
            await saveNotificationsArray(getNotifs().filter(x => x.id !== id), 'تم حذف الإشعار 🗑️');
        }
    });
}
// Persist the notifications array (used by send/edit/delete) — keeps seen pointer consistent
async function saveNotificationsArray(updated, successMsg) {
    if (isFirebaseReady()) {
        try {
            await fbDb.collection('config').doc('site').set({ notifications: updated }, { merge: true });
        } catch (err) {
            console.error(err);
            showToast('تعذر الحفظ: ' + fbErrorMessage(err), 'error');
            return false;
        }
    } else {
        appData.notifications = updated;
        saveAppData(appData);
    }
    const seen = notifSeenId();
    if (seen && !updated.find(n => n.id === seen)) {
        // The notification the user already saw was removed — reset cleanly to avoid badge storms
        setNotifSeen(updated.length ? updated[0].id : '');
    }
    renderNotifications();
    showToast(successMsg);
    return true;
}

// --- RIDES LIST RENDER & LOGIC ---
function renderRidesList() {
    const container = document.getElementById('rides-container');
    container.innerHTML = '';

    // Sort Rides: Full cars (seatsBooked === seatsTotal) moved to the BOTTOM
    const sortedRides = [...ridesData].sort((a, b) => {
        const aIsFull = a.seatsBooked >= a.seatsTotal;
        const bIsFull = b.seatsBooked >= b.seatsTotal;
        if (aIsFull && !bIsFull) return 1; // Move 'a' down
        if (!aIsFull && bIsFull) return -1; // Keep 'b' down
        return 0;
    });

    document.getElementById('rides-count').textContent = `${ridesData.length} سيارات`;

    sortedRides.forEach(ride => {
        const isFull = ride.seatsBooked >= ride.seatsTotal;
        const isUserBookedHere = String(activeBookedCarId) === String(ride.id);

        const cardHtml = `
            <div class="bg-white rounded-2xl p-4 border ${isUserBookedHere ? 'border-2 border-emerald-500 bg-emerald-50/20' : 'border-slate-200/80'} shadow-xs transition-all relative overflow-hidden">
                ${isFull ? `<div class="bg-rose-500 text-white text-[10px] font-bold px-3 py-0.5 rounded-bl-lg absolute top-0 left-0">مكتملة</div>` : ''}
                
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <h4 class="font-bold text-slate-900 text-base flex items-center">
                            <i class="fa-solid fa-car-side text-emerald-600 ml-2"></i> ${escapeHtml(ride.driverName)}
                        </h4>
                        <p class="text-xs text-slate-500"><i class="fa-solid fa-phone text-slate-400 ml-1"></i> ${escapeHtml(ride.phone)}</p>
                    </div>
                    <div class="text-left">
                        <span class="text-xs font-bold ${isFull ? 'text-rose-600' : 'text-emerald-700'} bg-slate-100 px-2.5 py-1 rounded-full">
                            ${ride.seatsBooked} / ${ride.seatsTotal} مقاعد
                        </span>
                    </div>
                </div>

                <!-- Details (Area & Radius) -->
                <div class="grid grid-cols-2 gap-2 my-3 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    <div>
                        <span class="text-slate-400 block text-[10px]">المنطقة المغطاة:</span>
                        <span class="font-semibold text-slate-700">${escapeHtml(ride.area)}</span>
                    </div>
                    <div>
                        <span class="text-slate-400 block text-[10px]">قطر التغطية:</span>
                        <span class="font-semibold text-slate-700">${ride.radius >= 1000 ? (ride.radius/1000) + ' كم' : ride.radius + ' متر'}</span>
                    </div>
                </div>

                ${(ride.lat != null && ride.lng != null) ? `
                    <button onclick="openRideMap('${String(ride.id)}')"
                            class="w-full mb-2 py-2 bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold rounded-xl text-xs transition border border-teal-200 flex items-center justify-center">
                        <i class="fa-solid fa-map-location-dot ml-1.5"></i> عرض التغطية على الخريطة
                    </button>
                ` : ''}

                <!-- Action Buttons -->
                <div class="pt-1">
                    ${isUserBookedHere ? `
                        <button onclick="cancelBooking()" class="w-full py-2 bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold rounded-xl text-xs transition">
                            إلغاء حجز المقعد
                        </button>
                    ` : `
                        <button onclick="confirmBooking('${String(ride.id)}')" 
                                ${isFull || activeBookedCarId !== null ? 'disabled' : ''} 
                                class="w-full py-2.5 ${isFull ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : activeBookedCarId !== null ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 text-white'} font-bold rounded-xl text-xs transition shadow-xs">
                            ${isFull ? 'السيارة ممتلئة بالكامل' : activeBookedCarId !== null ? 'لديك حجز مؤكد بالفعل' : 'تأكيد الحجز معك'}
                        </button>
                    `}
                </div>
            </div>
        `;
        container.innerHTML += cardHtml;
    });
}

// --- BOOKING LOGIC ---
function findMyBooking() {
    if (!currentUser) return null;
    for (const ride of ridesData) {
        if (USE_FIREBASE) {
            if (Array.isArray(ride.passengers) && ride.passengers.some(p => p && p.uid === currentUser.id)) return ride;
        } else if (String(ride.id) === String(activeBookedCarId)) {
            return ride;
        }
    }
    return null;
}

function confirmBooking(carId) {
    carId = String(carId);

    if (isFirebaseReady()) {
        fbConfirmBooking(carId);
        return;
    }

    if (activeBookedCarId !== null) {
        showToast("يمكنك اختيار سيارة واحدة فقط!", "error");
        return;
    }

    const car = ridesData.find(c => String(c.id) === carId);
    if (car && car.seatsBooked < car.seatsTotal) {
        car.seatsBooked++;
        car.passengers.push(currentUser.name);
        activeBookedCarId = car.id;
        saveRides();
        
        // Update stats
        currentUser.stats.passenger++;
        persistCurrentUser();
        updateProfileUI();

        // Show top user status banner
        document.getElementById('user-booking-status').classList.remove('hidden');
        document.getElementById('booked-driver-name').textContent = car.driverName;

        renderRidesList();
        showToast(`تم تأكيد حجز المقعد مع ${car.driverName} بنجاح`);
    }
}

async function fbConfirmBooking(carId) {
    if (findMyBooking()) {
        showToast("لديك حجز مؤكد بالفعل في سيارة أخرى", "error");
        return;
    }
    const ref = fbDb.collection('rides').doc(carId);
    try {
        await fbDb.runTransaction(async (t) => {
            const snap = await t.get(ref);
            if (!snap.exists) throw new Error('هذه السيارة لم تعد متاحة');
            const r = snap.data();
            const passengers = Array.isArray(r.passengers) ? r.passengers : [];
            if (passengers.some(p => p && p.uid === currentUser.id)) {
                throw new Error('أنت محجوز بالفعل في هذه السيارة');
            }
            if (passengers.length >= r.seatsTotal) {
                throw new Error('السيارة ممتلئة بالكامل');
            }
            t.update(ref, {
                passengers: firebase.firestore.FieldValue.arrayUnion({ uid: currentUser.id, name: currentUser.name }),
                seatsBooked: passengers.length + 1
            });
        });
        await fbIncrementMyStat('passenger', 1);
        showToast('تم تأكيد حجز المقعد بنجاح');
    } catch (err) {
        console.error(err);
        showToast(fbErrorMessage(err) || 'تعذر إتمام الحجز', 'error');
    }
}

function cancelBooking() {
    if (isFirebaseReady()) {
        fbCancelBooking();
        return;
    }

    if (activeBookedCarId === null) return;

    const car = ridesData.find(c => String(c.id) === String(activeBookedCarId));
    if (car) {
        car.seatsBooked--;
        car.passengers = car.passengers.filter(p => p !== currentUser.name);
        activeBookedCarId = null;
        saveRides();

        document.getElementById('user-booking-status').classList.add('hidden');
        renderRidesList();
        showToast("تم إلغاء حجز السيارة");
    }
}

async function fbCancelBooking() {
    const mine = findMyBooking();
    if (!mine) return;

    const ref = fbDb.collection('rides').doc(String(mine.id));
    try {
        await fbDb.runTransaction(async (t) => {
            const snap = await t.get(ref);
            if (!snap.exists) return;
            const r = snap.data();
            const passengers = (Array.isArray(r.passengers) ? r.passengers : [])
                .filter(p => !(p && p.uid === currentUser.id));
            t.update(ref, { passengers, seatsBooked: passengers.length });
        });
        showToast("تم إلغاء حجز السيارة");
    } catch (err) {
        console.error(err);
        showToast('تعذر إلغاء الحجز', 'error');
    }
}

async function fbIncrementMyStat(key, delta) {
    try {
        await fbDb.collection('users').doc(currentUser.id).update({
            [`stats.${key}`]: firebase.firestore.FieldValue.increment(delta)
        });
        if (!currentUser.stats) currentUser.stats = {};
        currentUser.stats[key] = (currentUser.stats[key] || 0) + delta;
        updateProfileUI();
    } catch (e) {
        console.error('stats update failed:', e);
    }
}

// --- VOLUNTEER FORM LOGIC ---
function openVolunteerModal() {
    document.getElementById('volunteer-modal').classList.remove('hidden');
    // Auto-fill current user name & phone
    document.getElementById('volunteer-name').value = currentUser.name;
    document.getElementById('volunteer-phone').value = currentUser.phone;
    // Init (or refresh) the map now that the modal is visible
    initVolunteerMap();
}

function closeVolunteerModal() {
    document.getElementById('volunteer-modal').classList.add('hidden');
}

function selectSeatOption(capacity) {
    document.querySelectorAll('.seat-btn').forEach(btn => {
        btn.classList.remove('border-emerald-500', 'bg-emerald-50', 'text-emerald-700');
        btn.classList.add('border-slate-200', 'text-slate-700');
    });

    const customContainer = document.getElementById('custom-seat-container');

    if (capacity === 'custom') {
        document.getElementById('custom-seat-btn').classList.add('border-emerald-500', 'bg-emerald-50', 'text-emerald-700');
        customContainer.classList.remove('hidden');
        selectedSeatsCapacity = parseInt(document.getElementById('custom-seat-range').value);
    } else {
        event.target.classList.add('border-emerald-500', 'bg-emerald-50', 'text-emerald-700');
        customContainer.classList.add('hidden');
        selectedSeatsCapacity = capacity;
    }
}

function updateCustomSeats(val) {
    document.getElementById('custom-seat-val').textContent = `${val} راكب`;
    selectedSeatsCapacity = parseInt(val);
}

function updateRadiusDisplay(val) {
    val = toLatinDigits(String(val));
    const km = (val / 1000).toFixed(1);
    document.getElementById('radius-display').textContent = `${val} متر (${km} كم)`;
    updateVolunteerCircle();
}

function handleVolunteerSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('volunteer-name').value;
    const phone = document.getElementById('volunteer-phone').value;
    const area = document.getElementById('volunteer-area').value;
    const radius = parseInt(toLatinDigits(document.getElementById('volunteer-radius').value), 10);
    // Map selection (optional) — lat/lng + nothing else
    const mapFields = (selectedVolLat != null && selectedVolLng != null)
        ? { lat: selectedVolLat, lng: selectedVolLng }
        : {};

    if (isFirebaseReady()) {
        fbDb.collection('rides').add({
            driverName: name,
            phone: phone,
            seatsTotal: selectedSeatsCapacity,
            seatsBooked: 0,
            area: area,
            radius: radius,
            passengers: [],
            driverId: currentUser.id,
            ...mapFields,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => fbIncrementMyStat('volunteer', 1))
          .catch(err => {
              console.error(err);
              showToast('تعذر حفظ التطوع: ' + fbErrorMessage(err), 'error');
          });

        closeVolunteerModal();
        resetVolunteerMapSelection();
        showToast("تم إضافتك لقائمة المتطوعين بالتوصيل بنجاح");
        return;
    }

    const newRide = {
        id: 'ride-' + Date.now(),
        driverName: name,
        phone: phone,
        seatsTotal: selectedSeatsCapacity,
        seatsBooked: 0,
        area: area,
        radius: radius,
        passengers: [],
        ...mapFields
    };

    ridesData.unshift(newRide);
    resetVolunteerMapSelection();
    saveRides();
    currentUser.stats.volunteer++;
    persistCurrentUser();
    updateProfileUI();

    renderRidesList();
    closeVolunteerModal();
    showToast("تم إضافتك لقائمة المتطوعين بالتوصيل بنجاح");
}

// --- PROFILE UI UPDATES ---
function updateProfileUI() {
    if (!currentUser) return;
    document.getElementById('profile-name').textContent = currentUser.name;
    document.getElementById('profile-phone').innerHTML = `<i class="fa-solid fa-phone text-emerald-600 ml-1"></i> ${escapeHtml(currentUser.phone)}`;
    document.getElementById('profile-email').innerHTML = `<i class="fa-solid fa-envelope text-emerald-600 ml-1"></i> ${escapeHtml(currentUser.email)}`;
    if (currentUser.avatar) document.getElementById('profile-avatar').src = currentUser.avatar;

    // Prefill edit fields
    const editName = document.getElementById('edit-name');
    if (editName) editName.value = currentUser.name || '';
    const editPhone = document.getElementById('edit-phone');
    if (editPhone) editPhone.value = currentUser.phone || '';
    const editEmail = document.getElementById('edit-email');
    if (editEmail) editEmail.value = currentUser.email || '';
    
    document.getElementById('stat-volunteer-count').textContent = currentUser.stats.volunteer;
    document.getElementById('stat-passenger-count').textContent = currentUser.stats.passenger;
    document.getElementById('stat-reader-count').textContent = currentUser.stats.bestReader;
    document.getElementById('stat-contemplator-count').textContent = currentUser.stats.bestContemplator;
}

// --- AVATAR (التقاط من الكاميرا أو تحميل من الجهاز) ---
function openAvatarModal() {
    document.getElementById('avatar-modal').classList.remove('hidden');
}
function closeAvatarModal() {
    document.getElementById('avatar-modal').classList.add('hidden');
}
function triggerAvatarCamera() {
    closeAvatarModal();
    const input = document.getElementById('avatar-camera-input');
    if (input) input.click();
}
function triggerAvatarUpload() {
    closeAvatarModal();
    const input = document.getElementById('avatar-upload-input');
    if (input) input.click();
}

function handleAvatarFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        showToast('اختر ملف صورة فقط (JPG, PNG ...)', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onerror = () => showToast('تعذرت قراءة الصورة', 'error');
    reader.onload = () => {
        const img = new Image();
        img.onerror = () => showToast('الصورة غير صالحة', 'error');
        img.onload = () => {
            try {
                const maxSize = 200;
                const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                currentUser.avatar = canvas.toDataURL('image/jpeg', 0.8);
                persistCurrentUser();
                updateProfileUI();
                showToast('تم تحديث صورتك الشخصية ✅');
            } catch (err) {
                console.error('avatar processing failed:', err);
                showToast('تعذرت معالجة الصورة', 'error');
            }
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

// --- PASSWORD PROMPT (تأكيد الهوية — Promise-based in-app modal) ---
let passwordPromptResolver = null;
function promptPassword(hint) {
    return new Promise(resolve => {
        passwordPromptResolver = resolve;
        const hintEl = document.getElementById('password-modal-hint');
        if (hint && hintEl) hintEl.textContent = hint;
        const input = document.getElementById('password-modal-input');
        if (input) input.value = '';
        document.getElementById('password-modal').classList.remove('hidden');
        setTimeout(() => { const i = document.getElementById('password-modal-input'); if (i && typeof i.focus === 'function') i.focus(); }, 120);
    });
}
function closePasswordPrompt() {
    document.getElementById('password-modal').classList.add('hidden');
}
function confirmPasswordPrompt(e) {
    if (e && e.preventDefault) e.preventDefault();
    const v = document.getElementById('password-modal-input').value;
    closePasswordPrompt();
    if (passwordPromptResolver) passwordPromptResolver(v);
    passwordPromptResolver = null;
}
function cancelPasswordPrompt() {
    closePasswordPrompt();
    if (passwordPromptResolver) passwordPromptResolver(null);
    passwordPromptResolver = null;
}

// --- EDIT MY INFO (الاسم، الجوال، البريد) ---
async function saveProfileChanges() {
    if (!currentUser) return;

    const name = document.getElementById('edit-name').value.trim();
    const phone = document.getElementById('edit-phone').value.trim();
    const email = document.getElementById('edit-email').value.trim().toLowerCase();

    if (!name) { showToast('يرجى إدخال الاسم', 'error'); return; }
    if (!phone) { showToast('يرجى إدخال رقم الجوال', 'error'); return; }
    if (!email.includes('@') || email.length < 5) { showToast('البريد الإلكتروني غير صالح', 'error'); return; }

    const emailChanged = email !== (currentUser.email || '').toLowerCase();
    const changed = { name, phone, email };

    if (isFirebaseReady()) {
        // 1) If the email changed, re-authenticate inline then update it (no logout needed)
        if (emailChanged) {
            if (!fbAuth.currentUser) {
                showToast('انتهت الجلسة — سجّل دخولك مجدداً', 'error');
                return;
            }
            const password = await promptPassword('لتغيير البريد، أعد إدخال كلمة المرور الحالية لحسابك');
            if (password === null) return; // ألغيت — لا نحفظ أي تغيير
            try {
                const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email.toLowerCase(), password);
                await fbAuth.currentUser.reauthenticateWithCredential(credential);
                // updateEmail() is deprecated & throws operation-not-allowed; the supported flow is
                // verifyBeforeUpdateEmail() — it sends a verification link to the NEW address.
                await fbAuth.currentUser.verifyBeforeUpdateEmail(email);
            } catch (err) {
                console.error(err);
                const code = err && err.code;
                if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
                    showToast('كلمة المرور غير صحيحة', 'error');
                } else if (code === 'auth/email-already-in-use') {
                    showToast('هذا البريد مسجل بحساب آخر', 'error');
                } else if (code === 'auth/operation-not-allowed') {
                    showToast('تعذر إرسال رابط التأكيد — تأكد أن البريد الجديد صحيح وغير مستخدم', 'error');
                } else {
                    showToast(fbErrorMessage(err), 'error');
                }
                return; // keep firestore consistent: abort entire change
            }
            emailVerificationPending = true;
        }
        currentUser = { ...currentUser, ...changed };
        await persistCurrentUser();
        updateProfileUI();
        // keep admin contacts fresh if this user is an admin
        if (isAdmin()) await fbSyncAdminContact();
        if (emailVerificationPending) {
            emailVerificationPending = false;
            showToast('تم الحفظ ✅ — أعددنا لك رابط تأكيد في بريدك الجديد، اضغطه لإتمام تغيير البريد');
        } else {
            showToast('تم حفظ بياناتك ✅');
        }
        return;
    }

    // Local mode: enforce unique email/phone (excluding self)
    const users = loadUsers();
    const dupEmail = users.find(u => u.id !== currentUser.id && u.email.toLowerCase() === email);
    if (dupEmail) { showToast('البريد الإلكتروني مسجل في حساب آخر', 'error'); return; }
    const dupPhone = users.find(u => u.id !== currentUser.id && u.phone === phone);
    if (dupPhone) { showToast('رقم الجوال مسجل في حساب آخر', 'error'); return; }

    currentUser = { ...currentUser, ...changed };
    await persistCurrentUser();
    updateProfileUI();
    showToast('تم حفظ بياناتك ✅');
}

// --- CHANGE PASSWORD (المستخدم والإدارة — يعمل بالوضعين) ---
function clearPwFields() {
    ['edit-current-pw', 'edit-new-pw', 'edit-confirm-pw'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

async function changePassword() {
    if (!currentUser) return;

    const cur = document.getElementById('edit-current-pw').value;
    const nw = document.getElementById('edit-new-pw').value;
    const cf = document.getElementById('edit-confirm-pw').value;

    if (!cur || !nw || !cf) { showToast('يرجى إدخال كلمة المرور الحالية والجديدة', 'error'); return; }
    if (nw.length < 6) { showToast('كلمة المرور الجديدة 6 أحرف فأكثر', 'error'); return; }
    if (nw !== cf) { showToast('تأكيد كلمة المرور غير مطابق', 'error'); return; }
    if (nw === cur) { showToast('كلمة المرور الجديدة نفسها القديمة — اختر مختلفة', 'error'); return; }

    if (isFirebaseReady()) {
        if (!fbAuth.currentUser) {
            showToast('انتهت الجلسة — سجّل دخولك مجدداً', 'error');
            return;
        }
        try {
            const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email.toLowerCase(), cur);
            await fbAuth.currentUser.reauthenticateWithCredential(credential);
            await fbAuth.currentUser.updatePassword(nw);
        } catch (err) {
            console.error(err);
            const code = err && err.code;
            if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
                showToast('كلمة المرور الحالية غير صحيحة', 'error');
            } else if (code === 'auth/weak-password') {
                showToast('كلمة المرور الجديدة ضعيفة جداً', 'error');
            } else if (code === 'auth/requires-recent-login') {
                showToast('انتهت صلاحية الجلسة — سجّل خروجك ثم دخول وحاول مرة ثانية', 'error');
            } else {
                showToast(fbErrorMessage(err), 'error');
            }
            return;
        }
        clearPwFields();
        showToast('تم تغيير كلمة المرور بنجاح ✅');
        return;
    }

    // Local mode: verify against stored password
    const users = loadUsers();
    const idx = users.findIndex(u => u.id === currentUser.id);
    if (idx === -1) return;
    if (users[idx].password !== cur) {
        showToast('كلمة المرور الحالية غير صحيحة', 'error');
        return;
    }
    users[idx].password = nw;
    saveUsers(users);
    currentUser.password = nw; // keep session profile consistent locally
    clearPwFields();
    showToast('تم تغيير كلمة المرور بنجاح ✅');
}

// --- ADMIN PANEL LOGIC ---
function isAdmin() {
    return currentUser && currentUser.role === 'admin';
}

// Normalize a phone number to WhatsApp format (Saudi-friendly, keeps 966 if present)
function waLink(phone) {
    let p = String(phone || '').replace(/\D/g, '');
    if (p.startsWith('966')) return 'https://wa.me/' + p;
    if (p.startsWith('0')) return 'https://wa.me/966' + p.slice(1);
    if (p.startsWith('5')) return 'https://wa.me/966' + p;
    return 'https://wa.me/' + p;
}

// Contacts of ALL admins — for the feedback email recipients and the support picker
function getAdminContacts() {
    const dedupe = (list) => {
        const seen = new Set();
        return list.filter(c => {
            const key = (c.email || '').toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };

    if (isFirebaseReady()) {
        // Works for every signed-in member: config/site.adminContacts (readable by all, writable by admins)
        const list = Array.isArray(appData.adminContacts) ? appData.adminContacts : [];
        return dedupe(list).map(c => ({ name: c.name, email: c.email, phone: c.phone }));
    }

    return dedupe(loadUsers().filter(u => u.role === 'admin')
        .map(u => ({ name: u.name, email: u.email, phone: u.phone })));
}

// Firebase mode: keep config/site.adminContacts in sync with the real admins (self-healing)
async function fbSyncAdminContact() {
    if (!isFirebaseReady() || !isAdmin()) return;
    try {
        const usersSnap = await fbDb.collection('users').get();
        const admins = usersSnap.docs
            .map(d => d.data())
            .filter(u => u.role === 'admin')
            .map(u => ({
                name: u.name || 'مدير',
                email: (u.email || '').toLowerCase(),
                phone: u.phone || ''
            }));
        await fbDb.collection('config').doc('site').set({ adminContacts: admins }, { merge: true });
        // Update local copy immediately so the support modal works this session too
        appData = { ...appData, adminContacts: admins };
    } catch (err) {
        console.error('admin contact sync failed:', err);
    }
}

// Save a partial update to the shared config doc (Firebase mode)
function fbSaveConfig(patch, successMsg) {
    fbDb.collection('config').doc('site').set(patch, { merge: true })
        .then(() => showToast(successMsg))
        .catch(err => {
            console.error(err);
            showToast('تعذر الحفظ: ' + fbErrorMessage(err), 'error');
        });
}

// --- ADMIN IMAGE UPLOAD (تحميل الصورة من الجهاز) ---
// Stores a compressed dataURL (max 256px, JPEG) in memory until the admin presses "حفظ"
const pendingImages = { reader: null, contemplator: null, location: null };

function handleImageUpload(e, kind) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow selecting the same file again
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        showToast('اختر ملف صورة فقط (JPG, PNG ...)', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onerror = () => showToast('تعذرت قراءة الصورة', 'error');
    reader.onload = () => {
        const img = new Image();
        img.onerror = () => showToast('الصورة غير صالحة', 'error');
        img.onload = () => {
            try {
                const maxSize = 256;
                const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

                pendingImages[kind] = dataUrl;

                const preview = document.getElementById(`admin-${kind}-preview`);
                if (preview) { preview.src = dataUrl; preview.classList.remove('hidden'); }
                const clearBtn = document.getElementById(`admin-${kind}-clear`);
                if (clearBtn) clearBtn.classList.remove('hidden');

                const urlInput = document.getElementById(`admin-${kind}-img`);
                if (urlInput) urlInput.value = ''; // file takes precedence over a typed URL

                showToast('تم اختيار الصورة — اضغط حفظ ليتم اعتمادها');
            } catch (err) {
                console.error('image processing failed:', err);
                showToast('تعذرت معالجة الصورة', 'error');
            }
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

function handleAdminPreview(kind, imgSrc) {
    const preview = document.getElementById(`admin-${kind}-preview`);
    const clearBtn = document.getElementById(`admin-${kind}-clear`);
    if (!preview) return;
    if (imgSrc) {
        preview.src = imgSrc;
        preview.classList.remove('hidden');
        if (clearBtn) clearBtn.classList.remove('hidden');
    } else {
        preview.classList.add('hidden');
        if (clearBtn) clearBtn.classList.add('hidden');
    }
}

// Remove a chosen/saved image — next save will persist img: ''
function clearImage(kind) {
    pendingImages[kind] = 'REMOVE';
    handleAdminPreview(kind, '');
    const urlInput = document.getElementById(`admin-${kind}-img`);
    if (urlInput) urlInput.value = '';
    showToast('ستتم إزالة الصورة عند الضغط على حفظ');
}

// Resolve which image to persist for a kind: '' clears, file upload wins, then URL, then existing
function resolveImage(kind, existingImg) {
    const pending = pendingImages[kind];
    if (pending === 'REMOVE') { pendingImages[kind] = null; return ''; }
    if (pending) { pendingImages[kind] = null; return pending; }
    const urlVal = (document.getElementById(`admin-${kind}-img`) || {}).value || '';
    return urlVal.trim() || existingImg || '';
}

function renderAdminPanel() {
    if (!isAdmin()) return;

    // Fill form fields with current values
    document.getElementById('admin-reader-name').value = appData.bestReader.name;
    document.getElementById('admin-reader-desc').value = appData.bestReader.desc;
    document.getElementById('admin-reader-img').value = '';
    pendingImages.reader = null;
    handleAdminPreview('reader', appData.bestReader.img);

    document.getElementById('admin-contemplator-name').value = appData.bestContemplator.name;
    document.getElementById('admin-contemplator-desc').value = appData.bestContemplator.desc;
    document.getElementById('admin-contemplator-img').value = '';
    pendingImages.contemplator = null;
    handleAdminPreview('contemplator', appData.bestContemplator.img);

    document.getElementById('admin-juz').value = toLatinDigits(appData.stopPoint.juz);
    document.getElementById('admin-surah').value = appData.stopPoint.surah;
    document.getElementById('admin-ayah').value = toLatinDigits(appData.stopPoint.ayah);
    document.getElementById('admin-page').value = toLatinDigits(appData.stopPoint.page);

    document.getElementById('admin-meeting-date').value = appData.meeting.date;
    document.getElementById('admin-meeting-time').value = appData.meeting.time;

    document.getElementById('admin-host-name').value = appData.location.host;
    document.getElementById('admin-host-address').value = appData.location.address;
    document.getElementById('admin-map-link').value = appData.location.mapLink || '';
    document.getElementById('admin-location-img').value = '';
    pendingImages.location = null;
    handleAdminPreview('location', appData.location.img);

    // Fill "اختيار من المستخدمين" dropdowns
    populateAdminUserSelects();

    renderAdminRides();
}

async function saveBestReader() {
    if (!isAdmin()) return;
    const name = document.getElementById('admin-reader-name').value.trim();
    const desc = document.getElementById('admin-reader-desc').value.trim();
    const img = resolveImage('reader', appData.bestReader.img);
    const selectedUserId = (document.getElementById('admin-reader-select') || {}).value || '';

    if (!name) {
        showToast('يرجى إدخال اسم أفضل قارئ', 'error');
        return;
    }

    const bestReader = {
        name,
        desc: desc || 'تكريم التلاوة',
        img
    };

    if (isFirebaseReady()) {
        fbSaveConfig({ bestReader }, 'تم حفظ بيانات أفضل قارئ بنجاح');
    } else {
        appData.bestReader = bestReader;
        saveAppData(appData);
        renderHome();
        showToast('تم حفظ بيانات أفضل قارئ بنجاح');
    }

    // Honor stat: count +1 for the chosen registered user
    if (selectedUserId) {
        await incrementUserHonorStat(selectedUserId, 'bestReader');
        showToast('تم احتساب التكريم للمستخدم المختار 👑');
    }
    const sel = document.getElementById('admin-reader-select');
    if (sel) sel.value = '';
    renderUsersList();
}

async function saveBestContemplator() {
    if (!isAdmin()) return;
    const name = document.getElementById('admin-contemplator-name').value.trim();
    const desc = document.getElementById('admin-contemplator-desc').value.trim();
    const img = resolveImage('contemplator', appData.bestContemplator.img);
    const selectedUserId = (document.getElementById('admin-contemplator-select') || {}).value || '';

    if (!name) {
        showToast('يرجى إدخال اسم أفضل متدبر', 'error');
        return;
    }

    const bestContemplator = {
        name,
        desc: desc || 'وقفات تدبرية',
        img
    };

    if (isFirebaseReady()) {
        fbSaveConfig({ bestContemplator }, 'تم حفظ بيانات أفضل متدبر بنجاح');
    } else {
        appData.bestContemplator = bestContemplator;
        saveAppData(appData);
        renderHome();
        showToast('تم حفظ بيانات أفضل متدبر بنجاح');
    }

    // Honor stat: count +1 for the chosen registered user
    if (selectedUserId) {
        await incrementUserHonorStat(selectedUserId, 'bestContemplator');
        showToast('تم احتساب التكريم للمستخدم المختار 🧠');
    }
    const sel = document.getElementById('admin-contemplator-select');
    if (sel) sel.value = '';
    renderUsersList();
}

function saveStopPoint() {
    if (!isAdmin()) return;
    const juzRaw = toLatinDigits(document.getElementById('admin-juz').value.trim());
    const juzNum = parseInt(juzRaw, 10);
    if (juzRaw && (isNaN(juzNum) || juzNum < 1 || juzNum > 30)) {
        showToast('الجزء يجب أن يكون رقماً بين 1 و 30', 'error');
        return;
    }
    const surah = document.getElementById('admin-surah').value.trim().replace(/^سورة\s*/, '');
    const ayah = toLatinDigits(document.getElementById('admin-ayah').value.trim());
    const page = toLatinDigits(document.getElementById('admin-page').value.trim());

    if (!surah) {
        showToast('يرجى إدخال اسم السورة', 'error');
        return;
    }
    if (!page) {
        showToast('يرجى إدخال رقم الصفحة', 'error');
        return;
    }

    const stopPoint = {
        juz: juzRaw ? String(juzNum) : '-',
        surah,
        ayah: ayah || '-',
        page
    };

    if (isFirebaseReady()) {
        fbSaveConfig({ stopPoint }, 'تم حفظ نقطة التوقف بنجاح');
        return;
    }

    appData.stopPoint = stopPoint;
    saveAppData(appData);
    renderHome();
    showToast('تم حفظ نقطة التوقف بنجاح');
}

function saveMeeting() {
    if (!isAdmin()) return;
    const date = document.getElementById('admin-meeting-date').value;
    const time = document.getElementById('admin-meeting-time').value;

    if (!date || !time) {
        showToast('يرجى اختيار تاريخ ووقت اللقاء', 'error');
        return;
    }

    const meeting = { date, time };

    if (isFirebaseReady()) {
        fbSaveConfig({ meeting }, 'تم حفظ موعد اللقاء بنجاح');
        return;
    }

    appData.meeting = meeting;
    saveAppData(appData);
    renderHome();
    showToast('تم حفظ موعد اللقاء بنجاح');
}

function saveLocation() {
    if (!isAdmin()) return;
    const host = document.getElementById('admin-host-name').value.trim();
    const address = document.getElementById('admin-host-address').value.trim();
    const mapLink = document.getElementById('admin-map-link').value.trim();

    if (!host || !address) {
        showToast('يرجى إدخال اسم المضيف والعنوان', 'error');
        return;
    }

    const img = resolveImage('location', appData.location.img);
    const location = {
        host,
        address,
        mapLink: mapLink || 'https://maps.google.com',
        img
    };

    if (isFirebaseReady()) {
        fbSaveConfig({ location }, 'تم حفظ موقع البيت بنجاح');
        return;
    }

    appData.location = location;
    saveAppData(appData);
    renderHome();
    showToast('تم حفظ موقع البيت بنجاح');
}

function renderAdminRides() {
    if (!isAdmin()) return;
    const list = document.getElementById('admin-rides-list');
    document.getElementById('admin-rides-count').textContent = `${ridesData.length} متطوع`;

    if (ridesData.length === 0) {
        list.innerHTML = `<p class="text-center text-xs text-slate-400 py-4">لا يوجد متطوعون للتوصيل حالياً</p>`;
        return;
    }

    list.innerHTML = ridesData.map(ride => `
        <div class="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div class="min-w-0">
                <p class="font-bold text-xs text-slate-800 flex items-center">
                    <i class="fa-solid fa-car text-emerald-600 ml-1.5"></i>
                    <span class="truncate">${escapeHtml(ride.driverName)}</span>
                </p>
                <p class="text-[10px] text-slate-500 mt-0.5"><i class="fa-solid fa-phone ml-1"></i>${escapeHtml(ride.phone)}</p>
                <p class="text-[10px] text-slate-500"><i class="fa-solid fa-location-dot ml-1"></i>${escapeHtml(ride.area)} • ${ride.seatsBooked}/${ride.seatsTotal} مقاعد</p>
            </div>
            <button onclick="deleteRide('${String(ride.id)}')" title="حذف المتطوع"
                    class="w-9 h-9 flex-shrink-0 bg-rose-100 hover:bg-rose-200 text-rose-600 rounded-xl flex items-center justify-center transition active:scale-95">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </div>
    `).join('');
}

function deleteRide(rideId) {
    if (!isAdmin()) {
        showToast('هذه الصلاحية للمدير فقط', 'error');
        return;
    }
    rideId = String(rideId);
    const ride = ridesData.find(r => String(r.id) === rideId);
    if (!ride) return;

    showConfirm({
        title: 'حذف المتطوع',
        message: `هل أنت متأكد من حذف "${ride.driverName}" من قائمة الموصلات؟`,
        okLabel: 'حذف',
        onConfirm: () => executeDeleteRide(rideId)
    });
}

function executeDeleteRide(rideId) {
    const ride = ridesData.find(r => String(r.id) === String(rideId));
    if (!ride) return;

    if (isFirebaseReady()) {
        fbDb.collection('rides').doc(rideId).delete()
            .then(() => showToast(`تم حذف المتطوع "${ride.driverName}" من قائمة الموصلات`))
            .catch(err => {
                console.error(err);
                showToast('تعذر الحذف: ' + fbErrorMessage(err), 'error');
            });
        return;
    }

    ridesData = ridesData.filter(r => String(r.id) !== rideId);
    saveRides();

    // If the deleted ride was the current user's booking, reset the banner
    if (String(activeBookedCarId) === rideId) {
        activeBookedCarId = null;
        document.getElementById('user-booking-status').classList.add('hidden');
    }

    renderRidesList();
    renderAdminRides();
    showToast(`تم حذف المتطوع "${ride.driverName}" من قائمة الموصلات`);
}

// --- USERS LIST (Admin Only) ---
function renderUsersList() {
    if (!isAdmin()) return;
    const container = document.getElementById('users-container');
    const users = isFirebaseReady() ? cachedFbUsers : loadUsers();

    document.getElementById('users-count').textContent = `${users.length} مستخدم`;

    const avatarColors = ['bg-emerald-600', 'bg-blue-600', 'bg-purple-600', 'bg-rose-500', 'bg-amber-500', 'bg-teal-600'];

    container.innerHTML = users.map((user, i) => {
        const isAdminUser = user.role === 'admin';
        const initial = (user.name || '؟').trim().charAt(0);
        const color = avatarColors[i % avatarColors.length];
        const stats = user.stats || {};
        const volunteerCount = stats.volunteer || 0;
        const readerCount = stats.bestReader || 0;
        const contemplatorCount = stats.bestContemplator || 0;
        const isSelf = currentUser && String(user.id) === String(currentUser.id);
        return `
            <div class="bg-white rounded-2xl p-3 border ${isAdminUser ? 'border-amber-300' : 'border-slate-200/80'} shadow-2xs flex items-center gap-3">
                <div class="w-12 h-12 rounded-full ${color} text-white flex items-center justify-center text-lg font-bold flex-shrink-0">
                    ${escapeHtml(initial)}
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                        <p class="font-bold text-sm text-slate-900">${escapeHtml(user.name)}</p>
                        ${isAdminUser
                            ? '<span class="text-[9px] bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-full font-bold"><i class="fa-solid fa-shield-halved ml-0.5"></i>مدير</span>'
                            : '<span class="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-bold">عضو</span>'}
                    </div>
                    <p class="text-[11px] text-slate-500 mt-1"><i class="fa-solid fa-phone text-emerald-600 ml-1"></i>${escapeHtml(user.phone)}</p>
                    <p class="text-[11px] text-slate-500"><i class="fa-solid fa-envelope text-emerald-600 ml-1"></i>${escapeHtml(user.email)}</p>
                    <!-- Honor & volunteer counters for the admin -->
                    <div class="flex flex-wrap items-center gap-1.5 mt-2">
                        <span title="مرات التطوع للتوصيل" class="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full text-[9px] font-bold">
                            <i class="fa-solid fa-car-side"></i> تطوع: ${volunteerCount}
                        </span>
                        <span title="مرات أفضل قارئ" class="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-800 px-2 py-0.5 rounded-full text-[9px] font-bold">
                            <i class="fa-solid fa-crown"></i> أفضل قارئ: ${readerCount}
                        </span>
                        <span title="مرات أفضل متدبر" class="inline-flex items-center gap-1 bg-purple-50 border border-purple-200 text-purple-800 px-2 py-0.5 rounded-full text-[9px] font-bold">
                            <i class="fa-solid fa-brain"></i> أفضل متدبر: ${contemplatorCount}
                        </span>
                    </div>
                </div>
                ${isSelf
                    ? `<span title="لا يمكنك حذف حسابك الخاص" class="w-9 h-9 flex-shrink-0 bg-slate-100 text-slate-300 rounded-xl flex items-center justify-center"><i class="fa-solid fa-lock text-xs"></i></span>`
                    : isAdminUser
                        ? `<span title="لا يمكن حذف المديرين من داخل التطبيق (من Firebase Console فقط)" class="w-9 h-9 flex-shrink-0 bg-amber-50 text-amber-400 rounded-xl flex items-center justify-center"><i class="fa-solid fa-lock text-xs"></i></span>`
                        : `<button onclick="deleteUserAccount('${escapeHtml(String(user.id))}')" title="حذف المستخدم"
                            class="w-9 h-9 flex-shrink-0 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-xl flex items-center justify-center transition">
                            <i class="fa-solid fa-trash-can text-sm"></i>
                        </button>`}
            </div>
        `;
    }).join('');

    // Keep the admin-panel dropdowns in sync too (best reader / best contemplator pickers)
    populateAdminUserSelects();
}

// --- DELETE USER (admin only) — deletes the profile doc; account cannot log in afterwards ---
function deleteUserAccount(userId) {
    if (!isAdmin()) {
        showToast('هذه الصلاحية للمدير فقط', 'error');
        return;
    }
    userId = String(userId);
    const users = isFirebaseReady() ? cachedFbUsers : loadUsers();
    const target = users.find(u => String(u.id) === userId);

    if (!target) { showToast('المستخدم غير موجود', 'error'); return; }
    if (target.role === 'admin') { showToast('لا يمكن حذف المديرين من داخل التطبيق', 'error'); return; }
    if (currentUser && String(currentUser.id) === userId) { showToast('لا يمكنك حذف حسابك الخاص', 'error'); return; }

    showConfirm({
        title: 'حذف المستخدم',
        message: `هل أنت متأكد من حذف "${target.name}" (${target.email})؟ لن يتمكن من تسجيل الدخول بعد الآن.`,
        okLabel: 'حذف',
        onConfirm: () => executeDeleteUser(userId)
    });
}

async function executeDeleteUser(userId) {
    userId = String(userId);

    if (isFirebaseReady()) {
        try {
            await fbDb.collection('users').doc(userId).delete();
            cachedFbUsers = (cachedFbUsers || []).filter(u => String(u.id) !== userId);
            renderUsersList();
            showToast('تم حذف المستخدم — لن يتمكن من الدخول مرة أخرى');
        } catch (err) {
            console.error(err);
            showToast('تعذر الحذف: ' + fbErrorMessage(err), 'error');
        }
        return;
    }

    const users = loadUsers().filter(u => String(u.id) !== userId);
    saveUsers(users);
    renderUsersList();
    showToast('تم حذف المستخدم');
}

// Populate the "اختيار من المستخدمين" dropdowns in the admin panel
function getAdminUsersList() {
    return isFirebaseReady() ? cachedFbUsers : loadUsers();
}
function populateAdminUserSelects() {
    if (!isAdmin()) return;

    // Firebase mode: if the cached list is empty (first paint / snapshot pending),
    // fetch the users collection directly, then re-fill
    if (isFirebaseReady() && (!cachedFbUsers || cachedFbUsers.length === 0)) {
        fbDb.collection('users').get()
            .then(snap => {
                cachedFbUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                populateAdminUserSelects();
            })
            .catch(err => console.error('admin user list fetch failed:', err));
    }

    const users = getAdminUsersList();
    const options = users
        .slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'))
        .map(u => `<option value="${escapeHtml(String(u.id))}">${escapeHtml(u.name)} — ${escapeHtml(u.email)}</option>`)
        .join('');

    ['reader', 'contemplator'].forEach(kind => {
        const sel = document.getElementById(`admin-${kind}-select`);
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = `<option value="">اختر من احد المستخدمين ...</option>${options}`;
        sel.value = current; // restores if still present, else resets to manual
    });
}

// Fill the honor form fields from a registered user + prefill their avatar
function handleAdminUserSelect(kind) {
    const sel = document.getElementById(`admin-${kind}-select`);
    if (!sel) return;
    const userId = sel.value;

    if (!userId) {
        pendingImages[kind] = null;
        handleAdminPreview(kind, null);
        return;
    }
    const user = getAdminUsersList().find(u => String(u.id) === String(userId));
    if (!user) return;

    document.getElementById(`admin-${kind}-name`).value = user.name || '';
    if (user.avatar) {
        pendingImages[kind] = user.avatar;
        handleAdminPreview(kind, user.avatar);
    } else {
        pendingImages[kind] = null;
        handleAdminPreview(kind, null);
    }
}

// Count +1 honor stat for the selected (or self) registered user
async function incrementUserHonorStat(userId, statKey) {
    userId = String(userId);
    if (isFirebaseReady()) {
        try {
            await fbDb.collection('users').doc(userId).update({
                [`stats.${statKey}`]: firebase.firestore.FieldValue.increment(1)
            });
            if (currentUser && String(currentUser.id) === userId) {
                currentUser.stats = currentUser.stats || {};
                currentUser.stats[statKey] = (currentUser.stats[statKey] || 0) + 1;
                updateProfileUI();
            }
        } catch (err) {
            console.error('honor stat increment failed:', err);
        }
        return;
    }
    const users = loadUsers();
    const u = users.find(x => String(x.id) === userId);
    if (u) {
        u.stats = u.stats || {};
        u.stats[statKey] = (u.stats[statKey] || 0) + 1;
        saveUsers(users);
        if (currentUser && String(currentUser.id) === userId) {
            currentUser.stats = { ...u.stats };
            updateProfileUI();
        }
    }
}

// Clamp the الجزء input to 1..30 live while typing/spinning
function clampJuz(input) {
    if (!input) return;
    if (input.value === '') return;
    let v = parseInt(input.value, 10);
    if (isNaN(v) || v < 1) { input.value = ''; return; }
    if (v > 30) input.value = '30';
}

// --- MODALS & NOTIFICATIONS HELPERS ---
function openSupportModal() {
    renderAdminContactsList();
    document.getElementById('support-modal').classList.remove('hidden');
}
function closeSupportModal() {
    document.getElementById('support-modal').classList.add('hidden');
}

// Build the list of admins the member can contact (phone / WhatsApp)
function renderAdminContactsList() {
    const list = document.getElementById('support-admins-list');
    const empty = document.getElementById('support-empty');
    if (!list) return;

    const admins = getAdminContacts();
    if (admins.length === 0) {
        list.innerHTML = '';
        if (empty) empty.classList.remove('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');

    list.innerHTML = admins.map(a => `
        <div class="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div class="min-w-0">
                <p class="font-bold text-xs text-slate-800 flex items-center">
                    <i class="fa-solid fa-user-tie text-amber-600 ml-1.5"></i>
                    <span class="truncate">${escapeHtml(a.name)}</span>
                </p>
                <p class="text-[10px] text-slate-500 mt-0.5"><i class="fa-solid fa-phone text-emerald-600 ml-1"></i><span dir="ltr">${escapeHtml(a.phone || 'بدون رقم')}</span></p>
            </div>
            <div class="flex gap-1.5 flex-shrink-0">
                <a href="tel:${escapeHtml(String(a.phone || '').replace(/\s/g, ''))}" title="اتصال هاتفي"
                   class="w-9 h-9 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-lg flex items-center justify-center transition">
                    <i class="fa-solid fa-phone text-xs"></i>
                </a>
                <a href="${waLink(a.phone)}" target="_blank" rel="noopener noreferrer" title="واتساب"
                   class="w-9 h-9 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center justify-center transition">
                    <i class="fa-brands fa-whatsapp text-sm"></i>
                </a>
            </div>
        </div>
    `).join('');
}

function openFeedbackModal() {
    document.getElementById('feedback-modal').classList.remove('hidden');
}
function closeFeedbackModal() {
    document.getElementById('feedback-modal').classList.add('hidden');
}

function submitFeedback() {
    const text = document.getElementById('feedback-text').value;
    if(!text.trim()) {
        showToast("يرجى كتابة الملاحظة أولاً", "error");
        return;
    }
    const admins = getAdminContacts();
    const emails = admins.map(a => a.email).filter(e => e && e.includes('@'));

    if (emails.length === 0) {
        showToast("لا يوجد مدير مسجل لاستقبال الملاحظة حالياً", "error");
        return;
    }

    const sender = currentUser ? `${currentUser.name} — جوال: ${currentUser.phone} — بريد: ${currentUser.email}` : 'عضو غير معروف';
    const subject = encodeURIComponent('ملاحظة/اقتراح من أحد أعضاء مجلس القرآن');
    const body = encodeURIComponent(`الملاحظة:\n${text.trim()}\n\n— المُرسِل: ${sender}`);
    const mailto = `mailto:${emails.join(',')}?subject=${subject}&body=${body}`;

    try {
        // Open the member's mail client addressed to ALL admins
        window.location.href = mailto;
        closeFeedbackModal();
        document.getElementById('feedback-text').value = '';
        showToast(`سيتم فتح بريدك لإرسال الملاحظة إلى ${emails.length} مدير/مديرين`);
    } catch (err) {
        console.error('mailto failed:', err);
        showToast('تعذر فتح البريد — أرسل ملاحظتك يدوياً إلى: ' + emails.join('، '), 'error');
    }
}

function showToast(msg, type = "success") {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toast-icon');
    document.getElementById('toast-message').textContent = msg;

    if(type === "error") {
        icon.className = "fa-solid fa-triangle-exclamation text-rose-400";
    } else {
        icon.className = "fa-solid fa-circle-check text-emerald-400";
    }

    toast.classList.remove('opacity-0', 'pointer-events-none');
    setTimeout(() => {
        toast.classList.add('opacity-0', 'pointer-events-none');
    }, 3000);
}
// In Firebase mode: login is by email only — adjust the label/placeholder
if (isFirebaseReady()) {
    try {
        const label = document.getElementById('login-identifier-label');
        if (label) label.textContent = 'البريد الإلكتروني';
        const input = document.getElementById('login-identifier');
        if (input) input.placeholder = 'example@email.com';
        const hint = document.getElementById('local-admin-hint');
        if (hint) hint.classList.add('hidden');
    } catch { /* DOM not ready — ignore */ }
}

// تحديث سنة الحقوق تلقائياً
document.addEventListener("DOMContentLoaded", function() {
    const yearSpan = document.getElementById('current-year');
    if (yearSpan) {
        yearSpan.textContent = new Date().getFullYear();
    }
});


