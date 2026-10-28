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
        if ("android.provider.Telephony.SMS_DELIVER".equals(intent.getAction()) ||
            "android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) {

            Bundle bundle = intent.getExtras();
            if (bundle != null) {
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

                        String sender = sms.getDisplayOriginatingAddress();
                        String messageBody = sms.getMessageBody();

                        Log.d(TAG, "Gelen SMS Basligi: " + sender);
                        Log.d(TAG, "Mesaj Icerigi: " + messageBody);

                        // Ilerleyen adimda filtre kontrolunu buraya baglayacagiz
                    }
                }
            }
        }
    }
}
