plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

val rtcModeUrl: String = rootProject.file("local.properties")
    .takeIf { it.exists() }
    ?.readLines()
    ?.firstOrNull { it.trimStart().startsWith("RTC_MODE_URL=") }
    ?.substringAfter("=")
    ?: "http://10.0.2.2:8790"

android {
    namespace = "ai.spatius.avatarkit.rtcmodedemo"
    compileSdk {
        version = release(36)
    }

    defaultConfig {
        applicationId = "ai.spatius.avatarkit.rtcmodedemo"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "RTC_MODE_URL", "\"${rtcModeUrl}\"")
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
            // build drops the frame rate far enough that the SDK looks slow, so release
            // is what should be run — and an unsigned APK cannot be. Replace this with
            // your own key before shipping anything.
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
    // RTC driving. avatarkit-rtc declares both the main SDK and Agora as compileOnly,
    // so the Agora SDK has to be brought in explicitly alongside it.
    //
    // Agora rather than LiveKit, and not a choice: this is the only stack the Android
    // RTC SDK speaks. The app says so on every request — see AgentClient.createSession.
    implementation("ai.spatius:avatarkit-rtc:1.0.1")
    implementation("io.agora.rtc:full-sdk:4.6.2")
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    // Mic / Stop for the one control this mode has. Extended rather than
    // core: core carries neither.
    implementation("androidx.compose.material:material-icons-extended")
    implementation(libs.androidx.navigation.compose)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
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
