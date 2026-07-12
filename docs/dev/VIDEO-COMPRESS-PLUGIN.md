# Scaffold: on-device video compression before upload

**Status:** scaffold / not built. This is the plan + drop-in code for the native transcode we chose
(Option A). It compresses a picked video **before** encrypt + upload, on the device's hardware encoder —
so encryption and content-addressing stay intact and the uploader sends ~5 MB instead of ~31 MB.

**Why native, not the relay:** the video is E2E-encrypted client-side, so the relay only ever sees
ciphertext it can't transcode; and transcoding changes the sha, breaking content-addressing. Both are
avoided by compressing on-device before those steps. (Full reasoning in the session notes.)

Target: **720p, H.264, ~1.5–2 Mbps, AAC audio.** A talking-head sermon at 31 MB → typically 4–8 MB.

---

## 1. JS interface

A Capacitor plugin `VideoCompress` exposing:

```ts
VideoCompress.compress({ path: string, /* file URI */ maxHeight?: number, bitrate?: number })
  => Promise<{ path: string, size: number, width: number, height: number }>
```

- Returns a new temp-file URI (the app reads it as a File/Blob for the existing upload path).
- Web has no implementation → the call rejects/throws; callers must fall back to the original file.

## 2. Wire-in (the ONE integration point)

In `app/stew-dashboard.jsx`, `DashSermons.onFile` — after picking `f`, before `uploadBlob`:

```js
let toUpload = f;
const isVid = String(f.type || '').startsWith('video');
const VC = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.VideoCompress;
const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if (isVid && native && VC && f.size > 8 * 1048576) {
  try {
    setUpMsg('Compressing “' + f.name + '”…');
    // write f to a temp path first if needed (Capacitor Filesystem), or pass the picker URI through.
    const out = await VC.compress({ path: f._capUri || f.name, maxHeight: 720, bitrate: 1_800_000 });
    if (out && out.size && out.size < f.size) {
      const buf = await (await fetch(Capacitor.convertFileSrc(out.path))).arrayBuffer();
      toUpload = new File([buf], f.name.replace(/\.[^.]+$/, '') + '.mp4', { type: 'video/mp4' });
    }
  } catch (e) { /* fall back to the original file */ }
}
const b = await window.Steward.uploadBlob(toUpload, encFn, mirrors);
```
Note: getting the picked file's real filesystem path from the web `<input type=file>` is the fiddly part —
you may need to switch the picker to `@capacitor/camera` `pickVideos()` (which returns a real URI) instead
of the hidden `<input>`. That's the first thing to sort when building this.

## 3. Android (Kotlin) — the fast path is the LightCompressor library

`android/app/build.gradle`:
```gradle
dependencies {
  implementation 'com.github.AbedElazizShe:LightCompressor:1.3.1'   // MediaCodec-backed, handles rotation + audio
}
// + in settings.gradle repositories: maven { url 'https://jitpack.io' }
```

`android/app/src/main/java/com/trinityone/steward/VideoCompressPlugin.kt`:
```kotlin
@CapacitorPlugin(name = "VideoCompress")
class VideoCompressPlugin : Plugin() {
  @PluginMethod
  fun compress(call: PluginCall) {
    val srcUri = Uri.parse(call.getString("path"))
    val maxH = call.getInt("maxHeight") ?: 720
    val bitrate = call.getInt("bitrate") ?: 1_800_000
    val out = File(context.cacheDir, "vc_" + System.currentTimeMillis() + ".mp4")
    VideoCompressor.start(
      context, listOf(srcUri), false, null, out.parent, out.name.let { listOf(it) },
      configureWith = Configuration(
        quality = VideoQuality.MEDIUM, videoBitrateInMbps = bitrate / 1_000_000,
        isMinBitrateCheckEnabled = false, disableAudio = false, resizer = VideoResizer.matchSize(maxH)
      ),
      listener = object : CompressionListener {
        override fun onSuccess(index: Int, size: Long, path: String?) {
          val ret = JSObject(); ret.put("path", "file://" + path); ret.put("size", size)
          call.resolve(ret)
        }
        override fun onFailure(index: Int, msg: String) = call.reject(msg)
        override fun onProgress(index: Int, p: Float) {}
        override fun onStart(index: Int) {}
        override fun onCancelled(index: Int) = call.reject("cancelled")
      }
    )
  }
}
```
Register it: add `add(VideoCompressPlugin::class.java)` in `MainActivity.onCreate` (pre-Cap6) or rely on
`@CapacitorPlugin` auto-registration (Cap 6). (Exact API of LightCompressor 1.3.x drifts between versions —
pin the version and adjust `Configuration`/`resizer` names to match.)

## 4. iOS (Swift) — AVAssetExportSession, built-in (no dependency)

`ios/App/App/VideoCompressPlugin.swift`:
```swift
@objc(VideoCompressPlugin)
public class VideoCompressPlugin: CAPPlugin {
  @objc func compress(_ call: CAPPluginCall) {
    guard let path = call.getString("path"), let url = URL(string: path) else { return call.reject("no path") }
    let asset = AVAsset(url: url)
    // AVAssetExportPreset1280x720 caps to 720p; for finer bitrate control use a custom AVAssetExportSession + videoComposition
    guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720) else { return call.reject("no export") }
    let out = FileManager.default.temporaryDirectory.appendingPathComponent("vc_\(Date().timeIntervalSince1970).mp4")
    export.outputURL = out; export.outputFileType = .mp4; export.shouldOptimizeForNetworkUse = true
    export.exportAsynchronously {
      if export.status == .completed {
        let size = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
        call.resolve(["path": out.absoluteString, "size": size ?? 0])
      } else { call.reject(export.error?.localizedDescription ?? "export failed") }
    }
  }
}
```
Plus the `.m` bridge (`CAP_PLUGIN(VideoCompressPlugin, "VideoCompress", CAP_PLUGIN_METHOD(compress, CAPPluginReturnPromise);)`).

## 5. Build + test loop (needs a device)

1. Add the plugin files + gradle dep; `npx cap sync`.
2. `scripts/build-steward-apk.sh` (and the member APK if members upload too), `adb install -r`.
3. Upload a real ~30 MB video → confirm it compresses (watch "Compressing…"), the stored size drops
   to a few MB, and it **still plays back** (rotation correct, audio present, not corrupted).
4. Tune `bitrate`/`maxHeight`. Watch the known edge cases: **portrait rotation metadata**, **audio track
   preserved**, **HDR/10-bit** sources (may need tone-mapping or a fallback).
5. iOS: build on a Mac, same test.

## 6. Interaction with what already ships
- The **size warning + "Keeping video small" guide** (already shipped) stay as the web fallback and the
  teaching layer — compression just makes them rarely needed on native.
- Compression happens **before** the optional encryption + the sha, so nothing downstream changes.
