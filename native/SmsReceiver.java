package com.erhan.apkfabrika;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "SmsReceiver";
    private static final String PREF_NAME = "SMS_FILTER_STORE";

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, ">>> SMS RECEIVER TETIKLENDI! Eylem: " + intent.getAction());

        Bundle bundle = intent.getExtras();
        if (bundle == null) return;

        // 1. Manuel testten mi geliyor?
        String sender = bundle.getString("sender");
        String body = bundle.getString("body");

        if (sender != null || body != null) {
            isleSms(context, sender, body);
            return;
        }

        // 2. Gercek sebekeden gelen SMS paketleri
        Object[] pdus = (Object[]) bundle.get("pdus");
        String format = bundle.getString("format");

        if (pdus != null) {
            for (Object pdu : pdus) {
                SmsMessage sms;
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                    sms = SmsMessage.createFromPdu((byte[]) pdu, format);
                } else {
                    sms = SmsMessage.createFromPdu((byte[]) pdu);
                }

                if (sms != null) {
                    isleSms(context, sms.getDisplayOriginatingAddress(), sms.getMessageBody());
                }
            }
        }
    }

    private void isleSms(Context context, String sender, String body) {
        if (sender == null) sender = "Bilinmeyen";
        if (body == null) body = "";

        sender = sender.trim();
        body = body.trim();

        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        String rulesJson = prefs.getString("rules", "{\"titles\":[\"BAHIS\",\"BET\",\"KASINO\"], \"bcodes\":[\"B214\",\"B002\"]}");

        boolean engellendi = false;
        String engelSebebi = "";

        try {
            JSONObject rules = new JSONObject(rulesJson);
            JSONArray titles = rules.optJSONArray("titles");
            JSONArray bcodes = rules.optJSONArray("bcodes");

            // Baslik kontrolu
            if (titles != null) {
                for (int i = 0; i < titles.length(); i++) {
                    String titleRule = titles.getString(i).trim();
                    if (!titleRule.isEmpty() && sender.toUpperCase().contains(titleRule.toUpperCase())) {
                        engellendi = true;
                        engelSebebi = "Baslik eslesmesi: " + titleRule;
                        break;
                    }
                }
            }

            // B-Kodu kontrolu (Mesaj icinden B123 formatindaki kodlari ceker)
            if (!engellendi && bcodes != null) {
                Pattern pattern = Pattern.compile("\\bB\\d{3}\\b", Pattern.CASE_INSENSITIVE);
                Matcher matcher = pattern.matcher(body);
                while (matcher.find()) {
                    String foundCode = matcher.group().toUpperCase();
                    for (int j = 0; j < bcodes.length(); j++) {
                        String bcodeRule = bcodes.getString(j).trim().toUpperCase();
                        if (foundCode.equals(bcodeRule)) {
                            engellendi = true;
                            engelSebebi = "B-Kodu eslesmesi: " + bcodeRule;
                            break;
                        }
                    }
                    if (engellendi) break;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Kural ayrirma hatasi: " + e.getMessage());
        }

        // Guvenlik onlemi: Linkleri zararsiz hale getir (http:// -> [LINK DEVRE DISI])
        String guvenliIcerik = body.replaceAll("(?i)https?://\\S+", "[BAGLANTI ETKISIZLESTIRILDI]");

        try {
            JSONObject smsObj = new JSONObject();
            smsObj.put("id", System.currentTimeMillis());
            smsObj.put("sender", sender);
            smsObj.put("body", guvenliIcerik);
            smsObj.put("originalBody", body);
            smsObj.put("date", new java.text.SimpleDateFormat("dd.MM.yyyy HH:mm").format(new java.util.Date()));
            smsObj.put("reason", engelSebebi);

            String listKey = engellendi ? "spam_messages" : "inbox_messages";
            String currentList = prefs.getString(listKey, "[]");
            JSONArray arr = new JSONArray(currentList);
            arr.put(smsObj);

            prefs.edit().putString(listKey, arr.toString()).apply();

            if (engellendi) {
                Log.d(TAG, "[ENGELLENDI] Gonderici: " + sender + " | Sebep: " + engelSebebi);
            } else {
                Log.d(TAG, "[GELEN KUTUSU] Gonderici: " + sender);
            }
        } catch (Exception e) {
            Log.e(TAG, "Mesaj kaydetme hatasi: " + e.getMessage());
        }
    }
}
