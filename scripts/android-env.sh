# Source this before any Capacitor / Gradle / sdkmanager command:
#   source scripts/android-env.sh
# Keeps the whole Android toolchain on /mnt/storage (root disk is tight).
export JAVA_HOME=/mnt/storage/android-tools/jdk
export ANDROID_HOME=/mnt/storage/android-tools/sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME=/mnt/storage/android-tools/gradle-home
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
