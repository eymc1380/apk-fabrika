/**
 * YMC Store - Google Apps Script Arka Ucu (Backend)
 * -------------------------------------------------
 * Google Drive Klasör ID ve Google Sheets Veritabanı ID otomatik tanımlıdır.
 * Dağıtım (Deploy): Web Uygulaması -> "Ben (Me)" olarak çalıştır -> Erişim: "Herkes (Anyone)"
 */

const CONFIG = {
  DRIVE_FOLDER_ID: "1D2uUQD2dQOCjuQMrpCvprfyiKJTolzTe",
  SPREADSHEET_ID: "1XbpgH2AqGqR1PNpS92AtlcgEqsa4oMUKPi9kZyMcxYc",
  // İsteğe bağlı: Google Cloud Console'dan aldığınız Web Client ID'yi buraya girerseniz token izleyici (aud) doğrulaması sıkılaştırılır.
  GOOGLE_WEB_CLIENT_ID: "",
  DEFAULT_ADMIN_EMAIL: "ymcerh@gmail.com",
  TOKEN_TTL_MS: 30 * 24 * 60 * 60 * 1000 // 30 gün
};

const SHEETS = {
  APPS: "Apps",
  USERS: "Users",
  REVIEWS: "Reviews",
  SETTINGS: "Settings"
};

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || "ping";
    const result = handleRequest(action, params);
    return jsonOutput(result);
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message || String(err) });
  }
}

function doPost(e) {
  try {
    let body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    const action = body.action || ((e && e.parameter && e.parameter.action) || "");
    const result = handleRequest(action, body);
    return jsonOutput(result);
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message || String(err) });
  }
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleRequest(action, payload) {
  switch (action) {
    case "ping":
      return handlePing();
    case "register":
      return handleRegister(payload);
    case "login":
      return handleLogin(payload);
    case "googleAuth":
      return handleGoogleAuth(payload);
    case "me":
      return handleMe(payload);
    case "catalog":
      return handleCatalog(payload);
    case "reviews":
      return handleGetReviews(payload);
    case "addReview":
      return handleAddReview(payload);
    case "trackDownload":
      return handleTrackDownload(payload);
    case "listDriveFiles":
      return handleListDriveFiles(payload);
    case "createUploadSession":
      return handleCreateUploadSession(payload);
    case "finalizeDriveFile":
      return handleFinalizeDriveFile(payload);
    case "uploadSmallFile":
      return handleUploadSmallFile(payload);
    case "saveApp":
      return handleSaveApp(payload);
    case "deleteApp":
      return handleDeleteApp(payload);
    case "listUsers":
      return handleListUsers(payload);
    case "saveSettings":
      return handleSaveSettings(payload);
    default:
      return { ok: false, error: "Bilinmeyen işlem: " + action };
  }
}

/* ==================== YARDIMCILAR ==================== */

function getSpreadsheet() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getSheetData(sheetName) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return { sheet: null, headers: [], rows: [] };
  const values = sheet.getDataRange().getValues();
  if (values.length === 0) return { sheet, headers: [], rows: [] };
  const headers = values[0].map(String);
  const rows = values.slice(1).map((row, idx) => {
    const obj = { _rowIndex: idx + 2 };
    headers.forEach((h, cIdx) => {
      obj[h] = row[cIdx];
    });
    return obj;
  });
  return { sheet, headers, rows };
}

function getSettingsMap() {
  const { rows } = getSheetData(SHEETS.SETTINGS);
  const map = {
    admin_emails: CONFIG.DEFAULT_ADMIN_EMAIL,
    store_name: "YMC Store",
    store_subtitle: "Özel Android Uygulama Mağazası",
    announcement: ""
  };
  rows.forEach(r => {
    if (r.key) map[String(r.key).trim()] = r.value !== undefined ? String(r.value) : "";
  });
  return map;
}

function getAdminEmails() {
  const settings = getSettingsMap();
  return String(settings.admin_emails || CONFIG.DEFAULT_ADMIN_EMAIL)
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminEmail(email) {
  if (!email) return false;
  return getAdminEmails().includes(String(email).trim().toLowerCase());
}

function getSessionSecret() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty("YMC_SESSION_SECRET");
  if (!secret) {
    secret = Utilities.getUuid() + "-" + Utilities.getUuid();
    props.setProperty("YMC_SESSION_SECRET", secret);
  }
  return secret;
}

