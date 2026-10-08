package com.artyonix.artymods;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final String APP_ORIGIN = "https://app.artymods.local/";
    private static final int FILE_PICKER = 9021;
    private WebView webView;
    private ValueCallback<Uri[]> pendingFiles;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(12,16,24));
        getWindow().setNavigationBarColor(Color.rgb(12,16,24));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(12,16,24));
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true); // needed for search, filters and bookmarks
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternalOrDownload(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openExternalOrDownload(Uri.parse(url));
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_PICKER);
                    return true;
                } catch (ActivityNotFoundException exception) {
                    pendingFiles = null;
                    Toast.makeText(MainActivity.this, "Не найдено приложение для выбора файлов", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            startDownload(Uri.parse(url), contentDisposition, mimeType);
        });
        loadHome();
    }

    private void loadHome() {
        try (InputStream in = getAssets().open("index.html"); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] bytes = new byte[8192];
            int count;
            while ((count = in.read(bytes)) != -1) out.write(bytes, 0, count);
            String page = new String(out.toByteArray(), StandardCharsets.UTF_8);
            // Synthetic HTTPS origin permits DOM storage and standard cross-origin API requests.
            // This URL is local-only; no server or account on this domain is required.
            webView.loadDataWithBaseURL(APP_ORIGIN, page, "text/html", "UTF-8", null);
        } catch (Exception ex) {
            Toast.makeText(this, "Ошибка чтения интерфейса: " + ex.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private boolean openExternalOrDownload(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equalsIgnoreCase(scheme)) return true; // reject unsafe schemes
        String url = uri.toString();
        String path = uri.getPath() == null ? "" : uri.getPath().toLowerCase();
        if (path.endsWith(".jar") || path.endsWith(".zip") || path.endsWith(".mrpack") || path.matches("/api/projects/[0-9a-f-]{36}/download")) {
            startDownload(uri, null, null);
        } else {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
            } catch (ActivityNotFoundException ex) {
                Toast.makeText(this, "Установи браузер, чтобы открыть ссылку", Toast.LENGTH_LONG).show();
            }
        }
        return true;
    }

    private void startDownload(Uri uri, String disposition, String mime) {
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            Toast.makeText(this, "Разрешены только HTTPS-загрузки", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            String name = uri.getQueryParameter("filename");
            if (name == null || name.isEmpty()) name = URLUtil.guessFileName(uri.toString(), disposition, mime);
            // Avoid path tricks and illegal output names.
            name = name.replaceAll("[^A-Za-z0-9._() -]", "_");
            if (name.isEmpty() || name.equals(".") || name.equals("..")) name = "mod-download.jar";
            DownloadManager.Request req = new DownloadManager.Request(uri);
            req.setTitle(name);
            req.setDescription("ArtyMods · Minecraft");
            req.setAllowedOverMetered(true);
            req.setAllowedOverRoaming(true);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (Build.VERSION.SDK_INT >= 29) {
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            } // On Android 8-9 the DownloadManager chooses a managed destination.
            DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (manager == null) throw new IllegalStateException("DownloadManager unavailable");
            manager.enqueue(req);
            Toast.makeText(this, "Скачивание началось: " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception ex) {
            Toast.makeText(this, "Не удалось скачать: " + ex.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_PICKER && pendingFiles != null) {
            pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            pendingFiles = null;
        }
    }

    @Override public void onBackPressed() {
        // Go back within the bundled app instead of immediately closing it.
        webView.evaluateJavascript("onNativeBack()", value -> {
            if ("false".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    @Override protected void onDestroy() {
        if (pendingFiles != null) { pendingFiles.onReceiveValue(null); pendingFiles = null; }
        webView.destroy();
        super.onDestroy();
    }
}
