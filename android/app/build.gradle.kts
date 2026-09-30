plugins {
    id("com.android.application")
}

android {
    namespace = "com.notemaker.papertrail"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.notemaker.papertrail"
        minSdk = 24
        targetSdk = 35
        versionCode = 2
        versionName = "1.0.1"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

val generatedWebAssets = layout.buildDirectory.dir("generated/papertrailAssets")
val syncPapertrailAssets by tasks.registering(Sync::class) {
    from(rootProject.projectDir.parentFile) {
        include("index.html", "app.js", "styles.css", "manifest.webmanifest", "icon.svg")
        into("www")
    }
    into(generatedWebAssets)
}

android.sourceSets.getByName("main").assets.srcDir(generatedWebAssets)
tasks.named("preBuild").configure { dependsOn(syncPapertrailAssets) }
