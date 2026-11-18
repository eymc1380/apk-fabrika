/**
 * YMC Store - Uygulama Yapılandırması
 * -----------------------------------
 * KURULUM.md adımlarını tamamladıktan sonra APPS_SCRIPT_URL ve
 * (Google ile Giriş için) GOOGLE_WEB_CLIENT_ID değerlerini buraya yapıştırın.
 */
window.YMC_DEFAULT_CONFIG = {
  STORE_NAME: "YMC Store",
  STORE_SUBTITLE: "Özel Android Uygulama Mağazası",

  // Google Drive'daki "YMC Store" klasör ID'si
  DRIVE_FOLDER_ID: "1D2uUQD2dQOCjuQMrpCvprfyiKJTolzTe",

  // Google Sheets "YMC Store DB" veritabanı ID'si
  SPREADSHEET_ID: "1XbpgH2AqGqR1PNpS92AtlcgEqsa4oMUKPi9kZyMcxYc",

  // 1. Google Apps Script Web Uygulaması URL'si (sonu /exec ile biter)
  APPS_SCRIPT_URL: "",

  // 2. Google Cloud OAuth 2.0 Web Client ID ("Google ile Giriş" butonu için)
  GOOGLE_WEB_CLIENT_ID: ""
};

window.YmcConfig = {
  STORAGE_OVERRIDE_KEY: "ymc_store_config_override",

  get() {
    let overrides = {};
    try {
      overrides = JSON.parse(localStorage.getItem(this.STORAGE_OVERRIDE_KEY) || "{}");
    } catch (e) {
      overrides = {};
    }
    return {
      ...window.YMC_DEFAULT_CONFIG,
      ...(overrides.APPS_SCRIPT_URL ? { APPS_SCRIPT_URL: overrides.APPS_SCRIPT_URL } : {}),
      ...(overrides.GOOGLE_WEB_CLIENT_ID ? { GOOGLE_WEB_CLIENT_ID: overrides.GOOGLE_WEB_CLIENT_ID } : {})
    };
  },

  saveOverride(appsScriptUrl, googleWebClientId) {
    const clean = {
      APPS_SCRIPT_URL: String(appsScriptUrl || "").trim(),
      GOOGLE_WEB_CLIENT_ID: String(googleWebClientId || "").trim()
    };
    localStorage.setItem(this.STORAGE_OVERRIDE_KEY, JSON.stringify(clean));
  },

  clearOverride() {
    localStorage.removeItem(this.STORAGE_OVERRIDE_KEY);
  },

  isConfigured() {
    const cfg = this.get();
    return Boolean(cfg.APPS_SCRIPT_URL && cfg.APPS_SCRIPT_URL.startsWith("https://script.google.com/"));
  }
};