function b64UrlEncode(bytesOrStr) {
  const b64 = typeof bytesOrStr === "string"
    ? Utilities.base64EncodeWebSafe(bytesOrStr, Utilities.Charset.UTF_8)
    : Utilities.base64EncodeWebSafe(bytesOrStr);
  return b64.replace(/=+$/, "");
}

function b64UrlDecodeString(str) {
  let padded = str.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4) padded += "=";
  const bytes = Utilities.base64Decode(padded);
  return Utilities.newBlob(bytes).getDataAsString("UTF-8");
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function signSessionToken(user) {
  const payload = {
    uid: user.uid,
    email: user.email,
    exp: Date.now() + CONFIG.TOKEN_TTL_MS
  };
  const encodedPayload = b64UrlEncode(JSON.stringify(payload));
  const sigBytes = Utilities.computeHmacSha256Signature(encodedPayload, getSessionSecret());
  const encodedSig = b64UrlEncode(sigBytes);
  return encodedPayload + "." + encodedSig;
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSig] = parts;
  const expectedSigBytes = Utilities.computeHmacSha256Signature(encodedPayload, getSessionSecret());
  const expectedSig = b64UrlEncode(expectedSigBytes);
  if (!constantTimeEqual(encodedSig, expectedSig)) return null;
  try {
    const payload = JSON.parse(b64UrlDecodeString(encodedPayload));
    if (!payload.uid || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function hashPassword(password, salt) {
  let current = salt + ":" + password;
  for (let i = 0; i < 600; i++) {
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, current, Utilities.Charset.UTF_8);
    current = digest.map(b => ((b < 0 ? b + 256 : b).toString(16).padStart(2, "0"))).join("");
  }
  return current;
}

function requireAuth(payload) {
  const verified = verifySessionToken(payload.token);
  if (!verified) throw new Error("Oturumunuz geçersiz veya süresi dolmuş. Lütfen tekrar giriş yapın.");
  const { rows } = getSheetData(SHEETS.USERS);
  const user = rows.find(u => String(u.uid) === String(verified.uid));
  if (!user) throw new Error("Kullanıcı kaydı bulunamadı.");
  const role = isAdminEmail(user.email) ? "admin" : "user";
  return {
    uid: String(user.uid),
    email: String(user.email),
    displayName: String(user.displayName || user.email.split("@")[0]),
    photoUrl: String(user.photoUrl || ""),
    provider: String(user.provider || "password"),
    role,
    _rowIndex: user._rowIndex
  };
}

function requireAdmin(payload) {
  const user = requireAuth(payload);
  if (user.role !== "admin") {
    throw new Error("Bu işlem için yönetici yetkisi gerekiyor.");
  }
  return user;
}

function sanitizeUser(u) {
  return {
    uid: String(u.uid),
    email: String(u.email),
    displayName: String(u.displayName || ""),
    photoUrl: String(u.photoUrl || ""),
    provider: String(u.provider || "password"),
    role: isAdminEmail(u.email) ? "admin" : "user",
    createdAt: Number(u.createdAt) || 0,
    lastLoginAt: Number(u.lastLoginAt) || 0
  };
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let val = Number(bytes);
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return val.toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

function buildDirectDownloadUrl(driveFileId) {
  if (!driveFileId) return "";
  return "https://drive.usercontent.google.com/download?id=" + encodeURIComponent(driveFileId) + "&export=download&confirm=t";
}

function ensurePublicRead(fileId) {
  if (!fileId) return;
  try {
    const file = DriveApp.getFileById(fileId);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    // Paylaşım zaten açıksa veya izin verilmediyse sessizce devam et
  }
}

/* ==================== İŞLEM YÖNETİCİLERİ ==================== */

function handlePing() {
  const settings = getSettingsMap();
  return {
    ok: true,
    storeName: settings.store_name || "YMC Store",
    storeSubtitle: settings.store_subtitle || "",
    folderId: CONFIG.DRIVE_FOLDER_ID,
    sheetId: CONFIG.SPREADSHEET_ID,
    timestamp: Date.now()
  };
}

function handleRegister(payload) {
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const displayName = String(payload.displayName || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Geçerli bir e-posta adresi girin." };
  }
  if (password.length < 6) {
    return { ok: false, error: "Şifre en az 6 karakter olmalıdır." };
  }
  if (displayName.length < 2) {
    return { ok: false, error: "Lütfen adınızı girin." };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const { sheet, rows } = getSheetData(SHEETS.USERS);
    const existing = rows.find(u => String(u.email).trim().toLowerCase() === email);
    if (existing) {
      return { ok: false, error: "Bu e-posta adresi zaten kayıtlı. Lütfen giriş yapın." };
    }

    const uid = "usr_" + Utilities.getUuid().replace(/-/g, "").slice(0, 16);
    const salt = Utilities.getUuid().replace(/-/g, "").slice(0, 16);
    const passwordHash = hashPassword(password, salt);
    const role = isAdminEmail(email) ? "admin" : "user";
    const now = Date.now();

    sheet.appendRow([uid, email, displayName, "", "password", passwordHash, salt, role, now, now]);

    const user = { uid, email, displayName, photoUrl: "", provider: "password", role };
    const token = signSessionToken(user);
    return { ok: true, token, user };
  } finally {
    lock.releaseLock();
  }
}

function handleLogin(payload) {
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");

  if (!email || !password) {
    return { ok: false, error: "E-posta ve şifre gereklidir." };
  }

  const { sheet, rows } = getSheetData(SHEETS.USERS);
  const existing = rows.find(u => String(u.email).trim().toLowerCase() === email);
  if (!existing) {
    return { ok: false, error: "Bu e-posta adresine kayıtlı bir hesap bulunamadı." };
  }

  if (!existing.passwordHash || !existing.salt) {
    return { ok: false, error: "Bu hesap Google ile oluşturulmuş. Lütfen 'Google ile Giriş Yap' butonunu kullanın." };
  }

  const candidateHash = hashPassword(password, String(existing.salt));
  if (!constantTimeEqual(candidateHash, String(existing.passwordHash))) {
    return { ok: false, error: "E-posta veya şifre hatalı." };
  }

  const role = isAdminEmail(email) ? "admin" : "user";
  sheet.getRange(existing._rowIndex, 8).setValue(role);
  sheet.getRange(existing._rowIndex, 10).setValue(Date.now());

  const user = {
    uid: String(existing.uid),
    email,
    displayName: String(existing.displayName || email.split("@")[0]),
    photoUrl: String(existing.photoUrl || ""),
    provider: String(existing.provider || "password"),
    role
  };
  const token = signSessionToken(user);
  return { ok: true, token, user };
}

function handleGoogleAuth(payload) {
  const idToken = String(payload.idToken || "").trim();
  if (!idToken) {
    return { ok: false, error: "Google oturum jetonu (idToken) alınamadı." };
  }

  const verifyUrl = "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken);
  const res = UrlFetchApp.fetch(verifyUrl, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    return { ok: false, error: "Google oturumu doğrulanamadı (HTTP " + res.getResponseCode() + ")." };
  }

  const info = JSON.parse(res.getContentText());
  const email = String(info.email || "").trim().toLowerCase();
  const verified = info.email_verified === true || info.email_verified === "true";

  if (!email || !verified) {
    return { ok: false, error: "Doğrulanmış bir Google e-posta adresi alınamadı." };
  }
  if (info.exp && Number(info.exp) * 1000 < Date.now()) {
    return { ok: false, error: "Google oturum jetonunun süresi dolmuş." };
  }
  if (CONFIG.GOOGLE_WEB_CLIENT_ID && info.aud !== CONFIG.GOOGLE_WEB_CLIENT_ID) {
    return { ok: false, error: "Google Client ID eşleşmedi." };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const { sheet, rows } = getSheetData(SHEETS.USERS);
    const existing = rows.find(u => String(u.email).trim().toLowerCase() === email);
    const role = isAdminEmail(email) ? "admin" : "user";
    const now = Date.now();
    const displayName = String(info.name || (existing ? existing.displayName : email.split("@")[0]));
    const photoUrl = String(info.picture || (existing ? existing.photoUrl : ""));

    let uid;
    if (existing) {
      uid = String(existing.uid);
      sheet.getRange(existing._rowIndex, 3).setValue(displayName);
      if (photoUrl) sheet.getRange(existing._rowIndex, 4).setValue(photoUrl);
      sheet.getRange(existing._rowIndex, 8).setValue(role);
      sheet.getRange(existing._rowIndex, 10).setValue(now);
    } else {
      uid = "ggl_" + Utilities.getUuid().replace(/-/g, "").slice(0, 16);
      sheet.appendRow([uid, email, displayName, photoUrl, "google", "", "", role, now, now]);
    }

    const user = { uid, email, displayName, photoUrl, provider: "google", role };
    const token = signSessionToken(user);
    return { ok: true, token, user };
  } finally {
    lock.releaseLock();
  }
}

function handleMe(payload) {
  const user = requireAuth(payload);
  return { ok: true, user };
}

function handleCatalog(payload) {
  let user = null;
  if (payload.token) {
    try { user = requireAuth(payload); } catch (e) { user = null; }
  }
  const isAdmin = user && user.role === "admin";
  const settings = getSettingsMap();
  const { rows } = getSheetData(SHEETS.APPS);

  const apps = rows
    .filter(r => r.id && (isAdmin || String(r.active).toLowerCase() !== "false"))
    .map(r => {
      let screenshots = [];
      try {
        screenshots = JSON.parse(r.screenshotsJson || "[]");
      } catch (e) {
        screenshots = [];
      }
      const driveFileId = String(r.driveFileId || "");
      return {
        id: String(r.id),
        name: String(r.name || ""),
        packageName: String(r.packageName || ""),
        versionName: String(r.versionName || "1.0.0"),
        versionCode: Number(r.versionCode) || 1,
        category: String(r.category || "Araçlar"),
        developer: String(r.developer || "Erhan Yamaç"),
        shortDesc: String(r.shortDesc || ""),
        description: String(r.description || ""),
        whatsNew: String(r.whatsNew || ""),
        driveFileId,
        fileName: String(r.fileName || ""),
        fileSizeText: String(r.fileSizeText || ""),
        iconUrl: String(r.iconUrl || ""),
        screenshots: Array.isArray(screenshots) ? screenshots : [],
        downloads: Number(r.downloads) || 0,
        ratingAvg: Number(r.ratingAvg) || 0,
        ratingCount: Number(r.ratingCount) || 0,
        featured: String(r.featured).toLowerCase() === "true",
        active: String(r.active).toLowerCase() !== "false",
        downloadUrl: buildDirectDownloadUrl(driveFileId),
        createdAt: Number(r.createdAt) || 0,
        updatedAt: Number(r.updatedAt) || 0
      };
    })
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

  return {
    ok: true,
    settings: {
      storeName: settings.store_name || "YMC Store",
      storeSubtitle: settings.store_subtitle || "",
      announcement: settings.announcement || "",
      ...(isAdmin ? { adminEmails: settings.admin_emails || CONFIG.DEFAULT_ADMIN_EMAIL } : {})
    },
    apps
  };
}

function handleGetReviews(payload) {
  const appId = String(payload.appId || "").trim();
  if (!appId) return { ok: false, error: "appId gerekli." };
  const { rows } = getSheetData(SHEETS.REVIEWS);
  const reviews = rows
    .filter(r => String(r.appId) === appId)
    .map(r => ({
      reviewId: String(r.reviewId),
      appId: String(r.appId),
      uid: String(r.uid),
      userName: String(r.userName || "Kullanıcı"),
      userPhoto: String(r.userPhoto || ""),
      rating: Number(r.rating) || 5,
      comment: String(r.comment || ""),
      createdAt: Number(r.createdAt) || 0
    }))
    .sort((a, b) => b.createdAt - a.createdAt);

  return { ok: true, reviews };
}

function handleAddReview(payload) {
  const user = requireAuth(payload);
  const appId = String(payload.appId || "").trim();
  const rating = Math.min(5, Math.max(1, Math.round(Number(payload.rating) || 5)));
  const comment = String(payload.comment || "").trim().slice(0, 800);
  if (!appId) return { ok: false, error: "Uygulama seçilmedi." };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const revData = getSheetData(SHEETS.REVIEWS);
    const existing = revData.rows.find(r => String(r.appId) === appId && String(r.uid) === user.uid);
    const now = Date.now();

    if (existing) {
      revData.sheet.getRange(existing._rowIndex, 4, 1, 5).setValues([[
        user.displayName, user.photoUrl, rating, comment, now
      ]]);
    } else {
      const reviewId = "rev_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12);
      revData.sheet.appendRow([
        reviewId, appId, user.uid, user.displayName, user.photoUrl, rating, comment, now
      ]);
    }

    // Ortalama puanı yeniden hesapla
    const refreshed = getSheetData(SHEETS.REVIEWS).rows.filter(r => String(r.appId) === appId);
    const count = refreshed.length;
    const sum = refreshed.reduce((acc, r) => acc + (Number(r.rating) || 0), 0);
    const avg = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;

    const appData = getSheetData(SHEETS.APPS);
    const appRow = appData.rows.find(a => String(a.id) === appId);
    if (appRow) {
      appData.sheet.getRange(appRow._rowIndex, 17).setValue(avg);
      appData.sheet.getRange(appRow._rowIndex, 18).setValue(count);
    }

    return { ok: true, ratingAvg: avg, ratingCount: count };
  } finally {
    lock.releaseLock();
  }
}

function handleTrackDownload(payload) {
  requireAuth(payload);
  const appId = String(payload.appId || "").trim();
  if (!appId) return { ok: false, error: "appId gerekli." };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const { sheet, rows } = getSheetData(SHEETS.APPS);
    const appRow = rows.find(a => String(a.id) === appId);
    if (!appRow) return { ok: false, error: "Uygulama bulunamadı." };

    const nextDownloads = (Number(appRow.downloads) || 0) + 1;
    sheet.getRange(appRow._rowIndex, 16).setValue(nextDownloads);

    const driveFileId = String(appRow.driveFileId || "");
    ensurePublicRead(driveFileId);

    return {
      ok: true,
      downloads: nextDownloads,
      downloadUrl: buildDirectDownloadUrl(driveFileId),
      fileName: String(appRow.fileName || (appRow.name + ".apk"))
    };
  } finally {
    lock.releaseLock();
  }
}

