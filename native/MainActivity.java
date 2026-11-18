package com.erhan.ymcstore;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Collator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, AtomicBoolean> downloadCancelFlags = new ConcurrentHashMap<>();
    private ActivityResultLauncher<Intent> googleSignInLauncher;
    private ActivityResultLauncher<Intent> apkPickerLauncher;
    private BroadcastReceiver packageChangeReceiver;
    private String pendingInstallFilePath = null;
    private volatile long lastResumeEmitMs = 0L;

    private static class ApkMeta {
        String packageName = "";
        String versionName = "";
        long versionCode = 0;
        String appLabel = "";
        String iconDataUrl = "";
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = this.getBridge() != null ? this.getBridge().getWebView() : null;
        if (webView != null) {
            webView.setBackgroundColor(Color.parseColor("#0b1120"));
            webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        }

        googleSignInLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                Intent data = result.getData();
                if (data == null) {
                    emitJs("window.__onNativeGoogleSignInCancel && window.__onNativeGoogleSignInCancel()");
                    return;
                }
                try {
                    Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
                    GoogleSignInAccount account = task.getResult(ApiException.class);
                    String idToken = account != null ? account.getIdToken() : null;
                    if (idToken != null && !idToken.isEmpty()) {
                        emitJs("window.__onNativeGoogleSignInSuccess && window.__onNativeGoogleSignInSuccess(" + JSONObject.quote(idToken) + ")");
                    } else {
                        emitJs("window.__onNativeGoogleSignInError && window.__onNativeGoogleSignInError(-1, " + JSONObject.quote("Google ID Token alınamadı. Web Client ID ayarını kontrol edin.") + ")");
                    }
                } catch (ApiException e) {
                    int code = e.getStatusCode();
                    if (code == 12501) {
                        emitJs("window.__onNativeGoogleSignInCancel && window.__onNativeGoogleSignInCancel()");
                    } else {
                        String msg = "Google Giriş Hatası (Kod: " + code + ")";
                        if (code == 10) {
                            msg = "Google OAuth yapılandırma hatası (Kod 10): Google Cloud Console'a bu APK'nın SHA-1 parmak izini ve paket adını ekleyin.";
                        } else if (code == 12500) {
                            msg = "Google Giriş başarısız (Kod 12500): OAuth Onay Ekranı (Consent Screen) veya destek e-postası ayarlarını kontrol edin.";
                        }
                        emitJs("window.__onNativeGoogleSignInError && window.__onNativeGoogleSignInError(" + code + ", " + JSONObject.quote(msg) + ")");
                    }
                } catch (Exception e) {
                    emitJs("window.__onNativeGoogleSignInError && window.__onNativeGoogleSignInError(-1, " + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
                }
            }
        );

        apkPickerLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
                    emitJs("window.__onApkPickCancel && window.__onApkPickCancel()");
                    return;
                }
                final Uri uri = result.getData().getData();
                executor.execute(() -> inspectAndStagePickedApk(uri));
            }
        );

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv == null) {
                    finish();
                    return;
                }
                wv.evaluateJavascript("(function(){ return window.__handleAndroidBack ? Boolean(window.__handleAndroidBack()) : false; })()", value -> {
                    if (!"true".equals(value)) {
                        runOnUiThread(() -> finish());
                    }
                });
            }
        });

        registerPackageChangeReceiver();
    }

    private void registerPackageChangeReceiver() {
        try {
            packageChangeReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (intent == null) return;
                    Uri data = intent.getData();
                    String pkg = data != null ? data.getSchemeSpecificPart() : "";
                    String act = String.valueOf(intent.getAction());
                    emitJs("window.__onPackageChanged && window.__onPackageChanged("
                        + JSONObject.quote(pkg) + ", " + JSONObject.quote(act) + ")");
                }
            };
            IntentFilter filter = new IntentFilter();
            filter.addAction(Intent.ACTION_PACKAGE_ADDED);
            filter.addAction(Intent.ACTION_PACKAGE_REPLACED);
            filter.addAction(Intent.ACTION_PACKAGE_REMOVED);
            filter.addAction(Intent.ACTION_PACKAGE_CHANGED);
            filter.addDataScheme("package");
            ContextCompat.registerReceiver(this, packageChangeReceiver, filter, ContextCompat.RECEIVER_EXPORTED);
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        if (packageChangeReceiver != null) {
            try {
                unregisterReceiver(packageChangeReceiver);
            } catch (Exception ignored) {}
            packageChangeReceiver = null;
        }
        super.onDestroy();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (pendingInstallFilePath != null && canRequestPackageInstallsCompat()) {
            File f = new File(pendingInstallFilePath);
            pendingInstallFilePath = null;
            if (f.exists()) {
                launchSystemInstaller(f);
            }
        }
        emitResumeSafe();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && System.currentTimeMillis() - lastResumeEmitMs > 350L) {
            emitResumeSafe();
        }
    }

    private void emitResumeSafe() {
        lastResumeEmitMs = System.currentTimeMillis();
        emitJs("window.__onAppResume && window.__onAppResume()");
    }

    private void emitJs(final String js) {
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(js, null);
            }
        });
    }

    private boolean canRequestPackageInstallsCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    /* ==================== APK METADATA & BINARY AXML PARSER ==================== */

    private ApkMeta extractApkMeta(File apkFile, boolean extractIcon) {
        ApkMeta meta = new ApkMeta();
        if (apkFile == null || !apkFile.exists()) {
            meta.versionName = "1.0.0";
            meta.versionCode = 1;
            return meta;
        }

        try {
            PackageManager pm = getPackageManager();
            int flags = PackageManager.GET_ACTIVITIES | PackageManager.GET_META_DATA;
            PackageInfo pkgInfo;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pkgInfo = pm.getPackageArchiveInfo(apkFile.getAbsolutePath(), PackageManager.PackageInfoFlags.of(flags));
            } else {
                @SuppressWarnings("deprecation")
                PackageInfo legacy = pm.getPackageArchiveInfo(apkFile.getAbsolutePath(), flags);
                pkgInfo = legacy;
            }
            if (pkgInfo != null) {
                if (pkgInfo.packageName != null) meta.packageName = pkgInfo.packageName.trim();
                if (pkgInfo.versionName != null) meta.versionName = pkgInfo.versionName.trim();
                meta.versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? pkgInfo.getLongVersionCode()
                    : pkgInfo.versionCode;
                if (pkgInfo.applicationInfo != null) {
                    pkgInfo.applicationInfo.sourceDir = apkFile.getAbsolutePath();
                    pkgInfo.applicationInfo.publicSourceDir = apkFile.getAbsolutePath();
                    try {
                        CharSequence lbl = pkgInfo.applicationInfo.loadLabel(pm);
                        if (lbl != null) meta.appLabel = lbl.toString().trim();
                    } catch (Exception ignored) {}
                    if (extractIcon) {
                        try {
                            Drawable icon = pkgInfo.applicationInfo.loadIcon(pm);
                            if (icon != null) meta.iconDataUrl = drawableToDataUrl(icon, 256);
                        } catch (Exception ignored) {}
                    }
                }
            }
        } catch (Exception ignored) {}

        // Saf Java Binary AndroidManifest.xml (AXML) yedek çözümleyici
        if (meta.packageName.isEmpty() || meta.versionName.isEmpty() || meta.versionCode <= 0) {
            ApkMeta axml = parseManifestFromApkZip(apkFile);
            if (meta.packageName.isEmpty() && !axml.packageName.isEmpty()) {
                meta.packageName = axml.packageName;
            }
            if (meta.versionName.isEmpty() && !axml.versionName.isEmpty()) {
                meta.versionName = axml.versionName;
            }
            if (meta.versionCode <= 0 && axml.versionCode > 0) {
                meta.versionCode = axml.versionCode;
            }
            if (meta.appLabel.isEmpty() && !axml.appLabel.isEmpty()) {
                meta.appLabel = axml.appLabel;
            }
        }

        if (meta.versionName.isEmpty()) meta.versionName = "1.0.0";
        if (meta.versionCode <= 0) meta.versionCode = 1;
        return meta;
    }

    private String drawableToDataUrl(Drawable drawable, int maxDim) {
        if (drawable == null) return "";
        Bitmap bmp = null;
        try {
            int w = drawable.getIntrinsicWidth();
            int h = drawable.getIntrinsicHeight();
            if (w <= 0 || h <= 0) {
                w = maxDim;
                h = maxDim;
            } else if (w > maxDim || h > maxDim) {
                float scale = Math.min((float) maxDim / w, (float) maxDim / h);
                w = Math.max(1, Math.round(w * scale));
                h = Math.max(1, Math.round(h * scale));
            }
            bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            drawable.setBounds(0, 0, w, h);
            drawable.draw(canvas);

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 100, baos);
            String b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
            return "data:image/png;base64," + b64;
        } catch (Exception ignored) {
            return "";
        } finally {
            if (bmp != null && !bmp.isRecycled()) {
                bmp.recycle();
            }
        }
    }

    private static int u16(byte[] b, int off) {
        return (b[off] & 0xFF) | ((b[off + 1] & 0xFF) << 8);
    }

    private static int i32(byte[] b, int off) {
        return (b[off] & 0xFF)
            | ((b[off + 1] & 0xFF) << 8)
            | ((b[off + 2] & 0xFF) << 16)
            | ((b[off + 3] & 0xFF) << 24);
    }

    private static long u32(byte[] b, int off) {
        return i32(b, off) & 0xFFFFFFFFL;
    }

    private static ApkMeta parseManifestFromApkZip(File apkFile) {
        ApkMeta meta = new ApkMeta();
        try (ZipFile zf = new ZipFile(apkFile)) {
            ZipEntry entry = zf.getEntry("AndroidManifest.xml");
            if (entry == null) return meta;
            try (InputStream is = zf.getInputStream(entry);
                 ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                byte[] buf = new byte[16384];
                int r;
                long total = 0;
                while ((r = is.read(buf)) != -1) {
                    total += r;
                    if (total > 8 * 1024 * 1024) break;
                    baos.write(buf, 0, r);
                }
                parseManifestAxml(baos.toByteArray(), meta);
            }
        } catch (Exception ignored) {}
        return meta;
    }

    private static void parseManifestAxml(byte[] data, ApkMeta meta) {
        if (data == null || data.length < 16) return;
        int fileType = u16(data, 0);
        int fileHeaderSize = u16(data, 2);
        if (fileType != 0x0003) return;

        String[] strings = new String[0];
        int[] resIds = new int[0];
        long vcLow = -1;
        long vcMajor = 0;

        int pos = fileHeaderSize;
        while (pos + 8 <= data.length) {
            int chunkType = u16(data, pos);
            int chunkHeaderSize = u16(data, pos + 2);
            long chunkSizeL = u32(data, pos + 4);
            if (chunkSizeL < 8 || pos + chunkSizeL > data.length) break;
            int chunkSize = (int) chunkSizeL;

            if (chunkType == 0x0001 && pos + 28 <= data.length) {
                int stringCount = i32(data, pos + 8);
                int flags = i32(data, pos + 16);
                int stringsStart = i32(data, pos + 20);
                boolean isUtf8 = (flags & 0x100) != 0;
                int offsetsStart = pos + chunkHeaderSize;
                int stringsBase = pos + stringsStart;
                if (stringCount > 0 && stringCount < 200000 && offsetsStart + stringCount * 4 <= pos + chunkSize) {
                    strings = new String[stringCount];
                    for (int i = 0; i < stringCount; i++) {
                        int off = i32(data, offsetsStart + i * 4);
                        int p = stringsBase + off;
                        if (p < 0 || p >= data.length) {
                            strings[i] = "";
                            continue;
                        }
                        if (isUtf8) {
                            if (p < data.length && (data[p++] & 0x80) != 0) p++;
                            int byteLen = p < data.length ? (data[p++] & 0xFF) : 0;
                            if ((byteLen & 0x80) != 0 && p < data.length) {
                                byteLen = ((byteLen & 0x7F) << 8) | (data[p++] & 0xFF);
                            }
                            if (byteLen > 0 && p + byteLen <= data.length) {
                                strings[i] = new String(data, p, byteLen, StandardCharsets.UTF_8);
                            } else {
                                strings[i] = "";
                            }
                        } else {
                            int charLen = p + 2 <= data.length ? u16(data, p) : 0;
                            p += 2;
                            if ((charLen & 0x8000) != 0 && p + 2 <= data.length) {
                                charLen = ((charLen & 0x7FFF) << 16) | u16(data, p);
                                p += 2;
                            }
                            int byteLen = charLen * 2;
                            if (byteLen > 0 && p + byteLen <= data.length) {
                                strings[i] = new String(data, p, byteLen, StandardCharsets.UTF_16LE);
                            } else {
                                strings[i] = "";
                            }
                        }
                    }
                }
            } else if (chunkType == 0x0180) {
                int count = (chunkSize - chunkHeaderSize) / 4;
                if (count > 0 && count < 200000) {
                    resIds = new int[count];
                    for (int i = 0; i < count; i++) {
                        resIds[i] = i32(data, pos + chunkHeaderSize + i * 4);
                    }
                }
            } else if (chunkType == 0x0102) {
                int ext = pos + chunkHeaderSize;
                if (ext + 20 <= pos + chunkSize) {
                    int nameIdx = i32(data, ext + 4);
                    int attrStart = u16(data, ext + 8);
                    int attrSize = u16(data, ext + 10);
                    int attrCount = u16(data, ext + 12);
                    String tagName = (nameIdx >= 0 && nameIdx < strings.length) ? strings[nameIdx] : "";

                    int attrBase = ext + attrStart;
                    if (attrSize >= 20) {
                        for (int i = 0; i < attrCount; i++) {
                            int a = attrBase + i * attrSize;
                            if (a + 20 > pos + chunkSize) break;
                            int attrNameIdx = i32(data, a + 4);
                            int rawValIdx = i32(data, a + 8);
                            int dataType = data[a + 15] & 0xFF;
                            int valData = i32(data, a + 16);

                            String attrName = (attrNameIdx >= 0 && attrNameIdx < strings.length) ? strings[attrNameIdx] : "";
                            int resId = (attrNameIdx >= 0 && attrNameIdx < resIds.length) ? resIds[attrNameIdx] : 0;

                            String strVal = null;
                            if (rawValIdx >= 0 && rawValIdx < strings.length) {
                                strVal = strings[rawValIdx];
                            } else if (dataType == 0x03 && valData >= 0 && valData < strings.length) {
                                strVal = strings[valData];
                            }

                            if ("manifest".equals(tagName)) {
                                if ("package".equals(attrName) && strVal != null && !strVal.isEmpty()) {
                                    meta.packageName = strVal.trim();
                                } else if (resId == 0x0101021b || "versionCode".equals(attrName)) {
                                    if (dataType == 0x10 || dataType == 0x11) {
                                        vcLow = valData & 0xFFFFFFFFL;
                                    } else if (strVal != null) {
                                        try { vcLow = Long.parseLong(strVal.trim()); } catch (Exception ignored) {}
                                    }
                                } else if (resId == 0x01010576 || "versionCodeMajor".equals(attrName)) {
                                    if (dataType == 0x10 || dataType == 0x11) {
                                        vcMajor = valData & 0xFFFFFFFFL;
                                    }
                                } else if (resId == 0x0101021c || "versionName".equals(attrName)) {
                                    if (strVal != null && !strVal.isEmpty()) {
                                        meta.versionName = strVal.trim();
                                    } else if (dataType == 0x10) {
                                        meta.versionName = String.valueOf(valData);
                                    }
                                }
                            } else if ("application".equals(tagName)) {
                                if ((resId == 0x01010001 || "label".equals(attrName)) && dataType == 0x03 && strVal != null && meta.appLabel.isEmpty()) {
                                    meta.appLabel = strVal.trim();
                                }
                            }
                        }
                    }
                    if ("application".equals(tagName) && !meta.packageName.isEmpty()) break;
                }
            }
            pos += chunkSize;
        }
        if (vcLow >= 0) {
            meta.versionCode = (vcMajor << 32) | vcLow;
        }
    }

    /* ==================== APK SEÇME VE CİHAZ UYGULAMALARI ==================== */

    private void inspectAndStagePickedApk(Uri uri) {
        try {
            ContentResolver cr = getContentResolver();
            String fileName = "uygulama.apk";
            long fileSize = -1;

            try (Cursor cursor = cr.query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    int sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE);
                    if (nameIdx != -1) {
                        String n = cursor.getString(nameIdx);
                        if (n != null && !n.trim().isEmpty()) fileName = n.trim();
                    }
                    if (sizeIdx != -1) {
                        fileSize = cursor.getLong(sizeIdx);
                    }
                }
            }

            File cacheDir = new File(getCacheDir(), "staged_uploads");
            if (!cacheDir.exists()) cacheDir.mkdirs();
            File stagedFile = new File(cacheDir, "upload_" + System.currentTimeMillis() + ".apk");

            try (InputStream in = cr.openInputStream(uri);
                 OutputStream out = new FileOutputStream(stagedFile)) {
                if (in == null) throw new Exception("Seçilen dosya okunamadı.");
                byte[] buf = new byte[65536];
                int len;
                long total = 0;
                while ((len = in.read(buf)) != -1) {
                    out.write(buf, 0, len);
                    total += len;
                }
                if (fileSize <= 0) fileSize = total;
            }

            ApkMeta meta = extractApkMeta(stagedFile, true);

            JSONObject obj = new JSONObject();
            obj.put("localPath", stagedFile.getAbsolutePath());
            obj.put("fileName", fileName);
            obj.put("sizeBytes", fileSize);
            obj.put("packageName", meta.packageName);
            obj.put("versionName", meta.versionName);
            obj.put("versionCode", meta.versionCode);
            obj.put("appLabel", meta.appLabel);
            obj.put("iconDataUrl", meta.iconDataUrl);

            emitJs("window.__onApkPicked && window.__onApkPicked(" + obj.toString() + ")");
        } catch (Exception e) {
            emitJs("window.__onApkPickError && window.__onApkPickError(" + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
        }
    }

    private void stageInstalledAppInternal(String packageName) {
        try {
            PackageManager pm = getPackageManager();
            PackageInfo pi = pm.getPackageInfo(packageName, 0);
            if (pi == null || pi.applicationInfo == null || pi.applicationInfo.publicSourceDir == null) {
                throw new Exception("Uygulama APK dosyasına erişilemedi.");
            }
            File srcApk = new File(pi.applicationInfo.publicSourceDir);
            if (!srcApk.exists() || !srcApk.canRead()) {
                throw new Exception("APK kaynağı okunamadı.");
            }

            File cacheDir = new File(getCacheDir(), "staged_uploads");
            if (!cacheDir.exists()) cacheDir.mkdirs();
            File stagedFile = new File(cacheDir, "upload_" + System.currentTimeMillis() + ".apk");

            long total = 0;
            try (InputStream in = new FileInputStream(srcApk);
                 OutputStream out = new FileOutputStream(stagedFile)) {
                byte[] buf = new byte[65536];
                int len;
                while ((len = in.read(buf)) != -1) {
                    out.write(buf, 0, len);
                    total += len;
                }
            }

            CharSequence lbl = pi.applicationInfo.loadLabel(pm);
            String appLabel = lbl != null ? lbl.toString().trim() : packageName;
            String versionName = (pi.versionName != null && !pi.versionName.trim().isEmpty()) ? pi.versionName.trim() : "1.0.0";
            long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
            String iconDataUrl = "";
            try {
                Drawable icon = pi.applicationInfo.loadIcon(pm);
                if (icon != null) iconDataUrl = drawableToDataUrl(icon, 256);
            } catch (Exception ignored) {}

            String safeBase = appLabel.replaceAll("[^a-zA-Z0-9._-]", "_").replaceAll("_+", "_");
            if (safeBase.isEmpty() || safeBase.equals("_")) safeBase = packageName;
            String fileName = safeBase + "_v" + versionName.replaceAll("[^a-zA-Z0-9._-]", "_") + ".apk";

            JSONObject obj = new JSONObject();
            obj.put("localPath", stagedFile.getAbsolutePath());
            obj.put("fileName", fileName);
            obj.put("sizeBytes", total);
            obj.put("packageName", packageName);
            obj.put("versionName", versionName);
            obj.put("versionCode", versionCode);
            obj.put("appLabel", appLabel);
            obj.put("iconDataUrl", iconDataUrl);
            obj.put("isSplit", pi.applicationInfo.splitPublicSourceDirs != null && pi.applicationInfo.splitPublicSourceDirs.length > 0);

            emitJs("window.__onApkPicked && window.__onApkPicked(" + obj.toString() + ")");
        } catch (Exception e) {
            emitJs("window.__onApkPickError && window.__onApkPickError(" + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
        }
    }

    /* ==================== İNDİRME, YÜKLEME & KURULUM ==================== */

    private void downloadApkInternal(String appId, String rawUrl, String fileName) {
        AtomicBoolean cancelFlag = new AtomicBoolean(false);
        AtomicBoolean oldFlag = downloadCancelFlags.put(appId, cancelFlag);
        if (oldFlag != null) oldFlag.set(true);

        File outFile = null;
        try {
            File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) dir = new File(getCacheDir(), "apks");
            if (!dir.exists()) dir.mkdirs();

            String safeName = (fileName != null && !fileName.trim().isEmpty())
                ? fileName.replaceAll("[^a-zA-Z0-9._-]", "_")
                : (appId + ".apk");
            if (!safeName.toLowerCase().endsWith(".apk")) safeName += ".apk";

            outFile = new File(dir, safeName);
            if (outFile.exists()) outFile.delete();

            Map<String, String> cookies = new LinkedHashMap<>();
            HttpURLConnection conn = openFollowingRedirects(rawUrl, cookies, 10, cancelFlag);

            String contentType = conn.getContentType();
            if (contentType != null && contentType.toLowerCase().contains("text/html")) {
                String html = readStreamLimited(conn.getInputStream(), 512 * 1024);
                conn.disconnect();
                String confirmedUrl = extractDriveConfirmUrl(html);
                if (confirmedUrl == null) {
                    throw new Exception("Google Drive dosyasına doğrudan erişilemedi. Dosya paylaşım iznini kontrol edin.");
                }
                conn = openFollowingRedirects(confirmedUrl, cookies, 10, cancelFlag);
                String secondType = conn.getContentType();
                if (secondType != null && secondType.toLowerCase().contains("text/html")) {
                    conn.disconnect();
                    throw new Exception("Google Drive indirme onayı geçilemedi veya dosya kotası aşıldı.");
                }
            }

            long totalBytes = conn.getContentLengthLong();
            long downloaded = 0;
            long lastEmitTime = 0;
            int lastPercent = -1;

            try (InputStream in = new BufferedInputStream(conn.getInputStream(), 32768);
                 FileOutputStream fos = new FileOutputStream(outFile)) {
                byte[] buffer = new byte[32768];
                int read;
                boolean checkedHeader = false;

                while ((read = in.read(buffer)) != -1) {
                    if (cancelFlag.get()) {
                        throw new InterruptedException("İndirme kullanıcı tarafından iptal edildi.");
                    }
                    if (!checkedHeader) {
                        checkedHeader = true;
                        if (read < 2 || buffer[0] != 0x50 || buffer[1] != 0x4B) {
                            throw new Exception("İndirilen dosya geçerli bir APK paketi değil.");
                        }
                    }
                    fos.write(buffer, 0, read);
                    downloaded += read;

                    int percent = totalBytes > 0 ? (int) Math.min(99, (downloaded * 100L) / totalBytes) : -1;
                    long now = System.currentTimeMillis();
                    if (now - lastEmitTime > 150 || (percent >= 0 && percent != lastPercent)) {
                        lastEmitTime = now;
                        lastPercent = percent;
                        emitJs("window.__onApkDownloadProgress && window.__onApkDownloadProgress("
                            + JSONObject.quote(appId) + ", " + percent + ", " + downloaded + ", " + totalBytes + ")");
                    }
                }
                fos.flush();
            } finally {
                conn.disconnect();
            }

            ApkMeta meta = extractApkMeta(outFile, false);

            emitJs("window.__onApkDownloadProgress && window.__onApkDownloadProgress("
                + JSONObject.quote(appId) + ", 100, " + downloaded + ", " + downloaded + ")");
            emitJs("window.__onApkDownloaded && window.__onApkDownloaded("
                + JSONObject.quote(appId) + ", "
                + JSONObject.quote(outFile.getAbsolutePath()) + ", "
                + JSONObject.quote(meta.packageName) + ", "
                + JSONObject.quote(meta.versionName) + ", "
                + meta.versionCode + ")");

            final File finalApk = outFile;
            runOnUiThread(() -> installApkFile(finalApk));

        } catch (InterruptedException ie) {
            if (outFile != null && outFile.exists()) outFile.delete();
            emitJs("window.__onApkDownloadCanceled && window.__onApkDownloadCanceled(" + JSONObject.quote(appId) + ")");
        } catch (Exception e) {
            if (outFile != null && outFile.exists()) outFile.delete();
            emitJs("window.__onApkDownloadError && window.__onApkDownloadError("
                + JSONObject.quote(appId) + ", " + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
        } finally {
            downloadCancelFlags.remove(appId, cancelFlag);
        }
    }

    private HttpURLConnection openFollowingRedirects(String targetUrl, Map<String, String> cookies, int maxRedirects, AtomicBoolean cancelFlag) throws Exception {
        String currentUrl = targetUrl;
        for (int i = 0; i <= maxRedirects; i++) {
            if (cancelFlag.get()) throw new InterruptedException("İptal edildi");
            URL url = new URL(currentUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(45000);
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 YMCStore/1.0");
            if (!cookies.isEmpty()) {
                StringBuilder cb = new StringBuilder();
                for (Map.Entry<String, String> entry : cookies.entrySet()) {
                    if (cb.length() > 0) cb.append("; ");
                    cb.append(entry.getKey()).append("=").append(entry.getValue());
                }
                conn.setRequestProperty("Cookie", cb.toString());
            }

            int code = conn.getResponseCode();
            List<String> setCookies = conn.getHeaderFields().get("Set-Cookie");
            if (setCookies != null) {
                for (String sc : setCookies) {
                    String pair = sc.split(";", 2)[0];
                    int eq = pair.indexOf('=');
                    if (eq > 0) {
                        cookies.put(pair.substring(0, eq).trim(), pair.substring(eq + 1).trim());
                    }
                }
            }

            if (code == HttpURLConnection.HTTP_MOVED_TEMP
                || code == HttpURLConnection.HTTP_MOVED_PERM
                || code == HttpURLConnection.HTTP_SEE_OTHER
                || code == 307 || code == 308) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null || location.isEmpty()) {
                    throw new Exception("Yönlendirme adresi boş.");
                }
                URL next = new URL(url, location);
                currentUrl = next.toString();
                continue;
            }
            if (code >= 400) {
                conn.disconnect();
                throw new Exception("Sunucu hatası (HTTP " + code + ")");
            }
            return conn;
        }
        throw new Exception("Çok fazla yönlendirme.");
    }

    private String readStreamLimited(InputStream is, int maxBytes) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int read;
        int total = 0;
        while ((read = is.read(buf)) != -1 && total < maxBytes) {
            baos.write(buf, 0, read);
            total += read;
        }
        return baos.toString(StandardCharsets.UTF_8.name());
    }

    private String extractDriveConfirmUrl(String html) {
        try {
            Pattern formPattern = Pattern.compile("<form[^>]*id=\"download-form\"[^>]*action=\"([^\"]+)\"([\\s\\S]*?)</form>", Pattern.CASE_INSENSITIVE);
            Matcher fm = formPattern.matcher(html);
            if (fm.find()) {
                String action = fm.group(1).replace("&amp;", "&");
                String inner = fm.group(2);
                StringBuilder query = new StringBuilder();
                Pattern inputPattern = Pattern.compile("<input[^>]*name=\"([^\"]+)\"[^>]*value=\"([^\"]*)\"[^>]*>", Pattern.CASE_INSENSITIVE);
                Matcher im = inputPattern.matcher(inner);
                while (im.find()) {
                    if (query.length() > 0) query.append("&");
                    query.append(URLEncoder.encode(im.group(1), "UTF-8"))
                         .append("=")
                         .append(URLEncoder.encode(im.group(2), "UTF-8"));
                }
                if (query.length() > 0) {
                    return action + (action.contains("?") ? "&" : "?") + query.toString();
                }
                return action;
            }

            Pattern confirmPattern = Pattern.compile("confirm=([0-9A-Za-z_\\-]+)");
            Matcher cm = confirmPattern.matcher(html);
            Pattern idPattern = Pattern.compile("id=([0-9A-Za-z_\\-]+)");
            Matcher idm = idPattern.matcher(html);
            if (cm.find() && idm.find()) {
                return "https://drive.usercontent.google.com/download?id=" + idm.group(1) + "&export=download&confirm=" + cm.group(1);
            }
        } catch (Exception ignored) {}
        return null;
    }

    private void installApkFile(File apkFile) {
        if (apkFile == null || !apkFile.exists()) return;
        if (!canRequestPackageInstallsCompat()) {
            pendingInstallFilePath = apkFile.getAbsolutePath();
            emitJs("window.__onApkNeedPermission && window.__onApkNeedPermission(" + JSONObject.quote(apkFile.getAbsolutePath()) + ")");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            }
            return;
        }
        launchSystemInstaller(apkFile);
    }

    private void launchSystemInstaller(File apkFile) {
        try {
            Uri apkUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apkFile);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception e) {
            emitJs("window.__onApkDownloadError && window.__onApkDownloadError('install', " + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
        }
    }

    private void uploadFileInternal(String uploadId, String uploadUrl, String localPath) {
        File file = new File(localPath);
        try {
            if (!file.exists()) throw new Exception("Yüklenecek geçici dosya bulunamadı.");
            long totalBytes = file.length();
            URL url = new URL(uploadUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("PUT");
            conn.setDoOutput(true);
            conn.setConnectTimeout(25000);
            conn.setReadTimeout(120000);
            conn.setFixedLengthStreamingMode(totalBytes);
            conn.setRequestProperty("Content-Type", "application/vnd.android.package-archive");

            long sent = 0;
            long lastEmit = 0;
            try (FileInputStream fis = new FileInputStream(file);
                 OutputStream os = conn.getOutputStream()) {
                byte[] buf = new byte[65536];
                int read;
                while ((read = fis.read(buf)) != -1) {
                    os.write(buf, 0, read);
                    sent += read;
                    long now = System.currentTimeMillis();
                    if (now - lastEmit > 150 || sent == totalBytes) {
                        lastEmit = now;
                        int pct = totalBytes > 0 ? (int) Math.min(99, (sent * 100L) / totalBytes) : 0;
                        emitJs("window.__onUploadProgress && window.__onUploadProgress("
                            + JSONObject.quote(uploadId) + ", " + pct + ", " + sent + ", " + totalBytes + ")");
                    }
                }
                os.flush();
            }

            int code = conn.getResponseCode();
            InputStream respStream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String respText = respStream != null ? readStreamLimited(respStream, 256 * 1024) : "{}";
            conn.disconnect();

            if (code < 200 || code >= 300) {
                throw new Exception("Drive yükleme hatası (HTTP " + code + "): " + respText);
            }

            try { file.delete(); } catch (Exception ignored) {}
            emitJs("window.__onUploadProgress && window.__onUploadProgress(" + JSONObject.quote(uploadId) + ", 100, " + totalBytes + ", " + totalBytes + ")");
            emitJs("window.__onUploadComplete && window.__onUploadComplete(" + JSONObject.quote(uploadId) + ", " + JSONObject.quote(respText) + ")");
        } catch (Exception e) {
            emitJs("window.__onUploadError && window.__onUploadError(" + JSONObject.quote(uploadId) + ", " + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
        }
    }

    private String computeSha1Fingerprint() {
        try {
            PackageManager pm = getPackageManager();
            Signature[] sigs = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageInfo info = pm.getPackageInfo(getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                SigningInfo si = info.signingInfo;
                if (si != null) {
                    sigs = si.hasMultipleSigners() ? si.getApkContentsSigners() : si.getSigningCertificateHistory();
                }
            } else {
                @SuppressWarnings("deprecation")
                PackageInfo info = pm.getPackageInfo(getPackageName(), PackageManager.GET_SIGNATURES);
                sigs = info.signatures;
            }
            if (sigs != null && sigs.length > 0) {
                MessageDigest md = MessageDigest.getInstance("SHA-1");
                byte[] digest = md.digest(sigs[0].toByteArray());
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < digest.length; i++) {
                    if (i > 0) sb.append(":");
                    sb.append(String.format("%02X", digest[i]));
                }
                return sb.toString();
            }
        } catch (Exception ignored) {}
        return "";
    }

    public class AndroidBridge {

        @JavascriptInterface
        public String getNativeInfo() {
            JSONObject info = new JSONObject();
            try {
                info.put("isNative", true);
                info.put("packageName", getPackageName());
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                info.put("versionName", pi.versionName != null ? pi.versionName : "1.0.0");
                long vc = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
                info.put("versionCode", vc);
                info.put("sha1", computeSha1Fingerprint());
                info.put("canInstallPackages", canRequestPackageInstallsCompat());
            } catch (Exception ignored) {}
            return info.toString();
        }

        @JavascriptInterface
        public void startGoogleSignIn(String webClientId) {
            runOnUiThread(() -> {
                try {
                    if (webClientId == null || webClientId.trim().isEmpty()) {
                        emitJs("window.__onNativeGoogleSignInError && window.__onNativeGoogleSignInError(-1, " + JSONObject.quote("Google Web Client ID ayarlanmamış. Kurulum bölümünden ekleyin.") + ")");
                        return;
                    }
                    GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                        .requestIdToken(webClientId.trim())
                        .requestEmail()
                        .build();
                    GoogleSignInClient client = GoogleSignIn.getClient(MainActivity.this, gso);
                    client.signOut().addOnCompleteListener(MainActivity.this, t -> {
                        googleSignInLauncher.launch(client.getSignInIntent());
                    });
                } catch (Exception e) {
                    emitJs("window.__onNativeGoogleSignInError && window.__onNativeGoogleSignInError(-1, " + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
                }
            });
        }

        @JavascriptInterface
        public void downloadAndInstallApk(String appId, String downloadUrl, String fileName) {
            executor.execute(() -> downloadApkInternal(appId, downloadUrl, fileName));
        }

        @JavascriptInterface
        public void cancelDownload(String appId) {
            AtomicBoolean flag = downloadCancelFlags.get(appId);
            if (flag != null) flag.set(true);
        }

        @JavascriptInterface
        public boolean canRequestPackageInstalls() {
            return canRequestPackageInstallsCompat();
        }

        @JavascriptInterface
        public void openInstallPermissionSettings() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                }
            });
        }

        @JavascriptInterface
        public String getInstalledAppsStatus(String packageNamesJson) {
            JSONObject result = new JSONObject();
            try {
                JSONArray arr = new JSONArray(packageNamesJson);
                PackageManager pm = getPackageManager();
                for (int i = 0; i < arr.length(); i++) {
                    String pkg = arr.optString(i, "").trim();
                    if (pkg.isEmpty()) continue;
                    JSONObject item = new JSONObject();
                    try {
                        PackageInfo pi = pm.getPackageInfo(pkg, 0);
                        item.put("installed", true);
                        item.put("versionName", pi.versionName != null ? pi.versionName : "");
                        long vc = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
                        item.put("versionCode", vc);
                    } catch (PackageManager.NameNotFoundException nnf) {
                        item.put("installed", false);
                    }
                    result.put(pkg, item);
                }
            } catch (Exception ignored) {}
            return result.toString();
        }

        @JavascriptInterface
        public String listInstalledUserApps() {
            List<JSONObject> items = new ArrayList<>();
            try {
                PackageManager pm = getPackageManager();
                List<PackageInfo> pkgs = pm.getInstalledPackages(0);
                String selfPkg = getPackageName();
                for (PackageInfo pi : pkgs) {
                    if (pi == null || pi.applicationInfo == null) continue;
                    ApplicationInfo ai = pi.applicationInfo;
                    if (selfPkg.equals(pi.packageName)) continue;
                    if ((ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0) continue;
                    if (ai.publicSourceDir == null) continue;
                    File apk = new File(ai.publicSourceDir);
                    if (!apk.exists()) continue;

                    CharSequence lbl = ai.loadLabel(pm);
                    String appName = lbl != null ? lbl.toString().trim() : pi.packageName;
                    if (appName.isEmpty()) appName = pi.packageName;
                    long vc = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
                    boolean isSplit = ai.splitPublicSourceDirs != null && ai.splitPublicSourceDirs.length > 0;

                    JSONObject obj = new JSONObject();
                    obj.put("appName", appName);
                    obj.put("packageName", pi.packageName);
                    obj.put("versionName", pi.versionName != null ? pi.versionName : "1.0");
                    obj.put("versionCode", vc);
                    obj.put("sizeBytes", apk.length());
                    obj.put("isSplit", isSplit);
                    items.add(obj);
                }
                final Collator trCollator = Collator.getInstance(new Locale("tr", "TR"));
                Collections.sort(items, (a, b) -> trCollator.compare(a.optString("appName", ""), b.optString("appName", "")));
            } catch (Exception ignored) {}

            JSONArray out = new JSONArray();
            for (JSONObject o : items) out.put(o);
            return out.toString();
        }

        @JavascriptInterface
        public void stageInstalledAppApk(String packageName) {
            executor.execute(() -> stageInstalledAppInternal(packageName));
        }

        @JavascriptInterface
        public boolean launchInstalledApp(String packageName) {
            try {
                Intent launchIntent = getPackageManager().getLaunchIntentForPackage(packageName);
                if (launchIntent != null) {
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(launchIntent);
                    return true;
                }
            } catch (Exception ignored) {}
            return false;
        }

        @JavascriptInterface
        public void uninstallApp(String packageName) {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_DELETE);
                    intent.setData(Uri.parse("package:" + packageName));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception ignored) {}
            });
        }

        @JavascriptInterface
        public void pickApkFile() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                apkPickerLauncher.launch(intent);
            });
        }

        @JavascriptInterface
        public void uploadLocalFileToUrl(String uploadId, String uploadUrl, String localPath) {
            executor.execute(() -> uploadFileInternal(uploadId, uploadUrl, localPath));
        }
    }
}
