# Papertrail for Android

This is a native Android WebView shell around the Papertrail web app. It bundles the web assets into the APK, keeps IndexedDB data in the Android app's private WebView storage, opens Android's file picker for photo/backup imports, and saves PDFs/backups through Android's document picker. It does not request Internet permission or use the laptop server.

## Build and install

Open this `android` folder in Android Studio and let it install the Android SDK Platform 35 and Android Gradle Plugin 8.13.0 if prompted. Build the **debug APK** from **Build → Build APK(s)**. The APK is created at `app/build/outputs/apk/debug/app-debug.apk`. Transfer it to your phone and install it, or connect the phone with USB debugging enabled and use Android Studio's Run action.

The Gradle task `syncPapertrailAssets` copies the current web app files from the workspace root into the APK at build time, so the Android package uses the same editor and PDF generator. The native app's notebook is separate from Chrome's browser storage; import a `.papertrail.json` backup once to transfer an existing subject.
