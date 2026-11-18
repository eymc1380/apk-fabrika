/**
 * YMC Store - Backend API İstemcisi (Apps Script + Demo Modu)
 */
window.YmcApi = (() => {
  const SESSION_KEY = "ymc_store_session";
  const DEMO_MODE_KEY = "ymc_store_demo_mode";

  let demoApps = [
    {
      id: "demo_kasadefteri",
      name: "Kasa Defteri Pro",
      packageName: "com.ymc.kasadefterim",
      versionName: "2.1.0",
      versionCode: 21,
      category: "Finans",
      developer: "Erhan Yamaç",
      shortDesc: "Şube bazlı günlük kasa, gelir-gider ve cari takip uygulaması",
      description: "İşletmeniz için hızlı kasa defteri. Günlük nakit/kart girişlerini, şube raporlarını ve özet bakiyeleri anında takip edin. Google Drive yedekleme ve Excel dışa aktarma desteklidir.",
      whatsNew: "• Yeni koyu tema desteği\n• Hızlı günlük rapor özeti\n• Performans iyileştirmeleri",
      driveFileId: "DEMO_FILE_1",
      fileName: "KasaDefteri.apk",
      fileSizeText: "18.4 MB",
      iconUrl: "",
      screenshots: [],
      downloads: 428,
      ratingAvg: 4.9,
      ratingCount: 34,
      featured: true,
      active: true,
      downloadUrl: "",
      createdAt: Date.now() - 86400000 * 5,
      updatedAt: Date.now() - 86400000
    },
    {
      id: "demo_cepradyo",
      name: "Cep Radyo FM",
      packageName: "com.ymc.cepradyo",
      versionName: "1.4.2",
      versionCode: 14,
      category: "Medya",
      developer: "Erhan Yamaç",
      shortDesc: "Kesintisiz canlı radyo yayını ve favori kanal listesi",
      description: "Türkiye'nin popüler radyo kanallarını düşük internet tüketimiyle kesintisiz dinleyin. Arka planda çalma ve uyku zamanlayıcısı içerir.",
      whatsNew: "• 15 yeni yerel kanal eklendi\n• Bildirim çubuğu oynatıcı kontrolleri güncellendi",
      driveFileId: "DEMO_FILE_2",
      fileName: "CepRadyo.apk",
      fileSizeText: "3.9 MB",
      iconUrl: "",
      screenshots: [],
      downloads: 892,
      ratingAvg: 4.7,
      ratingCount: 51,
      featured: true,
      active: true,
      downloadUrl: "",
      createdAt: Date.now() - 86400000 * 12,
      updatedAt: Date.now() - 86400000 * 3
    },
    {
      id: "demo_nobet",
      name: "Nöbetçi Takibi",
      packageName: "com.ymc.nobettakip",
      versionName: "3.0.1",
      versionCode: 30,
      category: "Araçlar",
      developer: "Erhan Yamaç",
      shortDesc: "İlçe ve il bazlı anlık nöbetçi listesi ve yol tarifi",
      description: "Bulunduğunuz konuma en yakın nöbetçileri hızlıca listeleyin, tek dokunuşla arayın veya haritada yol tarifi başlatın.",
      whatsNew: "• Konuma göre otomatik sıralama eklendi",
      driveFileId: "DEMO_FILE_3",
      fileName: "NobetciTakibi.apk",
      fileSizeText: "12.1 MB",
      iconUrl: "",
      screenshots: [],
      downloads: 215,
      ratingAvg: 4.6,
      ratingCount: 18,
      featured: false,
      active: true,
      downloadUrl: "",
      createdAt: Date.now() - 86400000 * 20,
      updatedAt: Date.now() - 86400000 * 7
    }
  ];

  let demoReviews = {
    demo_kasadefteri: [
      {
        reviewId: "r1",
        appId: "demo_kasadefteri",
        uid: "u1",
        userName: "Mehmet Kaya",
        userPhoto: "",
        rating: 5,
        comment: "Çok sade ve hızlı çalışıyor, günlük kasa hesabında büyük kolaylık.",
        createdAt: Date.now() - 86400000 * 2
      }
    ]
  };

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function saveSession(token, user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(DEMO_MODE_KEY);
  }

  function isDemoMode() {
    return localStorage.getItem(DEMO_MODE_KEY) === "1";
  }

  function enableDemoSession(email = "ymcerh@gmail.com", displayName = "Erhan (Demo Yönetici)") {
    localStorage.setItem(DEMO_MODE_KEY, "1");
    const user = {
      uid: "demo_admin",
      email,
      displayName,
      photoUrl: "",
      provider: "demo",
      role: "admin"
    };
    saveSession("DEMO_TOKEN", user);
    return { ok: true, token: "DEMO_TOKEN", user };
  }

  async function requestGet(action, params = {}) {
    const cfg = window.YmcConfig.get();
    if (!cfg.APPS_SCRIPT_URL) {
      throw new Error("Apps Script Web Uygulaması URL'si henüz tanımlanmadı.");
    }
    const url = new URL(cfg.APPS_SCRIPT_URL);
    url.searchParams.set("action", action);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });

    const res = await fetch(url.toString(), { method: "GET", redirect: "follow" });
    if (!res.ok) throw new Error("Sunucu yanıt hatası: HTTP " + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "İşlem başarısız.");
    return data;
  }

  async function requestPost(action, body = {}) {
    const cfg = window.YmcConfig.get();
    if (!cfg.APPS_SCRIPT_URL) {
      throw new Error("Apps Script Web Uygulaması URL'si henüz tanımlanmadı.");
    }
    const session = getSession();
    const payload = {
      action,
      ...(session && session.token ? { token: session.token } : {}),
      ...body
    };

    // Apps Script CORS preflight (OPTIONS) tetiklememek için text/plain kullanılır
    const res = await fetch(cfg.APPS_SCRIPT_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Sunucu yanıt hatası: HTTP " + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "İşlem başarısız.");
    return data;
  }

  async function pingCustomUrl(urlStr) {
    const url = new URL(urlStr.trim());
    url.searchParams.set("action", "ping");
    const res = await fetch(url.toString(), { method: "GET", redirect: "follow" });
    if (!res.ok) throw new Error("Bağlantı başarısız: HTTP " + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Geçersiz yanıt.");
    return data;
  }

  async function register({ displayName, email, password }) {
    const data = await requestPost("register", { displayName, email, password });
    saveSession(data.token, data.user);
    return data;
  }

  async function login({ email, password }) {
    const data = await requestPost("login", { email, password });
    saveSession(data.token, data.user);
    return data;
  }

  async function googleAuth(idToken) {
    const data = await requestPost("googleAuth", { idToken });
    saveSession(data.token, data.user);
    return data;
  }

  async function refreshMe() {
    if (isDemoMode()) return { ok: true, user: getSession()?.user };
    const data = await requestPost("me", {});
    const sess = getSession();
    if (sess && data.user) saveSession(sess.token, data.user);
    return data;
  }

  async function getCatalog() {
    if (isDemoMode()) {
      return {
        ok: true,
        settings: {
          storeName: "YMC Store (Demo)",
          storeSubtitle: "Özel Android Uygulama Mağazası",
          announcement: "Demo Önizleme Modundasınız. Gerçek Drive bağlantısı için Kurulum adımını tamamlayın.",
          adminEmails: "ymcerh@gmail.com"
        },
        apps: demoApps
      };
    }
    return requestPost("catalog", {});
  }

  async function getReviews(appId) {
    if (isDemoMode()) {
      return { ok: true, reviews: demoReviews[appId] || [] };
    }
    return requestGet("reviews", { appId });
  }

  async function addReview(appId, rating, comment) {
    if (isDemoMode()) {
      const sess = getSession();
      const rev = {
        reviewId: "r_" + Date.now(),
        appId,
        uid: sess.user.uid,
        userName: sess.user.displayName,
        userPhoto: "",
        rating,
        comment,
        createdAt: Date.now()
      };
      demoReviews[appId] = [rev, ...(demoReviews[appId] || []).filter(r => r.uid !== sess.user.uid)];
      return { ok: true, ratingAvg: rating, ratingCount: demoReviews[appId].length };
    }
    return requestPost("addReview", { appId, rating, comment });
  }

  async function trackDownload(appId) {
    if (isDemoMode()) {
      const app = demoApps.find(a => a.id === appId);
      if (app) app.downloads += 1;
      throw new Error("Demo modunda gerçek APK indirmesi devre dışıdır. Kurulumdan Apps Script URL'nizi bağlayın.");
    }
    return requestPost("trackDownload", { appId });
  }

  async function listDriveFiles() {
    if (isDemoMode()) {
      return {
        ok: true,
        folderId: window.YmcConfig.get().DRIVE_FOLDER_ID,
        files: [
          { id: "demo_drive_1", name: "YeniUygulama_v1.apk", sizeBytes: 15400000, sizeText: "14.7 MB", updatedAt: Date.now(), alreadyInCatalog: false }
        ]
      };
    }
    return requestPost("listDriveFiles", {});
  }

  async function uploadSmallFile(fileName, mimeType, base64Data) {
    if (isDemoMode()) {
      throw new Error("Demo modunda Drive yüklemesi yapılamaz.");
    }
    return requestPost("uploadSmallFile", { fileName, mimeType, base64Data });
  }

  async function createUploadSession(fileName, mimeType, fileSize) {
    return requestPost("createUploadSession", { fileName, mimeType, fileSize });
  }

  async function finalizeDriveFile(fileId) {
    return requestPost("finalizeDriveFile", { fileId });
  }

  async function saveApp(app) {
    if (isDemoMode()) {
      const idx = demoApps.findIndex(a => a.id === app.id);
      const item = {
        ...app,
        id: app.id || ("demo_" + Date.now()),
        downloads: app.downloads || 0,
        ratingAvg: app.ratingAvg || 0,
        ratingCount: app.ratingCount || 0,
        updatedAt: Date.now(),
        createdAt: app.createdAt || Date.now()
      };
      if (idx >= 0) demoApps[idx] = item;
      else demoApps.unshift(item);
      return { ok: true, id: item.id };
    }
    return requestPost("saveApp", { app });
  }

  async function deleteApp(appId, deleteDriveFile = false) {
    if (isDemoMode()) {
      demoApps = demoApps.filter(a => a.id !== appId);
      return { ok: true };
    }
    return requestPost("deleteApp", { appId, deleteDriveFile });
  }

  async function listUsers() {
    if (isDemoMode()) {
      return {
        ok: true,
        users: [getSession().user]
      };
    }
    return requestPost("listUsers", {});
  }

  async function saveSettings(settings) {
    if (isDemoMode()) return { ok: true };
    return requestPost("saveSettings", { settings });
  }

  return {
    getSession,
    saveSession,
    clearSession,
    isDemoMode,
    enableDemoSession,
    pingCustomUrl,
    register,
    login,
    googleAuth,
    refreshMe,
    getCatalog,
    getReviews,
    addReview,
    trackDownload,
    listDriveFiles,
    uploadSmallFile,
    createUploadSession,
    finalizeDriveFile,
    saveApp,
    deleteApp,
    listUsers,
    saveSettings
  };
})();
