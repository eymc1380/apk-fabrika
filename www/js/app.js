/**
 * YMC Store - Ana Uygulama Mantığı
 */
(() => {
  "use strict";

  const CATEGORIES = ["Tümü", "Araçlar", "Finans", "Medya", "Eğitim", "İletişim", "Verimlilik", "Oyun", "Diğer"];
  const THEME_KEY = "ymc_store_theme";
  const PKG_HINTS_KEY = "ymc_store_pkg_hints";

  function loadPkgHints() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PKG_HINTS_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  const state = {
    user: null,
    settings: {
      storeName: "YMC Store",
      storeSubtitle: "Özel Android Uygulama Mağazası",
      announcement: "",
      adminEmails: "ymcerh@gmail.com"
    },
    apps: [],
    installedMap: {},
    pkgHints: loadPkgHints(),
    downloads: {}, // appId -> { percent, downloaded, total }
    currentTab: "store",
    adminTab: "publish",
    selectedCategory: "Tümü",
    sortBy: "updated",
    searchQuery: "",
    authMode: "login",
    openAppId: null,
    detailRating: 5,
    isUploadingApk: false,
    editScreenshots: [],
    installedPickerApps: [],
    nativeInfo: window.YmcBridge.getNativeInfo()
  };

  function savePkgHint(appId, pkg) {
    const clean = String(pkg || "").trim();
    if (!appId || !clean) return;
    state.pkgHints[appId] = clean;
    try {
      localStorage.setItem(PKG_HINTS_KEY, JSON.stringify(state.pkgHints));
    } catch (e) {}
  }

  function getEffectivePkg(app) {
    if (!app) return "";
    return String(app.packageName || state.pkgHints[app.id] || "").trim();
  }

  const $ = (id) => document.getElementById(id);

  /* ==================== YARDIMCILAR ==================== */

  function esc(val) {
    return String(val ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeUrl(url) {
    const s = String(url || "").trim();
    if (/^https?:\/\//i.test(s) || /^data:image\//i.test(s)) return s;
    return "";
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return "0 MB";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return v.toFixed(i === 0 ? 0 : 1) + " " + units[i];
  }

  function formatDate(ts) {
    if (!ts) return "-";
    try {
      return new Date(Number(ts)).toLocaleDateString("tr-TR", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      });
    } catch (e) {
      return "-";
    }
  }

  function getGradientForText(text) {
    const palettes = [
      ["#2563eb", "#059669"],
      ["#7c3aed", "#2563eb"],
      ["#db2777", "#ea580c"],
      ["#0891b2", "#0284c7"],
      ["#059669", "#16a34a"],
      ["#4f46e5", "#9333ea"]
    ];
    let hash = 0;
    const s = String(text || "Y");
    for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
    const pair = palettes[Math.abs(hash) % palettes.length];
    return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
  }

  function getInitials(name) {
    const parts = String(name || "Y").trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(name || "Y").slice(0, 2).toUpperCase();
  }

  let toastTimer = null;
  function showToast(msg, type = "info", duration = 3200) {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast show" + (type !== "info" ? " " + type : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("show");
    }, duration);
  }
  window.YmcToast = showToast;

  function renderIconHtml(app, large = false) {
    const url = safeUrl(app.iconUrl);
    const cls = large ? "app-icon lg" : "app-icon";
    const bg = getGradientForText(app.name);
    const initials = esc(getInitials(app.name));
    if (url) {
      return `<div class="${cls}" style="background:${bg};">
        <img src="${esc(url)}" alt="${esc(app.name)}" onerror="this.remove();" />
      </div>`;
    }
    return `<div class="${cls}" style="background:${bg};">${initials}</div>`;
  }

  function getAppActionState(app) {
    if (state.downloads[app.id]) {
      return { type: "downloading", ...state.downloads[app.id] };
    }
    const pkg = getEffectivePkg(app);
    const inst = pkg ? state.installedMap[pkg] : null;
    if (inst && inst.installed) {
      if ((Number(app.versionCode) || 1) > (Number(inst.versionCode) || 0)) {
        return { type: "update", label: "Güncelle", installed: inst };
      }
      return { type: "open", label: "Aç", installed: inst };
    }
    return { type: "install", label: "Yükle" };
  }

  /* ==================== TEMA ==================== */

  function applyTheme(theme) {
    const target = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", target);
    localStorage.setItem(THEME_KEY, target);
    $("btn-theme-toggle").textContent = target === "dark" ? "☀️" : "🌙";
    $("btn-theme-dark").classList.toggle("active", target === "dark");
    $("btn-theme-light").classList.toggle("active", target === "light");
  }

  /* ==================== BAŞLATMA & OTURUM ==================== */

  function dismissSplashOverlay() {
    const splash = $("splash-overlay");
    if (!splash || splash.dataset.dismissed === "1") return;
    splash.dataset.dismissed = "1";
    splash.classList.add("splash-exit");
    setTimeout(() => {
      splash.classList.add("hidden");
    }, 450);
  }

  async function init() {
    const savedTheme = localStorage.getItem(THEME_KEY) || "dark";
    applyTheme(savedTheme);
    bindEvents();
    updateSetupBanner();

    // Açılış animasyonu paralel oturum/katalog yüklemesinin ardından pürüzsüzce kapanır
    setTimeout(dismissSplashOverlay, 1250);

    window.YmcBridge.onResume(() => {
      refreshInstalledStates();
      renderProfileDeviceInfo();
      setTimeout(refreshInstalledStates, 1100);
      setTimeout(refreshInstalledStates, 2600);
    });

    window.YmcBridge.onPackageChanged(() => {
      refreshInstalledStates();
      setTimeout(refreshInstalledStates, 550);
    });

    const session = window.YmcApi.getSession();
    if (session && session.token && session.user) {
      state.user = session.user;
      enterStore();
      if (!window.YmcApi.isDemoMode() && window.YmcConfig.isConfigured()) {
        window.YmcApi.refreshMe().then(res => {
          if (res && res.user) {
            state.user = res.user;
            renderUserUi();
          }
        }).catch(err => {
          if (String(err.message).includes("Oturumunuz geçersiz")) {
            logout(true);
          }
        });
      }
    } else {
      showAuthView();
    }
  }

  function updateSetupBanner() {
    const configured = window.YmcConfig.isConfigured();
    $("setup-banner").classList.toggle("hidden", configured);
    const cfg = window.YmcConfig.get();
    $("auth-store-title").textContent = cfg.STORE_NAME || "YMC Store";
    $("auth-store-subtitle").textContent = cfg.STORE_SUBTITLE || "Özel Android Uygulama Mağazası";
  }

  function showAuthView() {
    $("auth-view").classList.remove("hidden");
    $("app-view").classList.add("hidden");
    $("detail-view").classList.add("hidden");
    updateSetupBanner();
  }

  function enterStore() {
    $("auth-view").classList.add("hidden");
    $("app-view").classList.remove("hidden");
    renderUserUi();
    renderCategoryChips();
    switchTab("store");
    loadCatalog();
    renderProfileDeviceInfo();
  }

  function logout(silent = false) {
    window.YmcApi.clearSession();
    state.user = null;
    state.apps = [];
    state.openAppId = null;
    showAuthView();
    if (!silent) showToast("Oturum kapatıldı.");
  }

  function renderUserUi() {
    const u = state.user;
    if (!u) return;

    const isAdmin = u.role === "admin";
    $("nav-admin-btn").classList.toggle("hidden", !isAdmin);

    const avatarHtml = safeUrl(u.photoUrl)
      ? `<img src="${esc(safeUrl(u.photoUrl))}" alt="${esc(u.displayName)}" />`
      : esc(getInitials(u.displayName || u.email));

    $("topbar-avatar").innerHTML = avatarHtml;
    $("profile-avatar").innerHTML = avatarHtml;
    $("profile-name").textContent = u.displayName || "Kullanıcı";
    $("profile-email").textContent = u.email || "";

    const badges = [];
    if (u.provider === "google") badges.push('<span class="badge badge-blue">Google Hesabı</span>');
    else if (u.provider === "demo") badges.push('<span class="badge badge-amber">Demo Modu</span>');
    else badges.push('<span class="badge badge-green">E-posta Üyeliği</span>');

    if (isAdmin) badges.push('<span class="badge badge-amber">Yönetici</span>');
    $("profile-badges").innerHTML = badges.join("");
  }

  /* ==================== KATALOG & DURUM GÜNCELLEME ==================== */

  async function loadCatalog() {
    if (!window.YmcApi.isDemoMode() && !window.YmcConfig.isConfigured()) {
      showToast("Apps Script URL ayarlı değil. Bağlantı kurulumunu tamamlayın.", "warning", 4500);
      return;
    }
    try {
      const data = await window.YmcApi.getCatalog();
      state.apps = Array.isArray(data.apps) ? data.apps : [];
      if (data.settings) {
        state.settings = { ...state.settings, ...data.settings };
        applySettingsUi();
      }
      refreshInstalledStates();
      renderStore();
      renderLibrary();
      if (state.user && state.user.role === "admin") {
        renderAdminStats();
        renderAdminManageList();
      }
    } catch (err) {
      showToast(err.message || "Katalog yüklenemedi.", "error");
    }
  }

  function applySettingsUi() {
    const s = state.settings;
    $("header-store-title").textContent = s.storeName || "YMC Store";
    $("auth-store-title").textContent = s.storeName || "YMC Store";
    $("auth-store-subtitle").textContent = s.storeSubtitle || "Özel Android Uygulama Mağazası";

    const ann = String(s.announcement || "").trim();
    $("announcement-bar").classList.toggle("hidden", !ann);
    $("announcement-text").textContent = ann;

    if ($("set-store-name")) {
      $("set-store-name").value = s.storeName || "YMC Store";
      $("set-store-subtitle").value = s.storeSubtitle || "";
      $("set-announcement").value = ann;
      if (s.adminEmails !== undefined) $("set-admin-emails").value = s.adminEmails;
    }
  }

  function refreshInstalledStates() {
    const pkgs = [...new Set(state.apps.map(a => getEffectivePkg(a)).filter(Boolean))];
    state.installedMap = pkgs.length > 0
      ? window.YmcBridge.getInstalledAppsStatus(pkgs)
      : {};
    renderStore();
    renderLibrary();
    if (state.openAppId) renderDetailActionArea();
  }

  /* ==================== MAĞAZA RENDER ==================== */

  function renderCategoryChips() {
    const el = $("category-chips");
    el.innerHTML = CATEGORIES.map(cat => `
      <button class="chip ${state.selectedCategory === cat ? "active" : ""}" data-cat="${esc(cat)}" type="button">
        ${esc(cat)}
      </button>
    `).join("");

    el.querySelectorAll(".chip").forEach(btn => {
      btn.addEventListener("click", () => {
        state.selectedCategory = btn.dataset.cat;
        renderCategoryChips();
        renderStore();
      });
    });
  }

  function getFilteredApps() {
    let list = state.apps.filter(a => a.active !== false);

    if (state.selectedCategory !== "Tümü") {
      list = list.filter(a => (a.category || "Araçlar") === state.selectedCategory);
    }

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      list = list.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.developer.toLowerCase().includes(q) ||
        a.shortDesc.toLowerCase().includes(q) ||
        getEffectivePkg(a).toLowerCase().includes(q)
      );
    }

    list = [...list];
    switch (state.sortBy) {
      case "downloads":
        list.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
        break;
      case "rating":
        list.sort((a, b) => (b.ratingAvg || 0) - (a.ratingAvg || 0));
        break;
      case "name":
        list.sort((a, b) => a.name.localeCompare(b.name, "tr"));
        break;
      default:
        list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    }
    return list;
  }

  function renderStore() {
    const filtered = getFilteredApps();

    // Öne Çıkanlar
    const showFeatured = !state.searchQuery && state.selectedCategory === "Tümü";
    const featuredApps = state.apps.filter(a => a.active !== false && a.featured);
    const featSection = $("featured-section");
    const featCarousel = $("featured-carousel");

    if (showFeatured && featuredApps.length > 0) {
      featSection.classList.remove("hidden");
      featCarousel.innerHTML = featuredApps.map((app, idx) => {
        const gradients = [
          "linear-gradient(135deg, #1d4ed8, #059669)",
          "linear-gradient(135deg, #6d28d9, #2563eb)",
          "linear-gradient(135deg, #0f766e, #0284c7)"
        ];
        const act = getAppActionState(app);
        return `
          <div class="featured-card" style="background:${gradients[idx % gradients.length]}" data-open-app="${esc(app.id)}">
            <span class="featured-badge">Öne Çıkan</span>
            <div class="featured-top">
              ${renderIconHtml(app)}
              <div style="min-width:0; flex:1;">
                <div class="app-title" style="color:#fff;">${esc(app.name)}</div>
                <div class="app-dev" style="color:rgba(255,255,255,0.8);">${esc(app.developer)}</div>
              </div>
            </div>
            <div class="featured-desc">${esc(app.shortDesc || app.description || "İncele ve hemen cihazına kur.")}</div>
            <div class="featured-bottom">
              <span>★ ${Number(app.ratingAvg || 0).toFixed(1)} • ${esc(app.fileSizeText || "APK")}</span>
              <span class="badge" style="background:rgba(255,255,255,0.22); color:#fff;">${esc(act.label || "İncele")}</span>
            </div>
          </div>
        `;
      }).join("");
    } else {
      featSection.classList.add("hidden");
    }

    $("apps-list-heading").textContent = state.searchQuery
      ? `Arama Sonuçları (${filtered.length})`
      : (state.selectedCategory === "Tümü" ? `Tüm Uygulamalar (${filtered.length})` : `${state.selectedCategory} (${filtered.length})`);

    const grid = $("apps-grid");
    if (filtered.length === 0) {
      grid.innerHTML = `<div class="empty-box" style="grid-column:1/-1;">
        ${state.apps.length === 0 ? "Mağazada henüz uygulama bulunmuyor." : "Aramanızla eşleşen uygulama bulunamadı."}
      </div>`;
      return;
    }

    grid.innerHTML = filtered.map(app => renderAppCardHtml(app)).join("");
    bindCardClicks(grid);
    bindCardClicks(featCarousel);
  }

  function renderAppCardHtml(app) {
    const act = getAppActionState(app);
    let btnClass = "install-pill-btn";
    let btnLabel = act.label || "Yükle";
    if (act.type === "open") btnClass += " open";
    else if (act.type === "update") btnClass += " update";
    else if (act.type === "downloading") {
      btnClass += " downloading";
      btnLabel = act.percent >= 0 ? `%${act.percent}` : "İniyor";
    }

    const progressHtml = act.type === "downloading"
      ? `<div class="progress-track"><div class="progress-fill" style="width:${Math.max(5, act.percent || 5)}%;"></div></div>`
      : "";

    return `
      <div class="app-card" data-open-app="${esc(app.id)}">
        <div class="app-card-main">
          ${renderIconHtml(app)}
          <div class="app-card-info">
            <div class="app-title">${esc(app.name)}</div>
            <div class="app-dev">${esc(app.developer)} • ${esc(app.category)}</div>
            <div class="app-meta-row">
              <span class="star-pill">★ ${Number(app.ratingAvg || 0).toFixed(1)}</span>
              <span>• ${esc(app.fileSizeText || "APK")}</span>
              <span>• ${Number(app.downloads || 0)}+ indirme</span>
            </div>
          </div>
          <button class="${btnClass}" data-action-app="${esc(app.id)}" type="button">${esc(btnLabel)}</button>
        </div>
        <div data-card-progress="${esc(app.id)}">${progressHtml}</div>
      </div>
    `;
  }

  function bindCardClicks(container) {
    container.querySelectorAll("[data-open-app]").forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target.closest("[data-action-app]")) return;
        openAppDetail(card.dataset.openApp);
      });
    });
    container.querySelectorAll("[data-action-app]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        handlePrimaryAppAction(btn.dataset.actionApp);
      });
    });
  }

  /* ==================== KİTAPLIK (YÜKLÜLER) ==================== */

  function renderLibrary() {
    $("web-library-notice").classList.toggle("hidden", state.nativeInfo.isNative);

    const activeApps = state.apps.filter(a => a.active !== false);
    const updates = [];
    const installed = [];
    const others = [];

    activeApps.forEach(app => {
      const pkg = getEffectivePkg(app);
      const inst = pkg ? state.installedMap[pkg] : null;
      if (inst && inst.installed) {
        if ((Number(app.versionCode) || 1) > (Number(inst.versionCode) || 0)) updates.push(app);
        else installed.push(app);
      } else {
        others.push(app);
      }
    });

    if ($("updates-heading")) $("updates-heading").textContent = `Güncelleme Mevcut (${updates.length})`;
    if ($("installed-heading")) $("installed-heading").textContent = `Cihazda Yüklü (${installed.length})`;
    if ($("not-installed-heading")) $("not-installed-heading").textContent = `Mağazadaki Diğer Uygulamalar (${others.length})`;

    $("updates-section").classList.toggle("hidden", updates.length === 0);
    $("updates-list").innerHTML = updates.map(renderAppCardHtml).join("");
    bindCardClicks($("updates-list"));

    $("installed-list").innerHTML = installed.length > 0
      ? installed.map(renderAppCardHtml).join("")
      : `<div class="empty-box" style="grid-column:1/-1;">Bu cihazda mağazadan yüklü uygulama tespit edilmedi.</div>`;
    bindCardClicks($("installed-list"));

    $("not-installed-list").innerHTML = others.length > 0
      ? others.map(renderAppCardHtml).join("")
      : `<div class="empty-box" style="grid-column:1/-1;">Tüm mağaza uygulamaları cihazınızda yüklü!</div>`;
    bindCardClicks($("not-installed-list"));
  }

  /* ==================== İNDİRME & KURULUM ==================== */

  async function handlePrimaryAppAction(appId) {
    const app = state.apps.find(a => a.id === appId);
    if (!app) return;

    const act = getAppActionState(app);
    const pkg = getEffectivePkg(app);
    if (act.type === "downloading") {
      window.YmcBridge.cancelDownload(appId);
      delete state.downloads[appId];
      updateProgressUi(appId);
      showToast("İndirme iptal edildi.");
      return;
    }

    if (act.type === "open") {
      const ok = window.YmcBridge.launchApp(pkg);
      if (!ok) showToast("Uygulama başlatılamadı.", "error");
      return;
    }

    if (!app.driveFileId && !app.downloadUrl) {
      showToast("Bu uygulama için Drive dosyası bulunamadı.", "error");
      return;
    }

    const serverMissingPkg = !String(app.packageName || "").trim();
    state.downloads[appId] = { percent: 0, downloaded: 0, total: 0 };
    updateProgressUi(appId);

    try {
      const trackRes = await window.YmcApi.trackDownload(appId);
      app.downloads = trackRes.downloads;
      const dlUrl = trackRes.downloadUrl || app.downloadUrl;
      const dlName = trackRes.fileName || app.fileName || (app.name + ".apk");

      window.YmcBridge.downloadAndInstall(appId, dlUrl, dlName, {
        onProgress: (percent, downloaded, total) => {
          state.downloads[appId] = { percent, downloaded, total };
          updateProgressUi(appId);
        },
        onDone: (dlMeta) => {
          delete state.downloads[appId];
          const detectedPkg = (dlMeta && dlMeta.packageName) ? String(dlMeta.packageName).trim() : "";
          if (detectedPkg) {
            savePkgHint(appId, detectedPkg);
            if (!app.packageName) app.packageName = detectedPkg;
            if (dlMeta.versionName && (!app.versionName || app.versionName === "1.0.0")) {
              app.versionName = dlMeta.versionName;
            }
            if (dlMeta.versionCode && !app.versionCode) {
              app.versionCode = Number(dlMeta.versionCode) || 1;
            }
            if (serverMissingPkg && state.user && state.user.role === "admin" && !window.YmcApi.isDemoMode()) {
              window.YmcApi.saveApp({
                id: app.id,
                name: app.name,
                packageName: detectedPkg,
                versionName: app.versionName,
                versionCode: app.versionCode,
                category: app.category,
                developer: app.developer,
                shortDesc: app.shortDesc,
                description: app.description,
                whatsNew: app.whatsNew,
                driveFileId: app.driveFileId,
                fileName: app.fileName,
                fileSizeText: app.fileSizeText,
                iconUrl: app.iconUrl,
                screenshots: app.screenshots || [],
                featured: app.featured,
                active: app.active
              }).catch(() => {});
            }
          }
          updateProgressUi(appId);
          refreshInstalledStates();
          setTimeout(refreshInstalledStates, 1200);
          setTimeout(refreshInstalledStates, 3000);
          if (state.nativeInfo.isNative) {
            showToast(`${app.name} indirildi! Kurulum penceresi açılıyor...`, "success");
          } else {
            showToast("İndirme tarayıcıda başlatıldı.", "success");
          }
        },
        onCancel: () => {
          delete state.downloads[appId];
          updateProgressUi(appId);
        },
        onError: (err) => {
          delete state.downloads[appId];
          updateProgressUi(appId);
          showToast(err.message || "İndirme hatası.", "error", 4500);
        }
      });
    } catch (err) {
      delete state.downloads[appId];
      updateProgressUi(appId);
      showToast(err.message || "İndirme başlatılamadı.", "error", 4200);
    }
  }

  function updateProgressUi(appId) {
    const app = state.apps.find(a => a.id === appId);
    if (!app) return;
    const act = getAppActionState(app);

    // Kart üzerindeki buton ve ilerleme çubuğu
    document.querySelectorAll(`[data-action-app="${CSS.escape(appId)}"]`).forEach(btn => {
      btn.className = "install-pill-btn";
      if (act.type === "open") {
        btn.classList.add("open");
        btn.textContent = "Aç";
      } else if (act.type === "update") {
        btn.classList.add("update");
        btn.textContent = "Güncelle";
      } else if (act.type === "downloading") {
        btn.classList.add("downloading");
        btn.textContent = act.percent >= 0 ? `%${act.percent}` : "İniyor";
      } else {
        btn.textContent = "Yükle";
      }
    });

    document.querySelectorAll(`[data-card-progress="${CSS.escape(appId)}"]`).forEach(wrap => {
      if (act.type === "downloading") {
        wrap.innerHTML = `<div class="progress-track"><div class="progress-fill" style="width:${Math.max(5, act.percent || 5)}%;"></div></div>`;
      } else {
        wrap.innerHTML = "";
      }
    });

    if (state.openAppId === appId) {
      renderDetailActionArea();
    }
  }

  /* ==================== DETAY SAYFASI & YORUMLAR ==================== */

  function openAppDetail(appId) {
    const app = state.apps.find(a => a.id === appId);
    if (!app) return;

    state.openAppId = appId;
    state.detailRating = 5;
    const effectivePkg = getEffectivePkg(app);
    $("detail-title-bar").textContent = app.name;
    $("detail-ver-badge").textContent = "v" + (app.versionName || "1.0.0");

    const shotsHtml = (app.screenshots && app.screenshots.length > 0)
      ? `<div class="detail-card">
           <h3>Ekran Görüntüleri</h3>
           <div class="screenshots-row">
             ${app.screenshots.map(u => safeUrl(u) ? `<img class="screenshot-thumb" src="${esc(safeUrl(u))}" alt="Ekran görüntüsü" data-lightbox="${esc(safeUrl(u))}" />` : "").join("")}
           </div>
         </div>`
      : "";

    const whatsNewHtml = app.whatsNew
      ? `<div class="detail-card">
           <h3>Yenilikler (v${esc(app.versionName)})</h3>
           <div class="detail-text">${esc(app.whatsNew)}</div>
         </div>`
      : "";

    $("detail-content").innerHTML = `
      <div class="detail-hero">
        ${renderIconHtml(app, true)}
        <div style="min-width:0; flex:1;">
          <div class="detail-title">${esc(app.name)}</div>
          <div class="detail-sub">${esc(app.developer)} • ${esc(app.category)}</div>
          ${effectivePkg ? `<div class="detail-pkg">${esc(effectivePkg)}</div>` : ""}
        </div>
      </div>

      <div class="stats-strip">
        <div class="stat-item">
          <strong id="detail-rating-stat">★ ${Number(app.ratingAvg || 0).toFixed(1)}</strong>
          <span id="detail-rating-count">${Number(app.ratingCount || 0)} değerlendirme</span>
        </div>
        <div class="stat-item">
          <strong>${Number(app.downloads || 0)}+</strong>
          <span>İndirme</span>
        </div>
        <div class="stat-item">
          <strong>${esc(app.fileSizeText || "APK")}</strong>
          <span>Boyut</span>
        </div>
      </div>

      <div id="detail-action-area" style="margin-bottom:18px;"></div>

      ${whatsNewHtml}
      ${shotsHtml}

      <div class="detail-card">
        <h3>Bu Uygulama Hakkında</h3>
        <div class="detail-text">${esc(app.description || app.shortDesc || "Açıklama eklenmemiş.")}</div>
      </div>

      <div class="detail-card">
        <h3>Puan Ver ve Yorum Yap</h3>
        <div id="star-picker" class="star-picker">
          ${[1, 2, 3, 4, 5].map(n => `<button class="star-pick-btn active" data-star="${n}" type="button">★</button>`).join("")}
        </div>
        <textarea id="review-comment-input" class="form-textarea" placeholder="Deneyiminizi paylaşın (isteğe bağlı)..."></textarea>
        <button id="btn-submit-review" class="btn btn-primary btn-sm" type="button" style="margin-top:8px;">Yorumu Gönder</button>
      </div>

      <div class="detail-card">
        <h3>Kullanıcı Yorumları</h3>
        <div id="detail-reviews-list"><div class="empty-box" style="padding:18px 0;">Yükleniyor...</div></div>
      </div>
    `;

    renderDetailActionArea();
    $("detail-view").classList.remove("hidden");
    $("detail-view").scrollTop = 0;

    // Ekran görüntüsü büyütme
    $("detail-content").querySelectorAll("[data-lightbox]").forEach(img => {
      img.addEventListener("click", () => {
        $("lightbox-img").src = img.dataset.lightbox;
        $("lightbox").classList.remove("hidden");
      });
    });

    // Yıldız seçimi
    const stars = $("star-picker").querySelectorAll(".star-pick-btn");
    const updateStars = () => {
      stars.forEach(b => b.classList.toggle("active", Number(b.dataset.star) <= state.detailRating));
    };
    stars.forEach(b => {
      b.addEventListener("click", () => {
        state.detailRating = Number(b.dataset.star);
        updateStars();
      });
    });

    $("btn-submit-review").addEventListener("click", async () => {
      const comment = $("review-comment-input").value.trim();
      const btn = $("btn-submit-review");
      btn.disabled = true;
      try {
        const res = await window.YmcApi.addReview(app.id, state.detailRating, comment);
        app.ratingAvg = res.ratingAvg;
        app.ratingCount = res.ratingCount;
        $("detail-rating-stat").textContent = "★ " + Number(res.ratingAvg || 0).toFixed(1);
        $("detail-rating-count").textContent = `${res.ratingCount || 0} değerlendirme`;
        $("review-comment-input").value = "";
        showToast("Değerlendirmeniz kaydedildi!", "success");
        loadReviews(app.id);
        renderStore();
      } catch (err) {
        showToast(err.message || "Yorum gönderilemedi.", "error");
      } finally {
        btn.disabled = false;
      }
    });

    loadReviews(app.id);
  }

  function renderDetailActionArea() {
    const area = $("detail-action-area");
    if (!area || !state.openAppId) return;
    const app = state.apps.find(a => a.id === state.openAppId);
    if (!app) return;

    const act = getAppActionState(app);
    if (act.type === "downloading") {
      const pct = act.percent >= 0 ? act.percent : 0;
      const dlStr = act.total > 0 ? `${formatBytes(act.downloaded)} / ${formatBytes(act.total)}` : formatBytes(act.downloaded);
      area.innerHTML = `
        <div class="panel-card" style="margin-bottom:0;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.84rem; font-weight:600;">
            <span>İndiriliyor... ${pct >= 0 ? "%" + pct : ""} (${esc(dlStr)})</span>
            <button id="btn-detail-cancel-dl" class="btn btn-danger btn-sm" type="button">İptal</button>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${Math.max(5, pct)}%;"></div></div>
        </div>
      `;
      $("btn-detail-cancel-dl").addEventListener("click", () => handlePrimaryAppAction(app.id));
      return;
    }

    if (act.type === "open" || act.type === "update") {
      const isUpdate = act.type === "update";
      const pkg = getEffectivePkg(app);
      area.innerHTML = `
        <div class="detail-actions" style="margin-bottom:6px;">
          <button id="btn-detail-uninstall" class="btn btn-secondary" type="button" style="flex:1;">Kaldır</button>
          <button id="btn-detail-primary" class="btn ${isUpdate ? "btn-accent" : "btn-primary"}" type="button" style="flex:2;">
            ${isUpdate ? "Güncelle (v" + esc(app.versionName) + ")" : "Uygulamayı Aç"}
          </button>
        </div>
        <div style="text-align:center;">
          <button id="btn-detail-reinstall" class="link-btn" type="button">APK'yı yeniden indir</button>
        </div>
      `;
      $("btn-detail-uninstall").addEventListener("click", () => {
        if (pkg) window.YmcBridge.uninstallApp(pkg);
      });
      $("btn-detail-primary").addEventListener("click", () => handlePrimaryAppAction(app.id));
      $("btn-detail-reinstall").addEventListener("click", () => {
        // Zorla yeniden indir
        if (pkg) state.installedMap[pkg] = { installed: false };
        handlePrimaryAppAction(app.id);
      });
      return;
    }

    area.innerHTML = `
      <button id="btn-detail-primary" class="btn btn-primary w-full" type="button">
        ⬇️ İndir ve Yükle (${esc(app.fileSizeText || "APK")})
      </button>
    `;
    $("btn-detail-primary").addEventListener("click", () => handlePrimaryAppAction(app.id));
  }

  async function loadReviews(appId) {
    const box = $("detail-reviews-list");
    try {
      const res = await window.YmcApi.getReviews(appId);
      const list = res.reviews || [];
      if (list.length === 0) {
        box.innerHTML = `<div class="empty-box" style="padding:14px 0;">Henüz yorum yapılmamış. İlk yorumu siz yazın!</div>`;
        return;
      }
      box.innerHTML = list.map(r => `
        <div class="review-item">
          <div class="review-head">
            <div class="review-author">
              <div class="avatar-chip" style="width:28px; height:28px; font-size:0.72rem;">
                ${safeUrl(r.userPhoto) ? `<img src="${esc(safeUrl(r.userPhoto))}" alt="" />` : esc(getInitials(r.userName))}
              </div>
              <span>${esc(r.userName)}</span>
            </div>
            <span class="review-date">${formatDate(r.createdAt)}</span>
          </div>
          <div class="star-pill" style="font-size:0.82rem; margin-bottom:3px;">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</div>
          ${r.comment ? `<div style="font-size:0.86rem; color:var(--text);">${esc(r.comment)}</div>` : ""}
        </div>
      `).join("");
    } catch (err) {
      box.innerHTML = `<div class="empty-box" style="padding:14px 0;">Yorumlar yüklenemedi.</div>`;
    }
  }

  function closeDetailView() {
    state.openAppId = null;
    $("detail-view").classList.add("hidden");
  }

  /* ==================== YÖNETİCİ PANELİ ==================== */

  function renderAdminStats() {
    $("stat-total-apps").textContent = state.apps.length;
    const totalDl = state.apps.reduce((s, a) => s + (Number(a.downloads) || 0), 0);
    $("stat-total-downloads").textContent = totalDl;
  }

  function switchAdminTab(name) {
    state.adminTab = name;
    document.querySelectorAll("[data-admin-tab]").forEach(b => {
      b.classList.toggle("active", b.dataset.adminTab === name);
    });
    document.querySelectorAll(".admin-subpane").forEach(p => p.classList.add("hidden"));
    $("admin-sub-" + name).classList.remove("hidden");

    if (name === "manage") renderAdminManageList();
    if (name === "users") loadAdminUsers();
  }

  function resetAppForm() {
    $("admin-form-title").textContent = "Yeni Uygulama Ekle / APK Yükle";
    $("app-edit-id").value = "";
    $("app-drive-id").value = "";
    $("app-file-size").value = "";
    $("app-file-name").value = "";
    $("app-name").value = "";
    $("app-pkg").value = "";
    $("app-ver-name").value = "1.0.0";
    $("app-ver-code").value = "1";
    $("app-category").value = "Araçlar";
    $("app-developer").value = "Erhan Yamaç";
    $("app-short-desc").value = "";
    $("app-description").value = "";
    $("app-whats-new").value = "";
    $("app-icon-url").value = "";
    $("app-featured").checked = false;
    $("app-active").checked = true;
    $("picked-apk-summary").classList.add("hidden");
    $("upload-progress-wrap").classList.add("hidden");
    state.editScreenshots = [];
    renderFormIconPreview();
    renderFormScreenshotsPreview();
  }

  function populateAppForm(app, bumpVersion = false) {
    switchAdminTab("publish");
    $("admin-form-title").textContent = bumpVersion ? `Yeni Sürüm: ${app.name}` : `Düzenle: ${app.name}`;
    $("app-edit-id").value = app.id || "";
    $("app-drive-id").value = bumpVersion ? "" : (app.driveFileId || "");
    $("app-file-size").value = bumpVersion ? "" : (app.fileSizeText || "");
    $("app-file-name").value = app.fileName || "";
    $("app-name").value = app.name || "";
    $("app-pkg").value = app.packageName || "";
    $("app-ver-name").value = app.versionName || "1.0.0";
    $("app-ver-code").value = bumpVersion ? (Number(app.versionCode || 1) + 1) : (app.versionCode || 1);
    $("app-category").value = CATEGORIES.includes(app.category) ? app.category : "Araçlar";
    $("app-developer").value = app.developer || "Erhan Yamaç";
    $("app-short-desc").value = app.shortDesc || "";
    $("app-description").value = app.description || "";
    $("app-whats-new").value = app.whatsNew || "";
    $("app-icon-url").value = app.iconUrl || "";
    $("app-featured").checked = Boolean(app.featured);
    $("app-active").checked = app.active !== false;
    state.editScreenshots = Array.isArray(app.screenshots) ? [...app.screenshots] : [];
    renderFormIconPreview();
    renderFormScreenshotsPreview();
  }

  function renderFormIconPreview() {
    const url = safeUrl($("app-icon-url").value);
    const name = $("app-name").value || "YM";
    const box = $("app-icon-preview");
    box.style.background = getGradientForText(name);
    box.innerHTML = url
      ? `<img src="${esc(url)}" alt="" onerror="this.remove();" />`
      : esc(getInitials(name));
  }

  function renderFormScreenshotsPreview() {
    const wrap = $("app-screenshots-preview");
    wrap.innerHTML = state.editScreenshots.map((url, idx) => `
      <div class="thumb-edit-item">
        <img src="${esc(safeUrl(url))}" alt="" />
        <button class="thumb-remove-btn" data-rm-shot="${idx}" type="button">&times;</button>
      </div>
    `).join("");

    wrap.querySelectorAll("[data-rm-shot]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.editScreenshots.splice(Number(btn.dataset.rmShot), 1);
        renderFormScreenshotsPreview();
      });
    });
  }

  async function processPickedApkInfo(info) {
    if (!info) return;

    const lines = [
      `Seçildi: ${info.fileName} (${formatBytes(info.sizeBytes)})`,
      `Paket: ${info.packageName || "-"} | Sürüm: ${info.versionName} (${info.versionCode})`
    ];
    if (info.isSplit) {
      lines.push("⚠️ Not: Bu uygulama Split APK (çok parçalı). Yalnızca ana base.apk yüklenecektir.");
    }
    $("picked-apk-summary").classList.remove("hidden");
    $("picked-apk-summary").textContent = lines.join("\n");

    $("app-file-name").value = info.fileName || "";
    $("app-file-size").value = formatBytes(info.sizeBytes);
    if (info.packageName) $("app-pkg").value = info.packageName;
    if (info.versionName) $("app-ver-name").value = info.versionName;
    if (info.versionCode) $("app-ver-code").value = info.versionCode;
    if (!$("app-name").value.trim()) {
      $("app-name").value = info.appLabel || (info.fileName || "").replace(/\.apk$/i, "");
    }

    if (info.iconDataUrl && !$("app-icon-url").value.trim()) {
      const box = $("app-icon-preview");
      if (box) {
        box.style.background = getGradientForText($("app-name").value || "YM");
        box.innerHTML = `<img src="${esc(safeUrl(info.iconDataUrl))}" alt="" onerror="this.remove();" />`;
      }
    } else {
      renderFormIconPreview();
    }

    if (window.YmcApi.isDemoMode()) {
      $("app-drive-id").value = "DEMO_UPLOAD_" + Date.now();
      showToast("Demo modunda APK bilgileri okundu.", "success");
      return;
    }

    state.isUploadingApk = true;
    $("upload-progress-wrap").classList.remove("hidden");
    $("upload-progress-bar").style.width = "5%";
    $("upload-progress-text").textContent = "Drive oturumu hazırlanıyor...";

    try {
      const sessRes = await window.YmcApi.createUploadSession(
        info.fileName,
        "application/vnd.android.package-archive",
        info.sizeBytes
      );

      const uploadRes = await window.YmcBridge.uploadLocalApkToUrl(
        "apk_" + Date.now(),
        sessRes.uploadUrl,
        info.localPath,
        {
          onProgress: (pct) => {
            $("upload-progress-bar").style.width = Math.max(5, pct) + "%";
            $("upload-progress-text").textContent = `%${pct}`;
          }
        }
      );

      const fileId = uploadRes.id;
      if (!fileId) throw new Error("Drive dosya ID döndürmedi.");

      await window.YmcApi.finalizeDriveFile(fileId);
      $("app-drive-id").value = fileId;

      if (info.iconDataUrl && !$("app-icon-url").value.trim()) {
        $("upload-progress-bar").style.width = "100%";
        $("upload-progress-text").textContent = "%100 (Uygulama ikonu Drive'a aktarılıyor...)";
        try {
          const iconRes = await window.YmcApi.uploadSmallFile(
            "icon_" + Date.now() + ".png",
            "image/png",
            info.iconDataUrl
          );
          if (iconRes && iconRes.imageUrl) {
            $("app-icon-url").value = iconRes.imageUrl;
            renderFormIconPreview();
          }
        } catch (iconErr) {
          // İkon yüklenemese dahi APK yüklemesini kesme
        }
      }

      $("upload-progress-bar").style.width = "100%";
      $("upload-progress-text").textContent = "%100 (Drive'a Yüklendi)";
      showToast("APK Google Drive'a yüklendi! Şimdi bilgileri kontrol edip yayınlayın.", "success", 4200);
    } catch (err) {
      $("upload-progress-wrap").classList.add("hidden");
      throw err;
    } finally {
      state.isUploadingApk = false;
    }
  }

  async function handlePickAndUploadApk() {
    if (state.isUploadingApk) {
      showToast("Devam eden bir APK yüklemesi var.", "warning");
      return;
    }

    if (!window.YmcBridge.isNative()) {
      $("web-apk-input").click();
      return;
    }

    try {
      const info = await window.YmcBridge.pickApkNative();
      await processPickedApkInfo(info);
    } catch (err) {
      if (err.message !== "CANCELLED") {
        showToast(err.message || "APK yüklenemedi.", "error", 4500);
      }
      $("upload-progress-wrap").classList.add("hidden");
    }
  }

  function openInstalledAppPicker() {
    if (state.isUploadingApk) {
      showToast("Devam eden bir APK yüklemesi var.", "warning");
      return;
    }
    if (!window.YmcBridge.isNative()) {
      showToast("Cihazdaki yüklü uygulamaları seçme özelliği Android uygulaması içinde aktiftir.", "warning", 3800);
      return;
    }

    const apps = window.YmcBridge.listInstalledUserApps();
    state.installedPickerApps = Array.isArray(apps) ? apps : [];
    $("installed-picker-search").value = "";
    renderInstalledPickerList();
    $("installed-picker-modal").classList.remove("hidden");
  }

  function renderInstalledPickerList() {
    const box = $("installed-picker-list");
    if (!box) return;
    const q = ($("installed-picker-search").value || "").trim().toLowerCase();
    const list = state.installedPickerApps.filter(item => {
      if (!q) return true;
      return String(item.appName || "").toLowerCase().includes(q)
        || String(item.packageName || "").toLowerCase().includes(q);
    });

    if (list.length === 0) {
      box.innerHTML = `<div class="empty-box" style="padding:24px 12px;">
        ${state.installedPickerApps.length === 0 ? "Cihazda seçilebilir kullanıcı uygulaması bulunamadı." : "Aramanızla eşleşen uygulama yok."}
      </div>`;
      return;
    }

    box.innerHTML = list.map(item => `
      <button class="picker-app-row" data-pick-pkg="${esc(item.packageName)}" type="button">
        <div class="app-icon" style="width:44px; height:44px; border-radius:12px; font-size:0.95rem; background:${getGradientForText(item.appName)};">
          ${esc(getInitials(item.appName))}
        </div>
        <div style="min-width:0; flex:1;">
          <div style="font-weight:700; font-size:0.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${esc(item.appName)}
          </div>
          <div style="font-size:0.74rem; color:var(--text-muted); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${esc(item.packageName)}
          </div>
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:3px; font-size:0.74rem; color:var(--text-muted);">
            <span>v${esc(item.versionName || "1.0")} (${Number(item.versionCode) || 1})</span>
            <span>• ${esc(formatBytes(item.sizeBytes))}</span>
            ${item.isSplit ? '<span class="badge badge-amber" style="font-size:0.65rem; padding:1px 6px;">Split APK</span>' : ""}
          </div>
        </div>
        <span style="font-size:0.82rem; font-weight:700; color:var(--primary); flex-shrink:0;">Seç &rarr;</span>
      </button>
    `).join("");

    box.querySelectorAll("[data-pick-pkg]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const pkg = btn.dataset.pickPkg;
        if (!pkg) return;
        $("installed-picker-modal").classList.add("hidden");
        showToast("Uygulama APK'sı hazırlanıyor...", "info", 2200);
        try {
          const info = await window.YmcBridge.stageInstalledApp(pkg);
          await processPickedApkInfo(info);
        } catch (err) {
          if (err.message !== "CANCELLED") {
            showToast(err.message || "Uygulama APK'sı alınamadı.", "error", 4500);
          }
        }
      });
    });
  }

  async function handleWebApkFile(file) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      showToast("Tarayıcıdan 25 MB üzeri yüklenemez. Android uygulamasından seçin veya doğrudan Drive klasörüne atıp Tara'ya basın.", "warning", 5500);
      return;
    }
    state.isUploadingApk = true;
    $("upload-progress-wrap").classList.remove("hidden");
    $("upload-progress-bar").style.width = "40%";
    $("upload-progress-text").textContent = "Yükleniyor...";

    try {
      const base64 = await readFileAsDataUrl(file);
      const res = await window.YmcApi.uploadSmallFile(file.name, "application/vnd.android.package-archive", base64);
      $("app-drive-id").value = res.fileId;
      $("app-file-name").value = res.name;
      $("app-file-size").value = res.sizeText;
      if (!$("app-name").value.trim()) $("app-name").value = file.name.replace(/\.apk$/i, "");
      $("upload-progress-bar").style.width = "100%";
      $("upload-progress-text").textContent = "%100 (Yüklendi)";
      showToast("APK Drive'a yüklendi!", "success");
    } catch (err) {
      showToast(err.message || "Yükleme hatası.", "error");
      $("upload-progress-wrap").classList.add("hidden");
    } finally {
      state.isUploadingApk = false;
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Dosya okunamadı."));
      reader.readAsDataURL(file);
    });
  }

  function resizeImageToDataUrl(file, maxDim, mimeType = "image/jpeg", quality = 0.85) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objUrl);
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL(mimeType, quality));
      };
      img.onerror = () => {
        URL.revokeObjectURL(objUrl);
        reject(new Error("Görsel işlenemedi."));
      };
      img.src = objUrl;
    });
  }

  async function scanDriveFolder() {
    const box = $("drive-files-list");
    box.innerHTML = `<div class="empty-box">Google Drive taranıyor...</div>`;
    try {
      const res = await window.YmcApi.listDriveFiles();
      const files = res.files || [];
      if (files.length === 0) {
        box.innerHTML = `<div class="empty-box">YMC Store Drive klasöründe henüz .apk dosyası yok.</div>`;
        return;
      }
      box.innerHTML = files.map(f => `
        <div class="list-row">
          <div style="min-width:0; flex:1;">
            <div style="font-weight:700; font-size:0.9rem; word-break:break-all;">${esc(f.name)}</div>
            <div style="font-size:0.78rem; color:var(--text-muted);">${esc(f.sizeText)} • ${formatDate(f.updatedAt)}</div>
            <div style="margin-top:4px;">
              ${f.alreadyInCatalog
                ? '<span class="badge badge-green">Katalogda Mevcut</span>'
                : '<span class="badge badge-amber">Yeni APK</span>'}
            </div>
          </div>
          <button class="btn btn-primary btn-sm" data-import-drive="${esc(f.id)}" data-import-name="${esc(f.name)}" data-import-size="${esc(f.sizeText)}" type="button">
            Forma Aktar
          </button>
        </div>
      `).join("");

      box.querySelectorAll("[data-import-drive]").forEach(btn => {
        btn.addEventListener("click", () => {
          resetAppForm();
          $("app-drive-id").value = btn.dataset.importDrive;
          $("app-file-name").value = btn.dataset.importName;
          $("app-file-size").value = btn.dataset.importSize;
          $("app-name").value = btn.dataset.importName.replace(/\.apk$/i, "").replace(/[_-]+/g, " ");
          renderFormIconPreview();
          switchAdminTab("publish");
          showToast("Drive dosyası forma aktarıldı, detayları tamamlayıp yayınlayın.", "success");
        });
      });
    } catch (err) {
      box.innerHTML = `<div class="empty-box">${esc(err.message)}</div>`;
    }
  }

  function renderAdminManageList() {
    const box = $("admin-apps-list");
    if (!box) return;
    if (state.apps.length === 0) {
      box.innerHTML = `<div class="empty-box">Henüz kayıtlı uygulama yok.</div>`;
      return;
    }
    box.innerHTML = state.apps.map(app => `
      <div class="list-row" style="flex-direction:column; align-items:stretch;">
        <div style="display:flex; align-items:center; gap:10px;">
          ${renderIconHtml(app)}
          <div style="min-width:0; flex:1;">
            <div class="app-title">${esc(app.name)}</div>
            <div class="app-dev">v${esc(app.versionName)} (${app.versionCode}) • ${Number(app.downloads || 0)} indirme</div>
            <div style="margin-top:4px; display:flex; gap:5px;">
              ${app.active !== false ? '<span class="badge badge-green">Yayında</span>' : '<span class="badge badge-red">Gizli</span>'}
              ${app.featured ? '<span class="badge badge-blue">Öne Çıkan</span>' : ''}
            </div>
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">
          <button class="btn btn-secondary btn-sm" data-adm-edit="${esc(app.id)}" type="button">✏️ Düzenle</button>
          <button class="btn btn-accent btn-sm" data-adm-bump="${esc(app.id)}" type="button">⬆️ Yeni Sürüm</button>
          <button class="btn btn-danger btn-sm" data-adm-del="${esc(app.id)}" type="button">🗑️ Sil</button>
        </div>
      </div>
    `).join("");

    box.querySelectorAll("[data-adm-edit]").forEach(b => {
      b.addEventListener("click", () => {
        const app = state.apps.find(a => a.id === b.dataset.admEdit);
        if (app) populateAppForm(app, false);
      });
    });

    box.querySelectorAll("[data-adm-bump]").forEach(b => {
      b.addEventListener("click", () => {
        const app = state.apps.find(a => a.id === b.dataset.admBump);
        if (app) {
          populateAppForm(app, true);
          showToast("Yeni APK dosyasını seçip yükleyin, sürüm kodu otomatik 1 artırıldı.", "info", 4000);
        }
      });
    });

    box.querySelectorAll("[data-adm-del]").forEach(b => {
      b.addEventListener("click", async () => {
        const app = state.apps.find(a => a.id === b.dataset.admDel);
        if (!app) return;
        if (!confirm(`"${app.name}" mağaza kataloğundan silinsin mi?`)) return;
        const delDrive = confirm("İlişkili APK dosyası da Google Drive'da çöp kutusuna taşınsın mı?\n(Tamam = Drive'dan da sil, İptal = Sadece katalogdan kaldır)");
        try {
          await window.YmcApi.deleteApp(app.id, delDrive);
          showToast("Uygulama silindi.", "success");
          await loadCatalog();
        } catch (err) {
          showToast(err.message || "Silinemedi.", "error");
        }
      });
    });
  }

  async function loadAdminUsers() {
    const box = $("admin-users-list");
    box.innerHTML = `<div class="empty-box">Üyeler yükleniyor...</div>`;
    try {
      const res = await window.YmcApi.listUsers();
      const users = res.users || [];
      if (users.length === 0) {
        box.innerHTML = `<div class="empty-box">Kayıtlı üye bulunmuyor.</div>`;
        return;
      }
      box.innerHTML = users.map(u => `
        <div class="list-row">
          <div style="min-width:0; flex:1;">
            <div style="font-weight:700; font-size:0.88rem;">${esc(u.displayName || u.email)}</div>
            <div style="font-size:0.78rem; color:var(--text-muted); word-break:break-all;">${esc(u.email)}</div>
            <div style="font-size:0.72rem; color:var(--text-muted); margin-top:2px;">Son giriş: ${formatDate(u.lastLoginAt)}</div>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
            <span class="badge ${u.provider === "google" ? "badge-blue" : "badge-green"}">${u.provider === "google" ? "Google" : "Üye"}</span>
            ${u.role === "admin" ? '<span class="badge badge-amber">Admin</span>' : ''}
          </div>
        </div>
      `).join("");
    } catch (err) {
      box.innerHTML = `<div class="empty-box">${esc(err.message)}</div>`;
    }
  }

  /* ==================== PROFİL & KURULUM ==================== */

  function renderProfileDeviceInfo() {
    const ni = window.YmcBridge.getNativeInfo();
    state.nativeInfo = ni;
    const permGranted = window.YmcBridge.canInstallPackages();

    $("device-info-box").innerHTML = ni.isNative
      ? `Paket: <b>${esc(ni.packageName)}</b> • Sürüm: <b>v${esc(ni.versionName)}</b><br/>Bilinmeyen Uygulama İzni: <b>${permGranted ? "Açık ✅" : "Kapalı ⚠️"}</b>`
      : `Tarayıcı Modu • Android APK içinden kurulum ve otomatik güncelleme takibi aktiftir.`;

    $("btn-grant-install-perm").classList.toggle("hidden", !ni.isNative || permGranted);

    const isAdmin = state.user && state.user.role === "admin";
    const showSha1 = Boolean(ni.isNative && ni.sha1 && isAdmin);
    $("sha1-wrap").classList.toggle("hidden", !showSha1);
    if (showSha1) $("sha1-box").textContent = ni.sha1;
  }

  function openSetupModal() {
    const cfg = window.YmcConfig.get();
    $("setup-script-url").value = cfg.APPS_SCRIPT_URL || "";
    $("setup-client-id").value = cfg.GOOGLE_WEB_CLIENT_ID || "";
    $("setup-test-result").classList.add("hidden");

    const ni = window.YmcBridge.getNativeInfo();
    if (ni.isNative && ni.sha1) {
      $("setup-android-meta").classList.remove("hidden");
      $("setup-pkg-display").textContent = ni.packageName;
      $("setup-sha1-display").textContent = "SHA-1: " + ni.sha1;
    } else {
      $("setup-android-meta").classList.add("hidden");
    }

    $("setup-modal").classList.remove("hidden");
  }

  function switchTab(tabName) {
    state.currentTab = tabName;
    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
    document.querySelectorAll(".tab-pane").forEach(p => p.classList.add("hidden"));
    $("pane-" + tabName).classList.remove("hidden");

    if (tabName === "library") refreshInstalledStates();
    if (tabName === "profile") renderProfileDeviceInfo();
    if (tabName === "admin") {
      renderAdminStats();
      renderAdminManageList();
    }
  }

  /* ==================== OLAY BAĞLANTILARI ==================== */

  function bindEvents() {
    // Hardware Back Button desteği
    window.__handleAndroidBack = () => {
      if (!$("lightbox").classList.contains("hidden")) {
        $("lightbox").classList.add("hidden");
        return true;
      }
      if (!$("installed-picker-modal").classList.contains("hidden")) {
        $("installed-picker-modal").classList.add("hidden");
        return true;
      }
      if (!$("setup-modal").classList.contains("hidden")) {
        $("setup-modal").classList.add("hidden");
        return true;
      }
      if (!$("detail-view").classList.contains("hidden")) {
        closeDetailView();
        return true;
      }
      if (state.user && state.currentTab !== "store") {
        switchTab("store");
        return true;
      }
      return false;
    };

    // Auth Sekme Değişimi
    $("tab-btn-login").addEventListener("click", () => {
      state.authMode = "login";
      $("tab-btn-login").classList.add("active");
      $("tab-btn-register").classList.remove("active");
      $("auth-name-group").classList.add("hidden");
      $("auth-password").setAttribute("autocomplete", "current-password");
      $("btn-auth-submit").textContent = "Giriş Yap";
    });

    $("tab-btn-register").addEventListener("click", () => {
      state.authMode = "register";
      $("tab-btn-register").classList.add("active");
      $("tab-btn-login").classList.remove("active");
      $("auth-name-group").classList.remove("hidden");
      $("auth-password").setAttribute("autocomplete", "new-password");
      $("btn-auth-submit").textContent = "Üye Ol ve Bağlan";
    });

    $("btn-toggle-pass").addEventListener("click", () => {
      const inp = $("auth-password");
      inp.type = inp.type === "password" ? "text" : "password";
    });

    // E-posta ile Giriş / Kayıt
    $("auth-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!window.YmcConfig.isConfigured()) {
        showToast("Önce Apps Script Web URL'sini kurulumdan kaydedin veya Demo'yu deneyin.", "warning", 4000);
        openSetupModal();
        return;
      }
      const btn = $("btn-auth-submit");
      const email = $("auth-email").value.trim();
      const password = $("auth-password").value;
      const displayName = $("auth-name").value.trim();

      btn.disabled = true;
      try {
        if (state.authMode === "register") {
          const res = await window.YmcApi.register({ displayName, email, password });
          state.user = res.user;
          showToast("Üyelik oluşturuldu, hoş geldiniz!", "success");
        } else {
          const res = await window.YmcApi.login({ email, password });
          state.user = res.user;
          showToast("Giriş başarılı!", "success");
        }
        enterStore();
      } catch (err) {
        showToast(err.message || "Oturum açılamadı.", "error", 4000);
      } finally {
        btn.disabled = false;
      }
    });

    // Google ile Giriş
    $("btn-google-login").addEventListener("click", async () => {
      if (!window.YmcConfig.isConfigured()) {
        showToast("Önce Apps Script URL ve Google Web Client ID ayarlanmalıdır.", "warning", 4000);
        openSetupModal();
        return;
      }
      const cfg = window.YmcConfig.get();
      const btn = $("btn-google-login");
      btn.disabled = true;
      try {
        const idToken = await window.YmcBridge.signInWithGoogle(cfg.GOOGLE_WEB_CLIENT_ID);
        const res = await window.YmcApi.googleAuth(idToken);
        state.user = res.user;
        showToast(`Hoş geldin, ${res.user.displayName}!`, "success");
        enterStore();
      } catch (err) {
        if (err.message !== "CANCELLED") {
          showToast(err.message || "Google ile giriş başarısız.", "error", 4800);
        }
      } finally {
        btn.disabled = false;
      }
    });

    // Kurulum & Demo
    $("setup-banner").addEventListener("click", openSetupModal);
    $("btn-open-setup").addEventListener("click", openSetupModal);
    $("btn-profile-setup").addEventListener("click", openSetupModal);
    $("btn-close-setup").addEventListener("click", () => $("setup-modal").classList.add("hidden"));

    $("btn-demo-mode").addEventListener("click", () => {
      const res = window.YmcApi.enableDemoSession();
      state.user = res.user;
      showToast("Demo Önizleme açıldı.", "info");
      enterStore();
    });

    $("btn-copy-setup-sha1").addEventListener("click", () => {
      const sha1 = window.YmcBridge.getNativeInfo().sha1;
      if (sha1 && navigator.clipboard) {
        navigator.clipboard.writeText(sha1);
        showToast("SHA-1 kopyalandı!", "success");
      }
    });

    $("btn-copy-sha1").addEventListener("click", () => {
      const sha1 = window.YmcBridge.getNativeInfo().sha1;
      if (sha1 && navigator.clipboard) {
        navigator.clipboard.writeText(sha1);
        showToast("SHA-1 kopyalandı!", "success");
      }
    });

    $("btn-test-setup").addEventListener("click", async () => {
      const urlVal = $("setup-script-url").value.trim();
      const box = $("setup-test-result");
      box.classList.remove("hidden");
      box.textContent = "Bağlantı test ediliyor...";
      try {
        const res = await window.YmcApi.pingCustomUrl(urlVal);
        box.textContent = `✅ Bağlantı Başarılı!\nMağaza: ${res.storeName}\nKlasör ID: ${res.folderId}`;
      } catch (err) {
        box.textContent = `❌ Hata: ${err.message}`;
      }
    });

    $("btn-save-setup").addEventListener("click", () => {
      const urlVal = $("setup-script-url").value.trim();
      const clientVal = $("setup-client-id").value.trim();
      if (urlVal && !urlVal.startsWith("https://script.google.com/")) {
        showToast("Geçerli bir Google Apps Script URL'si girin.", "error");
        return;
      }
      window.YmcConfig.saveOverride(urlVal, clientVal);
      updateSetupBanner();
      $("setup-modal").classList.add("hidden");
      showToast("Bağlantı ayarları kaydedildi!", "success");
    });

    // Alt Gezinti & Üst Bar
    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    $("topbar-avatar").addEventListener("click", () => switchTab("profile"));
    $("btn-refresh-store").addEventListener("click", () => {
      loadCatalog();
      showToast("Mağaza güncelleniyor...");
    });
    if ($("btn-refresh-library")) {
      $("btn-refresh-library").addEventListener("click", async () => {
        showToast("Cihazdaki uygulamalar kontrol ediliyor...");
        await loadCatalog();
        refreshInstalledStates();
      });
    }

    $("search-input").addEventListener("input", (e) => {
      state.searchQuery = e.target.value.trim();
      $("btn-clear-search").classList.toggle("hidden", !state.searchQuery);
      if (state.currentTab !== "store") switchTab("store");
      renderStore();
    });

    $("btn-clear-search").addEventListener("click", () => {
      $("search-input").value = "";
      state.searchQuery = "";
      $("btn-clear-search").classList.add("hidden");
      renderStore();
    });

    $("sort-select").addEventListener("change", (e) => {
      state.sortBy = e.target.value;
      renderStore();
    });

    // Tema Değiştirme
    $("btn-theme-toggle").addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      applyTheme(cur === "dark" ? "light" : "dark");
    });
    $("btn-theme-dark").addEventListener("click", () => applyTheme("dark"));
    $("btn-theme-light").addEventListener("click", () => applyTheme("light"));

    // Detay & Lightbox
    $("btn-detail-back").addEventListener("click", closeDetailView);
    $("lightbox").addEventListener("click", () => $("lightbox").classList.add("hidden"));

    // Profil & İzin
    $("btn-grant-install-perm").addEventListener("click", () => window.YmcBridge.openInstallPermissionSettings());
    $("btn-logout").addEventListener("click", () => logout(false));

    // Yönetici Alt Sekmeleri & Form
    document.querySelectorAll("[data-admin-tab]").forEach(btn => {
      btn.addEventListener("click", () => switchAdminTab(btn.dataset.adminTab));
    });

    $("btn-pick-apk").addEventListener("click", handlePickAndUploadApk);
    if ($("btn-pick-installed-app")) {
      $("btn-pick-installed-app").addEventListener("click", openInstalledAppPicker);
    }
    if ($("btn-close-installed-picker")) {
      $("btn-close-installed-picker").addEventListener("click", () => {
        $("installed-picker-modal").classList.add("hidden");
      });
    }
    if ($("installed-picker-modal")) {
      $("installed-picker-modal").addEventListener("click", (e) => {
        if (e.target === $("installed-picker-modal")) {
          $("installed-picker-modal").classList.add("hidden");
        }
      });
    }
    if ($("installed-picker-search")) {
      $("installed-picker-search").addEventListener("input", renderInstalledPickerList);
    }
    $("web-apk-input").addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) handleWebApkFile(e.target.files[0]);
      e.target.value = "";
    });

    $("app-name").addEventListener("input", renderFormIconPreview);
    $("app-icon-url").addEventListener("input", renderFormIconPreview);

    $("icon-file-input").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        showToast("İkon Google Drive'a yükleniyor...");
        const dataUrl = await resizeImageToDataUrl(file, 256, "image/png", 0.92);
        const res = await window.YmcApi.uploadSmallFile("icon_" + Date.now() + ".png", "image/png", dataUrl);
        $("app-icon-url").value = res.imageUrl;
        renderFormIconPreview();
        showToast("İkon yüklendi!", "success");
      } catch (err) {
        showToast(err.message || "İkon yüklenemedi.", "error");
      }
    });

    $("screenshots-file-input").addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = "";
      if (!files.length) return;
      for (const f of files) {
        try {
          showToast(`Ekran görüntüsü yükleniyor (${f.name})...`);
          const dataUrl = await resizeImageToDataUrl(f, 1080, "image/jpeg", 0.84);
          const res = await window.YmcApi.uploadSmallFile("shot_" + Date.now() + ".jpg", "image/jpeg", dataUrl);
          state.editScreenshots.push(res.imageUrl);
          renderFormScreenshotsPreview();
        } catch (err) {
          showToast(err.message || "Görsel yüklenemedi.", "error");
        }
      }
      showToast("Ekran görüntüleri eklendi!", "success");
    });

    $("btn-reset-app-form").addEventListener("click", resetAppForm);

    $("btn-save-app").addEventListener("click", async () => {
      if (state.isUploadingApk) {
        showToast("APK yüklemesi bitene kadar bekleyin.", "warning");
        return;
      }
      const name = $("app-name").value.trim();
      const driveFileId = $("app-drive-id").value.trim();
      if (!name || !driveFileId) {
        showToast("Uygulama Adı ve Drive Dosya ID zorunludur.", "error");
        return;
      }

      const btn = $("btn-save-app");
      btn.disabled = true;
      try {
        await window.YmcApi.saveApp({
          id: $("app-edit-id").value.trim() || undefined,
          name,
          packageName: $("app-pkg").value.trim(),
          versionName: $("app-ver-name").value.trim() || "1.0.0",
          versionCode: Number($("app-ver-code").value) || 1,
          category: $("app-category").value,
          developer: $("app-developer").value.trim() || "Erhan Yamaç",
          shortDesc: $("app-short-desc").value.trim(),
          description: $("app-description").value.trim(),
          whatsNew: $("app-whats-new").value.trim(),
          driveFileId,
          fileName: $("app-file-name").value.trim() || (name + ".apk"),
          fileSizeText: $("app-file-size").value.trim(),
          iconUrl: $("app-icon-url").value.trim(),
          screenshots: state.editScreenshots,
          featured: $("app-featured").checked,
          active: $("app-active").checked
        });
        showToast("Uygulama başarıyla yayınlandı!", "success");
        resetAppForm();
        await loadCatalog();
        switchAdminTab("manage");
      } catch (err) {
        showToast(err.message || "Kaydedilemedi.", "error");
      } finally {
        btn.disabled = false;
      }
    });

    $("btn-scan-drive").addEventListener("click", scanDriveFolder);
    $("btn-load-users").addEventListener("click", loadAdminUsers);

    $("btn-save-settings").addEventListener("click", async () => {
      try {
        await window.YmcApi.saveSettings({
          storeName: $("set-store-name").value.trim(),
          storeSubtitle: $("set-store-subtitle").value.trim(),
          announcement: $("set-announcement").value.trim(),
          adminEmails: $("set-admin-emails").value.trim()
        });
        showToast("Mağaza ayarları güncellendi!", "success");
        loadCatalog();
      } catch (err) {
        showToast(err.message || "Ayarlar kaydedilemedi.", "error");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
