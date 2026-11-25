# APNs push (iOS "Prompt alerts" tier) — what ios-fixup.sh wires, and the Apple-portal gate it does NOT

The app half of the contentless-push plan (reference/SCOPE-notifications.md §15). Generic push: iOS draws a
"New message" banner itself with the app not running — **no decrypt, no identity-key read.**

## What `scripts/ios-fixup.sh` applies automatically (safe on a simulator build)

1. **Info.plist → `UIBackgroundModes += remote-notification`** (merge-safe, idempotent — same as the `audio` entry).
2. **`ApnsBridge` Capacitor plugin** appended to `AppDelegate.swift` (old-format pbxproj won't compile a loose
   `.swift`). JS calls `Capacitor.Plugins.ApnsBridge.register()`; the device token comes back on the `apnsToken`
   event. Registered in the bridge VC's `capacitorDidLoad()` next to BackupExclude.
3. **Device-token callbacks** as an `extension AppDelegate` (`didRegisterForRemoteNotificationsWithDeviceToken` →
   hex → `ApnsBridge.deliver(token:)` → JS). Append-only; no edit to the stock AppDelegate body.

None of the above requires signing or a provisioning profile, so a **simulator build stays green**, and the
**receive path can be verified on the simulator** with `xcrun simctl push <udid> com.trinityone.app payload.apns`
where `payload.apns` is:

```json
{ "aps": { "alert": { "title": "TrinityOne", "body": "New message" }, "sound": "default", "thread-id": "trinityone-msgs" } }
```

The banner appears with the app closed, nothing is decrypted — that is the whole generic-push UX.

## The Apple-portal gate (NEEDS THE OWNER / Apple Developer portal) — NOT auto-applied

Real end-to-end delivery (relay → APNs → a real iPhone) needs all three, and these are deliberately **not** scripted,
because adding the entitlement to an un-provisioned build makes code-signing fail:

1. **Enable "Push Notifications" on the App ID** `com.trinityone.app` in the Apple Developer portal (Identifiers).
2. **An APNs auth key (`.p8`)** (Keys → new key with APNs). One key signs all pushes. **Lives with the relay/release
   box, not this Mac** — it is what the relay-side sender (Linux) uses.
3. **An `aps-environment` entitlement** on the app target + a provisioning profile that includes Push. When the App
   ID is provisioned for push, add `ios/App/App/App.entitlements` containing:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>aps-environment</key><string>development</string>  <!-- "production" for App Store / TestFlight -->
   </dict></plist>
   ```

   and set `CODE_SIGN_ENTITLEMENTS = App/App.entitlements` on the `App` target in `project.pbxproj`. Once push is
   provisioned, this step can be folded into `ios-fixup.sh` (guarded) — until then it is manual so simulator builds
   don't break.

## Not built yet (follow-ups, out of the generic-first scope)

- **Tap deep-link** (`?push=msgs`): routing a tapped generic push to the messages screen needs a
  `UNUserNotificationCenterDelegate didReceive` handler. Left out for now to avoid owning the notification-center
  delegate before the (currently unwired) DirectPush BGAppRefresh path also wants it. Generic push still shows and
  opens the app to its default screen.
- **Rich / silent push** + a Notification Service Extension: a later opt-in extra; needs the key-on-wake path.
- **The relay half** (token registry + ingest push hook + APNs send): Linux side, reference/SCOPE-notifications.md §15.3.
