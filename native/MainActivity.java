package com.erhan.apkfabrika;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
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

        }, "AndroidBridge");
    }
}
