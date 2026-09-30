package com.notemaker.papertrail;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final int PICK_FILE_REQUEST = 4101;
    private static final int SAVE_FILE_REQUEST = 4102;
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String APP_URL = "https://appassets.androidplatform.net/assets/index.html";

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private byte[] pendingSaveBytes;
    private String pendingSaveMime;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(247, 245, 240));
        window.setNavigationBarColor(Color.rgb(247, 245, 240));
        window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        FrameLayout rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(Color.rgb(247, 245, 240));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(247, 245, 240));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSupportMultipleWindows(false);
        webView.addJavascriptInterface(new AndroidFiles(), "PapertrailAndroid");
        webView.setWebViewClient(new LocalAssetsClient());
        webView.setWebChromeClient(new FileChooserClient());

        rootLayout.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        rootLayout.setOnApplyWindowInsetsListener((v, insets) -> {
            int top = 0;
            int bottom = 0;
            int left = 0;
            int right = 0;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets systemBarInsets = insets.getInsets(
                    WindowInsets.Type.statusBars()
                    | WindowInsets.Type.navigationBars()
                    | WindowInsets.Type.displayCutout()
                );
                top = systemBarInsets.top;
                bottom = systemBarInsets.bottom;
                left = systemBarInsets.left;
                right = systemBarInsets.right;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
                left = insets.getSystemWindowInsetLeft();
                right = insets.getSystemWindowInsetRight();
            }

            v.setPadding(left, top, right, bottom);
            return insets;
        });

        setContentView(rootLayout);
        if (savedInstanceState == null) webView.loadUrl(APP_URL);
        else webView.restoreState(savedInstanceState);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE_REQUEST) {
            if (fileChooserCallback != null) {
                fileChooserCallback.onReceiveValue(readSelectedFiles(resultCode, data));
                fileChooserCallback = null;
            }
            return;
        }
        if (requestCode == SAVE_FILE_REQUEST) {
            Uri destination = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (destination != null && pendingSaveBytes != null) writeFile(destination, pendingSaveBytes);
            else Toast.makeText(this, "Save cancelled.", Toast.LENGTH_SHORT).show();
            pendingSaveBytes = null;
            pendingSaveMime = null;
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("PapertrailAndroid");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class FileChooserClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = callback;
            try {
                Intent intent = params.createIntent();
                if (acceptsImages(params.getAcceptTypes())) {
                    // Android WebView may collapse a multi-MIME HTML accept list to its first
                    // entry (often image/jpeg), hiding PNG, WebP, and HEIC photos in the picker.
                    intent.setType("image/*");
                }
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                startActivityForResult(intent, PICK_FILE_REQUEST);
                return true;
            } catch (Exception exception) {
                fileChooserCallback = null;
                Toast.makeText(MainActivity.this, "No file picker is available on this device.", Toast.LENGTH_LONG).show();
                return false;
            }
        }
    }

    private static boolean acceptsImages(String[] acceptTypes) {
        if (acceptTypes == null) return false;
        for (String accepted : acceptTypes) {
            if (accepted == null) continue;
            for (String type : accepted.toLowerCase(Locale.ROOT).split(",")) {
                String clean = type.trim();
                if (clean.startsWith("image/") || clean.matches("\\.?(jpg|jpeg|png|webp|heic|heif)")) return true;
            }
        }
        return false;
    }

    private static Uri[] readSelectedFiles(int resultCode, Intent data) {
        if (resultCode != RESULT_OK || data == null) return null;
        ArrayList<Uri> selected = new ArrayList<>();
        ClipData clipData = data.getClipData();
        if (clipData != null) {
            for (int index = 0; index < clipData.getItemCount(); index++) {
                Uri uri = clipData.getItemAt(index).getUri();
                if (uri != null && !selected.contains(uri)) selected.add(uri);
            }
        }
        Uri single = data.getData();
        if (single != null && !selected.contains(single)) selected.add(single);
        return selected.isEmpty() ? null : selected.toArray(new Uri[0]);
    }

    private final class LocalAssetsClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!ASSET_HOST.equals(uri.getHost())) return blockedResponse();
            String path = uri.getPath();
            if (path == null || !path.startsWith("/assets/")) return notFoundResponse();
            String asset = "www/" + path.substring("/assets/".length());
            try {
                InputStream stream = getAssets().open(asset);
                return new WebResourceResponse(mimeType(asset), "UTF-8", 200, "OK", responseHeaders(), stream);
            } catch (IOException exception) {
                return notFoundResponse();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !ASSET_HOST.equals(request.getUrl().getHost());
        }
    }

    private final class AndroidFiles {
        @JavascriptInterface
        public void saveFile(String filename, String mimeType, String base64Data) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                mainHandler.post(() -> requestSave(filename, mimeType, bytes));
            } catch (IllegalArgumentException exception) {
                mainHandler.post(() -> Toast.makeText(MainActivity.this, "Could not prepare that file.", Toast.LENGTH_LONG).show());
            }
        }
    }

    private void requestSave(String filename, String mimeType, byte[] bytes) {
        if (pendingSaveBytes != null) {
            Toast.makeText(this, "Finish the current save first.", Toast.LENGTH_SHORT).show();
            return;
        }
        pendingSaveBytes = bytes;
        pendingSaveMime = mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(pendingSaveMime);
        intent.putExtra(Intent.EXTRA_TITLE, safeFilename(filename));
        try {
            startActivityForResult(intent, SAVE_FILE_REQUEST);
        } catch (Exception exception) {
            pendingSaveBytes = null;
            pendingSaveMime = null;
            Toast.makeText(this, "No save location is available.", Toast.LENGTH_LONG).show();
        }
    }

    private void writeFile(Uri destination, byte[] bytes) {
        try (OutputStream output = getContentResolver().openOutputStream(destination)) {
            if (output == null) throw new IOException("No output stream");
            output.write(bytes);
            Toast.makeText(this, "File saved.", Toast.LENGTH_SHORT).show();
        } catch (IOException exception) {
            Toast.makeText(this, "Could not save the file.", Toast.LENGTH_LONG).show();
        }
    }

    private static String safeFilename(String name) {
        String clean = name == null ? "papertrail-file" : name.replaceAll("[\\\\/:*?\"<>|]", "_");
        return clean.isEmpty() ? "papertrail-file" : clean;
    }

    private static String mimeType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js")) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json";
        return "application/octet-stream";
    }

    private static Map<String, String> responseHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "https://appassets.androidplatform.net");
        headers.put("Cache-Control", "no-cache");
        return headers;
    }

    private static WebResourceResponse notFoundResponse() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", responseHeaders(), new ByteArrayInputStream(new byte[0]));
    }

    private static WebResourceResponse blockedResponse() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", responseHeaders(), new ByteArrayInputStream(new byte[0]));
    }
}
