/**
 * YMC Store - Android Native & Web Köprüsü
 */
window.YmcBridge = (() => {
  const native = window.AndroidBridge || null;

  let googleSignInResolver = null;
  let googleSignInRejecter = null;
  let apkPickResolver = null;
  let apkPickRejecter = null;

  const downloadCallbacks = new Map();
  const uploadCallbacks = new Map();
  const resumeListeners = new Set();

  // Native -> JS Global Kancalar
  window.__onNativeGoogleSignInSuccess = (idToken) => {
    if (googleSignInResolver) {
      googleSignInResolver(idToken);
      googleSignInResolver = null;
      googleSignInRejecter = null;
    }
  };

  window.__onNativeGoogleSignInCancel = () => {
    if (googleSignInRejecter) {
      googleSignInRejecter(new Error("CANCELLED"));
      googleSignInResolver = null;
      googleSignInRejecter = null;
    }
  };

  window.__onNativeGoogleSignInError = (code, message) => {
    if (googleSignInRejecter) {
      googleSignInRejecter(new Error(message || ("Google giriş hatası: " + code)));
      googleSignInResolver = null;
      googleSignInRejecter = null;
    }
  };

  window.__onApkPicked = (payload) => {
    if (apkPickResolver) {
      apkPickResolver(payload);
      apkPickResolver = null;
      apkPickRejecter = null;
    }
  };

  window.__onApkPickCancel = () => {
    if (apkPickRejecter) {
      apkPickRejecter(new Error("CANCELLED"));
      apkPickResolver = null;
      apkPickRejecter = null;
    }
  };

  window.__onApkPickError = (msg) => {
    if (apkPickRejecter) {
      apkPickRejecter(new Error(msg || "Dosya seçilemedi."));
      apkPickResolver = null;
      apkPickRejecter = null;
    }
  };

  window.__onApkDownloadProgress = (appId, percent, downloaded, total) => {
    const cb = downloadCallbacks.get(appId);
    if (cb && cb.onProgress) cb.onProgress(percent, downloaded, total);
  };

  window.__onApkDownloaded = (appId, localPath) => {
    const cb = downloadCallbacks.get(appId);
    if (cb && cb.onDone) cb.onDone(localPath);
    downloadCallbacks.delete(appId);
  };

  window.__onApkDownloadCanceled = (appId) => {
    const cb = downloadCallbacks.get(appId);
    if (cb && cb.onCancel) cb.onCancel();
    downloadCallbacks.delete(appId);
  };

  window.__onApkDownloadError = (appId, message) => {
    const cb = downloadCallbacks.get(appId);
    if (cb && cb.onError) cb.onError(new Error(message || "İndirme hatası."));
    downloadCallbacks.delete(appId);
  };

  window.__onApkNeedPermission = () => {
    if (window.YmcToast) {
      window.YmcToast("Lütfen 'Bu kaynaktan izin ver' seçeneğini açın; geri döndüğünüzde kurulum başlayacak.", "warning", 5000);
    }
  };

  window.__onUploadProgress = (uploadId, percent, sent, total) => {
    const cb = uploadCallbacks.get(uploadId);
    if (cb && cb.onProgress) cb.onProgress(percent, sent, total);
  };

  window.__onUploadComplete = (uploadId, responseText) => {
    const cb = uploadCallbacks.get(uploadId);
    if (cb && cb.onComplete) cb.onComplete(responseText);
    uploadCallbacks.delete(uploadId);
  };

  window.__onUploadError = (uploadId, message) => {
    const cb = uploadCallbacks.get(uploadId);
    if (cb && cb.onError) cb.onError(new Error(message || "Yükleme başarısız."));
    uploadCallbacks.delete(uploadId);
  };

  window.__onAppResume = () => {
    resumeListeners.forEach(fn => {
      try { fn(); } catch (e) {}
    });
  };

  function isNative() {
    return Boolean(native);
  }

  function getNativeInfo() {
    if (!native || !native.getNativeInfo) {
      return {
        isNative: false,
        packageName: "web.preview",
        versionName: "1.0.0",
        versionCode: 1,
        sha1: "",
        canInstallPackages: false
      };
    }
    try {
      return JSON.parse(native.getNativeInfo());
    } catch (e) {
      return { isNative: true };
    }
  }

  function signInWithGoogle(webClientId) {
    return new Promise((resolve, reject) => {
      if (native && native.startGoogleSignIn) {
        googleSignInResolver = resolve;
        googleSignInRejecter = reject;
        native.startGoogleSignIn(webClientId || "");
        return;
      }

      // Masaüstü/Web tarayıcı fallback: Google Identity Services (gsi)
      if (!webClientId) {
        reject(new Error("Google Web Client ID ayarlanmamış. Kurulum bölümünden ekleyin."));
        return;
      }

      const startGsi = () => {
        try {
          window.google.accounts.id.initialize({
            client_id: webClientId,
            callback: (resp) => {
              if (resp && resp.credential) resolve(resp.credential);
              else reject(new Error("Google kimlik bilgisi alınamadı."));
            }
          });
          window.google.accounts.id.prompt((notification) => {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
              reject(new Error("Tarayıcı Google açılır penceresini engelledi veya Android APK içinden deneyin."));
            }
          });
        } catch (err) {
          reject(err);
        }
      };

      if (window.google && window.google.accounts && window.google.accounts.id) {
        startGsi();
      } else {
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.onload = startGsi;
        script.onerror = () => reject(new Error("Google kimlik servisi yüklenemedi."));
        document.head.appendChild(script);
      }
    });
  }

  function downloadAndInstall(appId, downloadUrl, fileName, handlers = {}) {
    if (native && native.downloadAndInstallApk) {
      downloadCallbacks.set(appId, handlers);
      native.downloadAndInstallApk(appId, downloadUrl, fileName || (appId + ".apk"));
      return true;
    }
    // Web tarayıcıda doğrudan yeni sekmede indir
    window.open(downloadUrl, "_blank", "noopener");
    if (handlers.onDone) handlers.onDone("");
    return false;
  }

  function cancelDownload(appId) {
    if (native && native.cancelDownload) {
      native.cancelDownload(appId);
    }
  }

  function getInstalledAppsStatus(packageNames) {
    if (!native || !native.getInstalledAppsStatus || !packageNames.length) {
      return {};
    }
    try {
      return JSON.parse(native.getInstalledAppsStatus(JSON.stringify(packageNames)));
    } catch (e) {
      return {};
    }
  }

  function launchApp(packageName) {
    if (native && native.launchInstalledApp) {
      return Boolean(native.launchInstalledApp(packageName));
    }
    return false;
  }

  function uninstallApp(packageName) {
    if (native && native.uninstallApp) {
      native.uninstallApp(packageName);
      return true;
    }
    return false;
  }

  function canInstallPackages() {
    if (native && native.canRequestPackageInstalls) {
      return Boolean(native.canRequestPackageInstalls());
    }
    return true;
  }

  function openInstallPermissionSettings() {
    if (native && native.openInstallPermissionSettings) {
      native.openInstallPermissionSettings();
    }
  }

  function pickApkNative() {
    return new Promise((resolve, reject) => {
      if (!native || !native.pickApkFile) {
        reject(new Error("NOT_NATIVE"));
        return;
      }
      apkPickResolver = resolve;
      apkPickRejecter = reject;
      native.pickApkFile();
    });
  }

  function uploadLocalApkToUrl(uploadId, uploadUrl, localPath, handlers = {}) {
    return new Promise((resolve, reject) => {
      if (!native || !native.uploadLocalFileToUrl) {
        reject(new Error("NOT_NATIVE"));
        return;
      }
      uploadCallbacks.set(uploadId, {
        onProgress: handlers.onProgress,
        onComplete: (respText) => {
          try {
            resolve(JSON.parse(respText));
          } catch (e) {
            resolve({ raw: respText });
          }
        },
        onError: reject
      });
      native.uploadLocalFileToUrl(uploadId, uploadUrl, localPath);
    });
  }

  function onResume(fn) {
    resumeListeners.add(fn);
    return () => resumeListeners.delete(fn);
  }

  return {
    isNative,
    getNativeInfo,
    signInWithGoogle,
    downloadAndInstall,
    cancelDownload,
    getInstalledAppsStatus,
    launchApp,
    uninstallApp,
    canInstallPackages,
    openInstallPermissionSettings,
    pickApkNative,
    uploadLocalApkToUrl,
    onResume
  };
})();
