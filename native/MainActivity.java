package com.erhan.apkfabrika;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String PREF_NAME = "SMS_FILTER_STORE";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // WebView yuklendiginde JS Arayuzunu enjekte et
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

        }, "AndroidBridge");
    }
}
