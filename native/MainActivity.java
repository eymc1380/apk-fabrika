package com.erhan.apkfabrika;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.ContactsContract;
import android.telephony.SmsManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String PREF_NAME = "SMS_FILTER_STORE";
    private static final String BACKUP_DIR_NAME = "SmsFilterBackup";
    private static final String BACKUP_FILE_NAME = "backup_data.json";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        restoreFromPersistentFile();

        WebView webView = this.getBridge().getWebView();
        webView.addJavascriptInterface(new Object() {
            
            @JavascriptInterface
            public String getMessages(String key) {
                SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                return prefs.getString(key, "[]");
            }

            @JavascriptInterface
            public void saveStoreData(String key, String value) {
                SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                prefs.edit().putString(key, value).apply();
                saveToPersistentFile();
            }

            @JavascriptInterface
            public boolean deleteMessage(String key, long messageId) {
                try {
                    SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                    String data = prefs.getString(key, "[]");
                    JSONArray array = new JSONArray(data);
                    JSONArray newArray = new JSONArray();

                    for (int i = 0; i < array.length(); i++) {
                        JSONObject obj = array.getJSONObject(i);
                        if (obj.optLong("id") != messageId) {
                            newArray.put(obj);
                        }
                    }

                    // Silinen ID'yi kara listeye ekle
                    addToDeletedBlacklist(messageId);
                    // Sistem SMS veritabanindan da temizlemeyi dene
                    deleteSystemSms(messageId);

                    prefs.edit().putString(key, newArray.toString()).apply();
                    saveToPersistentFile();
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }

            @JavascriptInterface
            public boolean deleteMessagesBulk(String key, String idsJson) {
                try {
                    SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                    String data = prefs.getString(key, "[]");
                    JSONArray array = new JSONArray(data);
                    JSONArray idsArray = new JSONArray(idsJson);
                    JSONArray newArray = new JSONArray();

                    Set<Long> toDelete = new HashSet<>();
                    for (int j = 0; j < idsArray.length(); j++) {
                        toDelete.add(idsArray.getLong(j));
                        addToDeletedBlacklist(idsArray.getLong(j));
                        deleteSystemSms(idsArray.getLong(j));
                    }

                    for (int i = 0; i < array.length(); i++) {
                        JSONObject obj = array.getJSONObject(i);
                        if (!toDelete.contains(obj.optLong("id"))) {
                            newArray.put(obj);
                        }
                    }

                    prefs.edit().putString(key, newArray.toString()).apply();
                    saveToPersistentFile();
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }

            @JavascriptInterface
            public boolean moveMessage(String fromKey, String toKey, long messageId) {
                try {
                    SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                    JSONArray fromArr = new JSONArray(prefs.getString(fromKey, "[]"));
                    JSONArray toArr = new JSONArray(prefs.getString(toKey, "[]"));
                    JSONArray newFromArr = new JSONArray();

                    JSONObject targetObj = null;
                    for (int i = 0; i < fromArr.length(); i++) {
                        JSONObject obj = fromArr.getJSONObject(i);
                        if (obj.optLong("id") == messageId) {
                            targetObj = obj;
                        } else {
                            newFromArr.put(obj);
                        }
                    }

                    if (targetObj != null) {
                        toArr.put(targetObj);
                        prefs.edit()
                            .putString(fromKey, newFromArr.toString())
                            .putString(toKey, toArr.toString())
                            .apply();
                        saveToPersistentFile();
                        return true;
                    }
                    return false;
                } catch (Exception e) {
                    return false;
                }
            }

            @JavascriptInterface
            public String getActiveSimSlots() {
                JSONArray simArray = new JSONArray();
                try {
                    SubscriptionManager sm = (SubscriptionManager) getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
                    List<SubscriptionInfo> infoList = sm.getActiveSubscriptionInfoList();
                    if (infoList != null) {
                        for (SubscriptionInfo info : infoList) {
                            JSONObject simObj = new JSONObject();
                            simObj.put("subId", info.getSubscriptionId());
                            simObj.put("slotIndex", info.getSimSlotIndex() + 1);
                            CharSequence carrier = info.getCarrierName();
                            simObj.put("carrier", carrier != null ? carrier.toString() : ("SIM " + (info.getSimSlotIndex() + 1)));
                            simArray.put(simObj);
                        }
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
                return simArray.toString();
            }

            @JavascriptInterface
            public boolean sendSms(String phoneNumber, String message, int subId) {
                try {
                    SmsManager smsManager;
                    if (subId > 0 && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP_MR1) {
                        smsManager = SmsManager.getSmsManagerForSubscriptionId(subId);
                    } else {
                        smsManager = SmsManager.getDefault();
                    }
                    smsManager.sendTextMessage(phoneNumber, null, message, null, null);

                    SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                    String sentData = prefs.getString("sent_messages", "[]");
                    JSONArray sentArray = new JSONArray(sentData);

                    JSONObject sentObj = new JSONObject();
                    sentObj.put("id", System.currentTimeMillis());
                    sentObj.put("recipient", phoneNumber);
                    sentObj.put("body", message);
                    sentObj.put("simSlot", subId > 0 ? ("SIM " + subId) : "SIM 1");
                    
                    SimpleDateFormat sdf = new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault());
                    sentObj.put("date", sdf.format(new Date()));

                    sentArray.put(sentObj);
                    prefs.edit().putString("sent_messages", sentArray.toString()).apply();
                    saveToPersistentFile();
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }

            @JavascriptInterface
            public String getContactName(String phoneNumber) {
                if (phoneNumber == null || phoneNumber.trim().isEmpty()) return "";
                try {
                    ContentResolver cr = getContentResolver();
                    Uri uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(phoneNumber));
                    Cursor cursor = cr.query(uri, new String[]{ContactsContract.PhoneLookup.DISPLAY_NAME}, null, null, null);
                    if (cursor != null) {
                        if (cursor.moveToFirst()) {
                            int nameIndex = cursor.getColumnIndex(ContactsContract.PhoneLookup.DISPLAY_NAME);
                            if (nameIndex != -1) {
                                String name = cursor.getString(nameIndex);
                                cursor.close();
                                return name != null ? name : "";
                            }
                        }
                        cursor.close();
                    }
                } catch (Exception e) {}
                return "";
            }

            @JavascriptInterface
            public String getAllContacts() {
                JSONArray contacts = new JSONArray();
                try {
                    ContentResolver cr = getContentResolver();
                    Cursor cursor = cr.query(
                        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                        new String[]{ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER},
                        null, null, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
                    );
                    if (cursor != null) {
                        while (cursor.moveToNext()) {
                            int nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                            int numIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                            if (nameIdx != -1 && numIdx != -1) {
                                String name = cursor.getString(nameIdx);
                                String number = cursor.getString(numIdx);
                                if (name != null && number != null) {
                                    JSONObject c = new JSONObject();
                                    c.put("name", name);
                                    c.put("phone", number.replaceAll("\\s+", ""));
                                    contacts.put(c);
                                }
                            }
                        }
                        cursor.close();
                    }
                } catch (Exception e) {}
                return contacts.toString();
            }

            @JavascriptInterface
            public int syncDeviceSms() {
                int importedCount = 0;
                try {
                    SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                    String rulesJson = prefs.getString("rules", "{\"titles\":[\"BAHIS\",\"BET\",\"KASINO\"],\"bcodes\":[\"B214\",\"B002\"]}");
                    JSONObject rulesObj = new JSONObject(rulesJson);
                    JSONArray blockedTitles = rulesObj.optJSONArray("titles");
                    JSONArray blockedBcodes = rulesObj.optJSONArray("bcodes");

                    // Silinmis ID'leri al
                    Set<Long> deletedSet = getDeletedBlacklist();

                    JSONArray inboxArray = new JSONArray(prefs.getString("inbox_messages", "[]"));
                    JSONArray sentArray = new JSONArray(prefs.getString("sent_messages", "[]"));
                    JSONArray spamArray = new JSONArray(prefs.getString("spam_messages", "[]"));

                    ContentResolver cr = getContentResolver();
                    Cursor cursor = cr.query(Uri.parse("content://sms"), null, null, null, "date DESC LIMIT 300");

                    if (cursor != null && cursor.moveToFirst()) {
                        int addressIdx = cursor.getColumnIndex("address");
                        int bodyIdx = cursor.getColumnIndex("body");
                        int dateIdx = cursor.getColumnIndex("date");
                        int typeIdx = cursor.getColumnIndex("type");
                        int subIdIdx = cursor.getColumnIndex("sub_id");

                        SimpleDateFormat sdf = new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault());

                        do {
                            long timestamp = cursor.getLong(dateIdx);

                            // KULLANICI BU MESAJI DAHA ONCE SILDIYSE KESINLIKLE ATLA
                            if (deletedSet.contains(timestamp)) {
                                continue;
                            }

                            // Zaten yerel listede varsa atla
                            if (isAlreadyExists(inboxArray, timestamp) || isAlreadyExists(sentArray, timestamp) || isAlreadyExists(spamArray, timestamp)) {
                                continue;
                            }

                            String address = cursor.getString(addressIdx);
                            String body = cursor.getString(bodyIdx);
                            int type = cursor.getInt(typeIdx);
                            int subId = subIdIdx != -1 ? cursor.getInt(subIdIdx) : 1;

                            if (address == null || body == null) continue;

                            String simTag = "SIM " + (subId <= 1 ? "1" : "2");
                            String formattedDate = sdf.format(new Date(timestamp));

                            if (type == 2) {
                                JSONObject sentItem = new JSONObject();
                                sentItem.put("id", timestamp);
                                sentItem.put("recipient", address);
                                sentItem.put("body", body);
                                sentItem.put("date", formattedDate);
                                sentItem.put("simSlot", simTag);
                                sentArray.put(sentItem);
                                importedCount++;
                            } else {
                                boolean isSpam = false;
                                String reason = "";

                                if (blockedTitles != null) {
                                    for (int i = 0; i < blockedTitles.length(); i++) {
                                        if (address.toUpperCase().contains(blockedTitles.getString(i))) {
                                            isSpam = true;
                                            reason = "Baslik: " + blockedTitles.getString(i);
                                            break;
                                        }
                                    }
                                }

                                if (!isSpam && blockedBcodes != null) {
                                    Pattern bCodePattern = Pattern.compile("(?i)(B\\d{3})\\b");
                                    Matcher matcher = bCodePattern.matcher(body);
                                    while (matcher.find()) {
                                        String foundCode = matcher.group(1).toUpperCase();
                                        for (int i = 0; i < blockedBcodes.length(); i++) {
                                            if (foundCode.equals(blockedBcodes.getString(i))) {
                                                isSpam = true;
                                                reason = "B-Kodu: " + foundCode;
                                                break;
                                            }
                                        }
                                        if (isSpam) break;
                                    }
                                }

                                JSONObject msg = new JSONObject();
                                msg.put("id", timestamp);
                                msg.put("sender", address);
                                msg.put("body", isSpam ? body.replaceAll("https?://\\S+", "[BAGLANTI ETKISIZLESTIRILDI]") : body);
                                msg.put("date", formattedDate);
                                msg.put("simSlot", simTag);

                                if (isSpam) {
                                    msg.put("reason", reason);
                                    spamArray.put(msg);
                                } else {
                                    inboxArray.put(msg);
                                }
                                importedCount++;
                            }

                        } while (cursor.moveToNext());
                        cursor.close();
                    }

                    prefs.edit()
                        .putString("inbox_messages", inboxArray.toString())
                        .putString("sent_messages", sentArray.toString())
                        .putString("spam_messages", spamArray.toString())
                        .apply();

                    saveToPersistentFile();
                } catch (Exception e) {
                    e.printStackTrace();
                }
                return importedCount;
            }

        }, "AndroidBridge");
    }

    private void deleteSystemSms(long timestamp) {
        try {
            getContentResolver().delete(Uri.parse("content://sms"), "date=?", new String[]{String.valueOf(timestamp)});
        } catch (Exception e) {}
    }

    private void addToDeletedBlacklist(long id) {
        SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        String current = prefs.getString("deleted_ids", "[]");
        try {
            JSONArray arr = new JSONArray(current);
            arr.put(id);
            prefs.edit().putString("deleted_ids", arr.toString()).apply();
        } catch(Exception e) {}
    }

    private Set<Long> getDeletedBlacklist() {
        Set<Long> set = new HashSet<>();
        SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        try {
            JSONArray arr = new JSONArray(prefs.getString("deleted_ids", "[]"));
            for (int i = 0; i < arr.length(); i++) {
                set.add(arr.getLong(i));
            }
        } catch(Exception e) {}
        return set;
    }

    private boolean isAlreadyExists(JSONArray array, long id) {
        for (int i = 0; i < array.length(); i++) {
            JSONObject obj = array.optJSONObject(i);
            if (obj != null && obj.optLong("id") == id) return true;
        }
        return false;
    }

    private synchronized void saveToPersistentFile() {
        try {
            File docsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
            File backupDir = new File(docsDir, BACKUP_DIR_NAME);
            if (!backupDir.exists()) backupDir.mkdirs();

            File file = new File(backupDir, BACKUP_FILE_NAME);
            SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);

            JSONObject root = new JSONObject();
            root.put("rules", prefs.getString("rules", ""));
            root.put("inbox_messages", prefs.getString("inbox_messages", "[]"));
            root.put("sent_messages", prefs.getString("sent_messages", "[]"));
            root.put("spam_messages", prefs.getString("spam_messages", "[]"));
            root.put("deleted_ids", prefs.getString("deleted_ids", "[]"));
            root.put("categories", prefs.getString("categories", "[]")); // Dinamik Sekmeler

            FileOutputStream fos = new FileOutputStream(file);
            fos.write(root.toString().getBytes("UTF-8"));
            fos.flush();
            fos.close();
        } catch (Exception e) {}
    }

    private synchronized void restoreFromPersistentFile() {
        try {
            File docsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
            File backupDir = new File(docsDir, BACKUP_DIR_NAME);
            File file = new File(backupDir, BACKUP_FILE_NAME);

            if (!file.exists()) return;

            FileInputStream fis = new FileInputStream(file);
            byte[] data = new byte[(int) file.length()];
            fis.read(data);
            fis.close();

            JSONObject root = new JSONObject(new String(data, "UTF-8"));
            SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();

            if (root.has("rules")) editor.putString("rules", root.getString("rules"));
            if (root.has("inbox_messages")) editor.putString("inbox_messages", root.getString("inbox_messages"));
            if (root.has("sent_messages")) editor.putString("sent_messages", root.getString("sent_messages"));
            if (root.has("spam_messages")) editor.putString("spam_messages", root.getString("spam_messages"));
            if (root.has("deleted_ids")) editor.putString("deleted_ids", root.getString("deleted_ids"));
            if (root.has("categories")) editor.putString("categories", root.getString("categories"));
            editor.apply();
        } catch (Exception e) {}
    }
}
