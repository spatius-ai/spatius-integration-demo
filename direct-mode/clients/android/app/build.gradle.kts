import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

val localProperties = Properties()
run {
    val file = rootProject.file("local.properties")
    if (file.exists()) {
        file.inputStream().use { localProperties.load(it) }
    }
}

fun localString(key: String, defaultValue: String = ""): String {
    return localProperties.getProperty(key, defaultValue)
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
}

android {
    namespace = "ai.spatius.avatarkit.directmodedemo"
    compileSdk {
        version = release(36)
    }

    defaultConfig {
        applicationId = "ai.spatius.avatarkit.directmodedemo"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Where the demo's own server lives. No credentials here: they stay in that
        // server's .env and never reach the device — see BackendClient.
        //
        // A phone cannot reach the dev machine's localhost, so this is the LAN address
        // the server prints on startup. Seeded from local.properties for convenience
        // and editable on the configuration screen.
        buildConfigField(
            "String",
            "DIRECT_MODE_URL",
            "\"${localString("DIRECT_MODE_URL", "http://10.0.2.2:8090")}\"",
        )
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Signed with the debug key so `assembleRelease` produces something that
            // installs. Rendering an avatar is the whole point of this demo and a debug
            // build drops the frame rate far enough that the SDK looks slow — which is
            // the first thing a reader would blame — so release is what should be run,
            // and an unsigned APK cannot be. Replace this with your own key before
            // shipping anything.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(libs.avatarkit)
    // The realtime scene's WebSocket to the demo's own agent. Declared directly
    // rather than leaning on AvatarKit's transitive copy, which an SDK bump could
    // drop without warning.
    implementation(libs.okhttp)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
    }
}
