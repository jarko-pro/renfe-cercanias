#!/usr/bin/env bash
# Compila y firma la app Android (TWA).
#   bash android/build.sh
# Salida: android/cercanias.aab (para Play Console) y android/cercanias.apk (para instalar a mano).
#
# La clave de subida está FUERA del repo, en ~/.android-keys/ (con su contraseña en LEEME.txt).
# Si cambias twa-manifest.json, regenera antes el proyecto:
#   cd android && npx @bubblewrap/cli@1.27.0 update --skipVersionUpgrade
# (No usamos "bubblewrap build": no reconoce el formato actual del Android SDK.)
set -euo pipefail
cd "$(dirname "$0")"

export ANDROID_HOME="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
export JAVA_HOME="${JAVA_HOME:-C:/Program Files/Eclipse Adoptium/jdk-17.0.16.8-hotspot}"
KEYSTORE="$HOME/.android-keys/cercanias-upload.jks"
ALIAS=upload
PW="${KEYSTORE_PASSWORD:-$(sed -n 's/^Contrasena (almacen y clave): //p' "$HOME/.android-keys/LEEME.txt")}"
BT="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"

./gradlew --no-daemon -q assembleRelease bundleRelease

# App Bundle: se firma con jarsigner (lo exige Play).
cp app/build/outputs/bundle/release/app-release.aab cercanias.aab
"$JAVA_HOME/bin/jarsigner" -keystore "$KEYSTORE" -storepass "$PW" -keypass "$PW" cercanias.aab "$ALIAS" > /dev/null

# APK: alinear y firmar con apksigner.
"$BT/zipalign" -f -p 4 app/build/outputs/apk/release/app-release-unsigned.apk cercanias.apk
"$BT/apksigner.bat" sign --ks "$KEYSTORE" --ks-key-alias "$ALIAS" --ks-pass "pass:$PW" --key-pass "pass:$PW" cercanias.apk
"$BT/apksigner.bat" verify cercanias.apk

echo "Listo: android/cercanias.aab y android/cercanias.apk"
