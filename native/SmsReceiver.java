package com.erhan.apkfabrika;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.util.Log;

public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "SmsReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, ">>> SMS RECEIVER TETIKLENDI! Eylem: " + intent.getAction());

        Bundle bundle = intent.getExtras();
        if (bundle == null) {
            Log.d(TAG, "Veri paketi (bundle) bos geldi.");
            return;
        }

        // 1. Manuel terminal testinden gelen verileri yakala
        String testSender = bundle.getString("sender");
        String testBody = bundle.getString("body");
        if (testSender != null || testBody != null) {
            Log.d(TAG, "[TEST SMS] Gonderici: " + testSender + " | Mesaj: " + testBody);
            return;
        }

        // 2. Gercek sebekeden gelen PDU paketlerini isle
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
                    String sender = sms.getDisplayOriginatingAddress();
                    String messageBody = sms.getMessageBody();

                    Log.d(TAG, "[GERCEK SMS] Gonderici: " + sender);
                    Log.d(TAG, "[GERCEK SMS] Mesaj: " + messageBody);
                }
            }
        }
    }
}
