package com.erhan.apkfabrika;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.ContactsContract;
import android.telephony.SmsManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String PREF_NAME = "SMS_FILTER_STORE";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = this.getBridge().getWebView();
        webView.addJavascriptInterface(new Object() {
            
            @JavascriptInterface
            public String getMessages(String key) {
                SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                return prefs.getString(key, "[]");
            }

            @JavascriptInterface
            public void saveRules(String rulesJson) {
                SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                prefs.edit().putString("rules", rulesJson).apply();
            }

            @JavascriptInterface
            public void clearMessages(String key) {
                SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                prefs.edit().putString(key, "[]").apply();
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

                    prefs.edit().putString(key, newArray.toString()).apply();
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

                    for (int i = 0; i < array.length(); i++) {
                        JSONObject obj = array.getJSONObject(i);
                        long curId = obj.optLong("id");
                        boolean match = false;
                        for (int j = 0; j < idsArray.length(); j++) {
                            if (idsArray.getLong(j) == curId) {
                                match = true;
                                break;
                            }
                        }
                        if (!match) {
                            newArray.put(obj);
                        }
                    }

                    prefs.edit().putString(key, newArray.toString()).apply();
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
                        return true;
                    }
                    return false;
                } catch (Exception e) {
                    return false;
                }
            }

            @JavascriptInterface
            public boolean sendSms(String phoneNumber, String message) {
                try {
                    SmsManager smsManager = SmsManager.getDefault();
                    smsManager.sendTextMessage(phoneNumber, null, message, null, null);

                    SharedPreferences prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                    String sentData = prefs.getString("sent_messages", "[]");
                    JSONArray sentArray = new JSONArray(sentData);

                    JSONObject sentObj = new JSONObject();
                    sentObj.put("id", System.currentTimeMillis());
                    sentObj.put("recipient", phoneNumber);
                    sentObj.put("body", message);
                    
                    SimpleDateFormat sdf = new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault());
                    sentObj.put("date", sdf.format(new Date()));

                    sentArray.put(sentObj);
                    prefs.edit().putString("sent_messages", sentArray.toString()).apply();

                    return true;
                } catch (Exception e) {
                    e.printStackTrace();
                    return false;
                }
            }

            @JavascriptInterface
            public String getContactName(String phoneNumber) {
                if (phoneNumber == null || phoneNumber.trim().isEmpty()) {
                    return "";
                }
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
                } catch (Exception e) {
                    e.printStackTrace();
                }
                return "";
            }

            @JavascriptInterface
            public String getAllContacts() {
                JSONArray contacts = new JSONArray();
                try {
                    ContentResolver cr = getContentResolver();
                    Cursor cursor = cr.query(
                        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                        new String[]{
                            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                            ContactsContract.CommonDataKinds.Phone.NUMBER
                        },
                        null, null,
                        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
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
                } catch (Exception e) {
                    e.printStackTrace();
                }
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

                    JSONArray inboxArray = new JSONArray(prefs.getString("inbox_messages", "[]"));
                    JSONArray sentArray = new JSONArray(prefs.getString("sent_messages", "[]"));
                    JSONArray spamArray = new JSONArray(prefs.getString("spam_messages", "[]"));

                    ContentResolver cr = getContentResolver();
                    Cursor cursor = cr.query(Uri.parse("content://sms"), null, null, null, "date DESC LIMIT 150");

                    if (cursor != null && cursor.moveToFirst()) {
                        int addressIdx = cursor.getColumnIndex("address");
                        int bodyIdx = cursor.getColumnIndex("body");
                        int dateIdx = cursor.getColumnIndex("date");
                        int typeIdx = cursor.getColumnIndex("type");

                        SimpleDateFormat sdf = new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault());

                        do {
                            String address = cursor.getString(addressIdx);
                            String body = cursor.getString(bodyIdx);
                            long timestamp = cursor.getLong(dateIdx);
                            int type = cursor.getInt(typeIdx);

                            if (address == null || body == null) continue;

                            String formattedDate = sdf.format(new Date(timestamp));

                            if (type == 2) {
                                JSONObject sentItem = new JSONObject();
                                sentItem.put("id", timestamp);
                                sentItem.put("recipient", address);
                                sentItem.put("body", body);
                                sentItem.put("date", formattedDate);
                                sentArray.put(sentItem);
                                importedCount++;
                            } else {
                                boolean isSpam = false;
                                String reason = "";

                                if (blockedTitles != null) {
                                    for (int i = 0; i < blockedTitles.length(); i++) {
                                        if (address.toUpperCase().contains(blockedTitles.getString(i))) {
                                            isSpam = true;
                                            reason = "Baslik eslesmesi: " + blockedTitles.getString(i);
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
                                                reason = "Engelli B-Kodu: " + foundCode;
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

                } catch (Exception e) {
                    e.printStackTrace();
                }
                return importedCount;
            }

        }, "AndroidBridge");
    }
}
