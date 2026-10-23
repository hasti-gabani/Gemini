package com.gemini.bills;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Gemini on the phone: shows Gemini from the PC (same Wi-Fi) and gives the page a bridge
 * (window.GeminiAndroid) so Share → WhatsApp opens this phone's WhatsApp straight in the party's
 * chat with the bill PDF attached. Only the Send tap is left (Android lets no app press Send).
 */
public class MainActivity extends Activity {
    private static final String PREFS = "gemini";
    private static final String KEY_SERVER = "server";
    private static final int APP_PORT = 3100;

    private WebView web;
    private boolean asking;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSupportMultipleWindows(false); // window.open(...) loads here; outside links go to their apps
        settings.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new Bridge(), "GeminiAndroid");
        web.setWebViewClient(new Client());

        if (state != null) web.restoreState(state);
        else if (server().isEmpty()) askServer(null);
        else load();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    // ------------------------------------------------------------------ the PC's address

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private String server() {
        return prefs().getString(KEY_SERVER, "");
    }

    private String home() {
        return "http://" + server() + ":" + APP_PORT + "/";
    }

    private void load() {
        web.loadUrl(home());
    }

    /** Ask for the PC's Wi-Fi address, shown by "Start Gemini.bat" (it changes with the Wi-Fi). */
    private void askServer(String problem) {
        if (asking || isFinishing()) return;
        asking = true;
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(server().isEmpty() ? Defaults.SERVER : server());
        input.setSelectAllOnFocus(true);
        String message = (problem == null ? "" : problem + "\n\n")
                + "Enter the computer's Wi-Fi address shown by \"Start Gemini.bat\" (for example 192.168.1.20). "
                + "The phone must be on the same Wi-Fi.";
        new AlertDialog.Builder(this)
                .setTitle("Gemini computer address")
                .setMessage(message)
                .setView(input)
                .setCancelable(false)
                .setPositiveButton("Open", (dialog, which) -> {
                    asking = false;
                    String value = input.getText().toString().trim()
                            .replaceFirst("^https?://", "").replaceFirst("[:/].*$", "");
                    if (value.isEmpty()) {
                        askServer("Please enter the address.");
                        return;
                    }
                    prefs().edit().putString(KEY_SERVER, value).apply();
                    load();
                })
                .setNegativeButton(server().isEmpty() ? "Close" : "Try again", (dialog, which) -> {
                    asking = false;
                    if (server().isEmpty()) finish();
                    else load();
                })
                .show();
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            String scheme = url.getScheme() == null ? "" : url.getScheme();
            boolean ours = (scheme.equals("http") || scheme.equals("https")) && server().equals(url.getHost());
            if (ours) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url)); // wa.me, tel:, sms:, other sites
            } catch (ActivityNotFoundException ignored) {
                toast("No app can open this link.");
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                askServer("Could not reach Gemini at " + server() + ". Check that the computer is on, Gemini is "
                        + "started, and this phone is on the same Wi-Fi.");
            }
        }
    }

    // ------------------------------------------------------------------ bridge used by the page

    private class Bridge {
        /** Lets the page know it runs inside the Gemini app. */
        @JavascriptInterface
        public int version() {
            return 1;
        }

        /** Open WhatsApp straight in the chat of `phone` (digits, with country code) with the PDF attached. */
        @JavascriptInterface
        public void sharePdf(String base64, String filename, String phone) {
            runOnUiThread(() -> sharePdfNow(base64, filename, phone, true));
        }

        /** The phone's share list (Files, Drive, other apps), e.g. to save the PDF. */
        @JavascriptInterface
        public void sharePdfToApps(String base64, String filename) {
            runOnUiThread(() -> sharePdfNow(base64, filename, "", false));
        }
    }

    private boolean installed(String pkg) {
        try {
            getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private void sharePdfNow(String base64, String filename, String phone, boolean whatsapp) {
        try {
            String name = (filename == null || filename.trim().isEmpty() ? "bill" : filename.trim())
                    .replaceAll("[\\\\/:*?\"<>|]", "_");
            if (!name.toLowerCase().endsWith(".pdf")) name += ".pdf";
            File dir = new File(getCacheDir(), PdfProvider.FOLDER);
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("No space for the PDF.");
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) if (System.currentTimeMillis() - f.lastModified() > 86_400_000L) f.delete();
            try (FileOutputStream out = new FileOutputStream(new File(dir, name))) {
                out.write(Base64.decode(base64, Base64.DEFAULT));
            }

            Uri uri = Uri.parse("content://" + PdfProvider.AUTHORITY + "/" + Uri.encode(name));
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/pdf");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newRawUri(name, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            String digits = phone == null ? "" : phone.replaceAll("\\D", "");
            String app = !whatsapp ? null
                    : installed("com.whatsapp") ? "com.whatsapp" : installed("com.whatsapp.w4b") ? "com.whatsapp.w4b" : null;
            if (app == null) {
                startActivity(Intent.createChooser(send, "Send PDF"));
                return;
            }
            send.setPackage(app);
            if (digits.length() >= 10) send.putExtra("jid", digits + "@s.whatsapp.net"); // straight to the party's chat
            startActivity(send);
        } catch (Exception e) {
            toast("Could not share the PDF: " + e.getMessage());
        }
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }
}
