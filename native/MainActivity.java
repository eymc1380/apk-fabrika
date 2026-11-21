package com.erhan.apkfabrika;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String PREF_NAME = "SEHIR_REHBERI_STORE";
    private static final String KEY_GUIDE_DATA = "guide_data_json";
    private static final String BACKUP_DIR_NAME = "SehirRehberiBackup";
    private static final String PRIMARY_BACKUP_FILE = "rehber_yedek.json";
    private static final int REQ_STORAGE_PERM = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestStoragePermissionIfNeeded();
        restoreFromPersistentFileIfPrefsEmpty();

        WebView webView = this.getBridge().getWebView();
        webView.addJavascriptInterface(new Object() {

            @JavascriptInterface
            public String loadGuideData() {
                // Önce telefondaki kalıcı dosyadan okumayı dene (uygulama silinip yüklense bile kurtarır)
                String fileData = readFileSafe(getPrimaryBackupFile());
                if (fileData != null && !fileData.trim().isEmpty()) {
                    SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                    prefs.edit().putString(KEY_GUIDE_DATA, fileData).apply();
                    return fileData;
                }
                // İkincil uygulama içi harici klasörden dene
                String appFileData = readFileSafe(getAppBackupFile());
                if (appFileData != null && !appFileData.trim().isEmpty()) {
                    return appFileData;
                }
                // Son çare SharedPreferences
                SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                return prefs.getString(KEY_GUIDE_DATA, "");
            }

            @JavascriptInterface
            public boolean saveGuideData(String json) {
                if (json == null) return false;
                try {
                    SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                    prefs.edit().putString(KEY_GUIDE_DATA, json).apply();

                    boolean publicSaved = writeFileSafe(getPrimaryBackupFile(), json);
                    boolean appSaved = writeFileSafe(getAppBackupFile(), json);
                    return publicSaved || appSaved;
                } catch (Exception e) {
                    return false;
                }
            }

            @JavascriptInterface
            public String createManualBackup(String json) {
                try {
                    if (json == null || json.trim().isEmpty()) {
                        json = loadGuideData();
                    }
                    String timestamp = new SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.getDefault()).format(new Date());
                    String fileName = "yedek_" + timestamp + ".json";

                    File dir = getBackupDirectory();
                    if (!dir.exists()) dir.mkdirs();

                    File snapshot = new File(dir, fileName);
                    if (writeFileSafe(snapshot, json)) {
                        writeFileSafe(getPrimaryBackupFile(), json);
                        return snapshot.getAbsolutePath();
                    }
                    // Fallback to app external dir
                    File appDir = getAppBackupDirectory();
                    if (!appDir.exists()) appDir.mkdirs();
                    File appSnap = new File(appDir, fileName);
                    if (writeFileSafe(appSnap, json)) {
                        return appSnap.getAbsolutePath();
                    }
                    return "";
                } catch (Exception e) {
                    return "";
                }
            }

            @JavascriptInterface
            public String listBackupFiles() {
                JSONArray list = new JSONArray();
                try {
                    File dir = getBackupDirectory();
                    if (!dir.exists()) dir = getAppBackupDirectory();
                    File[] files = dir.listFiles();
                    if (files != null) {
                        Arrays.sort(files, new Comparator<File>() {
                            @Override
                            public int compare(File f1, File f2) {
                                return Long.compare(f2.lastModified(), f1.lastModified());
                            }
                        });
                        SimpleDateFormat sdf = new SimpleDateFormat("dd.MM.yyyy HH:mm:ss", Locale.getDefault());
                        for (File f : files) {
                            if (f.isFile() && f.getName().endsWith(".json")) {
                                JSONObject obj = new JSONObject();
                                obj.put("name", f.getName());
                                obj.put("path", f.getAbsolutePath());
                                obj.put("size", f.length());
                                obj.put("date", sdf.format(new Date(f.lastModified())));
                                list.put(obj);
                            }
                        }
                    }
                } catch (Exception e) {}
                return list.toString();
            }

            @JavascriptInterface
            public String restoreBackupFile(String fileName) {
                try {
                    File f = new File(getBackupDirectory(), fileName);
                    if (!f.exists()) {
                        f = new File(getAppBackupDirectory(), fileName);
                    }
                    if (!f.exists()) return "";
                    String content = readFileSafe(f);
                    if (content != null && !content.trim().isEmpty()) {
                        saveGuideData(content);
                        return content;
                    }
                } catch (Exception e) {}
                return "";
            }

            @JavascriptInterface
            public String getBackupDirectoryPath() {
                File dir = getBackupDirectory();
                return dir.getAbsolutePath();
            }

            @JavascriptInterface
            public void openExternalUrl(String url) {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {}
            }

            @JavascriptInterface
            public void copyToClipboard(String text) {
                try {
                    ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    ClipData clip = ClipData.newPlainText("Konum", text);
                    if (clipboard != null) clipboard.setPrimaryClip(clip);
                } catch (Exception e) {}
            }

        }, "AndroidBridge");
    }

    private void requestStoragePermissionIfNeeded() {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {
            boolean readOk = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
            boolean writeOk = ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
            if (!readOk || !writeOk) {
                ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE},
                    REQ_STORAGE_PERM);
            }
        }
    }

    private File getBackupDirectory() {
        File docsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
        File backupDir = new File(docsDir, BACKUP_DIR_NAME);
        if (!backupDir.exists()) backupDir.mkdirs();
        return backupDir;
    }

    private File getPrimaryBackupFile() {
        return new File(getBackupDirectory(), PRIMARY_BACKUP_FILE);
    }

    private File getAppBackupDirectory() {
        File extDocs = getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
        if (extDocs == null) extDocs = getFilesDir();
        File dir = new File(extDocs, BACKUP_DIR_NAME);
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private File getAppBackupFile() {
        return new File(getAppBackupDirectory(), PRIMARY_BACKUP_FILE);
    }

    private synchronized boolean writeFileSafe(File file, String content) {
        try {
            File parent = file.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();
            FileOutputStream fos = new FileOutputStream(file);
            fos.write(content.getBytes("UTF-8"));
            fos.flush();
            fos.close();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private synchronized String readFileSafe(File file) {
        try {
            if (file == null || !file.exists() || !file.isFile()) return "";
            FileInputStream fis = new FileInputStream(file);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int len;
            while ((len = fis.read(buffer)) != -1) {
                bos.write(buffer, 0, len);
            }
            fis.close();
            return bos.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    private void restoreFromPersistentFileIfPrefsEmpty() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String current = prefs.getString(KEY_GUIDE_DATA, "");
            if (current == null || current.trim().isEmpty()) {
                String fromFile = readFileSafe(getPrimaryBackupFile());
                if (fromFile != null && !fromFile.trim().isEmpty()) {
                    prefs.edit().putString(KEY_GUIDE_DATA, fromFile).apply();
                }
            }
        } catch (Exception e) {}
    }
}