/* ==================== YÖNETİCİ İŞLEMLERİ ==================== */

function handleListDriveFiles(payload) {
  requireAdmin(payload);
  const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const files = folder.getFiles();

  const { rows } = getSheetData(SHEETS.APPS);
  const usedIds = new Set(rows.map(r => String(r.driveFileId || "")));

  const list = [];
  while (files.hasNext()) {
    const f = files.next();
    const id = f.getId();
    if (id === CONFIG.SPREADSHEET_ID) continue;
    const name = f.getName();
    const mime = f.getMimeType();
    const isApk = name.toLowerCase().endsWith(".apk") || mime === "application/vnd.android.package-archive";
    if (!isApk) continue;

    list.push({
      id,
      name,
      sizeBytes: f.getSize(),
      sizeText: formatBytes(f.getSize()),
      updatedAt: f.getLastUpdated().getTime(),
      alreadyInCatalog: usedIds.has(id)
    });
  }

  list.sort((a, b) => b.updatedAt - a.updatedAt);
  return { ok: true, folderId: CONFIG.DRIVE_FOLDER_ID, files: list };
}

function handleCreateUploadSession(payload) {
  requireAdmin(payload);
  const fileName = String(payload.fileName || "uygulama.apk").trim();
  const mimeType = String(payload.mimeType || "application/vnd.android.package-archive");
  const fileSize = Number(payload.fileSize) || 0;

  const metadata = {
    name: fileName,
    parents: [CONFIG.DRIVE_FOLDER_ID]
  };

  const headers = {
    Authorization: "Bearer " + ScriptApp.getOAuthToken(),
    "X-Upload-Content-Type": mimeType
  };
  if (fileSize > 0) {
    headers["X-Upload-Content-Length"] = String(fileSize);
  }

  const res = UrlFetchApp.fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "post",
      contentType: "application/json; charset=UTF-8",
      headers,
      payload: JSON.stringify(metadata),
      muteHttpExceptions: true
    }
  );

  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    return { ok: false, error: "Drive yükleme oturumu başlatılamadı (HTTP " + code + "): " + res.getContentText() };
  }

  const resHeaders = res.getAllHeaders();
  const location = resHeaders.Location || resHeaders.location;
  if (!location) {
    return { ok: false, error: "Drive yükleme bağlantısı (Location) alınamadı." };
  }

  return { ok: true, uploadUrl: location };
}

