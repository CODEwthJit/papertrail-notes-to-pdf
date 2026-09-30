# Papertrail

A private, local-first notes-to-PDF web app. It has no accounts, backend, or external image-processing service. Subjects and images stay in the current browser's IndexedDB. Use a project backup to move them to another device.

## Run it

Install Node.js, open this folder in a terminal, then run:

```powershell
node serve.mjs
```

Open [http://localhost:4173](http://localhost:4173). The local server is needed for browser storage and install/offline support. Stop it with Ctrl+C. To use the app in a phone browser on the same Wi-Fi, open `http://<computer-LAN-IP>:4173` (find the computer's IPv4 address with `ipconfig`). The app itself does not send project data over the network; installing it as an offline app requires an HTTPS static host, and the project data still remains in that phone's browser.

## Android app

An Android WebView app project is in [`android/`](android/README.md). It bundles the current Papertrail UI, uses private on-phone browser storage, and saves PDFs/backups with Android's file picker. Open that folder in Android Studio to build and install it. The native app keeps its own notebook storage, so import a `.papertrail.json` backup to move a subject from Chrome.

## Use it

1. Create a subject and add one or more photos.
2. Edit pages with the corner handles, clockwise rotation, and color/grayscale/black-and-white looks. Arrange drafts with drag and drop or the up/down controls.
3. Choose **Add pages to notebook** to save the batch and generate its PDF. Further edits replace the stored PDF only after its replacement has been generated and saved successfully.
4. Download the current PDF. Export a `.papertrail.json` backup to continue on another device.

JPEG, PNG, and WebP are supported where the browser can decode them. HEIC/HEIF support depends on the browser's built-in decoder; if it cannot decode the file, convert it to JPEG before importing. Files are processed locally. Browser storage is device-specific and can be cleared by the browser, so keep backups for important notebooks.