function handleFinalizeDriveFile(payload) {
  requireAdmin(payload);
  const fileId = String(payload.fileId || "").trim();
  if (!fileId) return { ok: false, error: "fileId gerekli." };

  const file = DriveApp.getFileById(fileId);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    ok: true,
    fileId,
    name: file.getName(),
    sizeBytes: file.getSize(),
    sizeText: formatBytes(file.getSize()),
    downloadUrl: buildDirectDownloadUrl(fileId),
    imageUrl: "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=w800"
  };
}

function handleUploadSmallFile(payload) {
  requireAdmin(payload);
  const fileName = String(payload.fileName || "asset.png").trim();
  const mimeType = String(payload.mimeType || "application/octet-stream");
  const base64Data = String(payload.base64Data || "");
  if (!base64Data) return { ok: false, error: "Dosya verisi boş." };

  const cleanBase64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
  const bytes = Utilities.base64Decode(cleanBase64);
  const blob = Utilities.newBlob(bytes, mimeType, fileName);

  const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileId = file.getId();

  return {
    ok: true,
    fileId,
    name: file.getName(),
    sizeText: formatBytes(file.getSize()),
    downloadUrl: buildDirectDownloadUrl(fileId),
    imageUrl: "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=w800"
  };
}

function handleSaveApp(payload) {
  requireAdmin(payload);
  const app = payload.app || {};
  if (!app.name || !app.driveFileId) {
    return { ok: false, error: "Uygulama adı ve Drive Dosya ID zorunludur." };
  }

  ensurePublicRead(app.driveFileId);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const { sheet, rows } = getSheetData(SHEETS.APPS);
    const now = Date.now();
    const id = app.id ? String(app.id) : ("app_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12));
    const existing = rows.find(r => String(r.id) === id);

    const screenshotsJson = JSON.stringify(Array.isArray(app.screenshots) ? app.screenshots : []);
    const rowValues = [
      id,
      String(app.name || "").trim(),
      String(app.packageName || "").trim(),
      String(app.versionName || "1.0.0").trim(),
      Number(app.versionCode) || 1,
      String(app.category || "Araçlar").trim(),
      String(app.developer || "Erhan Yamaç").trim(),
      String(app.shortDesc || "").trim(),
      String(app.description || "").trim(),
      String(app.whatsNew || "").trim(),
      String(app.driveFileId || "").trim(),
      String(app.fileName || (app.name + ".apk")).trim(),
      String(app.fileSizeText || "").trim(),
      String(app.iconUrl || "").trim(),
      screenshotsJson,
      existing ? (Number(existing.downloads) || 0) : (Number(app.downloads) || 0),
      existing ? (Number(existing.ratingAvg) || 0) : 0,
      existing ? (Number(existing.ratingCount) || 0) : 0,
      Boolean(app.featured),
      app.active !== false,
      existing ? (Number(existing.createdAt) || now) : now,
      now
    ];

    if (existing) {
      sheet.getRange(existing._rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }

    return { ok: true, id };
  } finally {
    lock.releaseLock();
  }
}

function handleDeleteApp(payload) {
  requireAdmin(payload);
  const appId = String(payload.appId || "").trim();
  if (!appId) return { ok: false, error: "appId gerekli." };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const { sheet, rows } = getSheetData(SHEETS.APPS);
    const existing = rows.find(r => String(r.id) === appId);
    if (!existing) return { ok: false, error: "Uygulama bulunamadı." };

    const driveFileId = String(existing.driveFileId || "");
    sheet.deleteRow(existing._rowIndex);

    if (payload.deleteDriveFile && driveFileId) {
      try {
        DriveApp.getFileById(driveFileId).setTrashed(true);
      } catch (e) {}
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function handleListUsers(payload) {
  requireAdmin(payload);
  const { rows } = getSheetData(SHEETS.USERS);
  const users = rows.map(sanitizeUser).sort((a, b) => b.lastLoginAt - a.lastLoginAt);
  return { ok: true, users };
}

function handleSaveSettings(payload) {
  requireAdmin(payload);
  const updates = payload.settings || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const { sheet, rows } = getSheetData(SHEETS.SETTINGS);
    const allowed = {
      storeName: "store_name",
      storeSubtitle: "store_subtitle",
      announcement: "announcement",
      adminEmails: "admin_emails"
    };

    Object.keys(allowed).forEach(k => {
      if (updates[k] === undefined) return;
      const sheetKey = allowed[k];
      const existing = rows.find(r => String(r.key) === sheetKey);
      if (existing) {
        sheet.getRange(existing._rowIndex, 2).setValue(String(updates[k]));
      } else {
        sheet.appendRow([sheetKey, String(updates[k]), ""]);
      }
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}
