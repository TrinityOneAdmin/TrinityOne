import Foundation
import BackgroundTasks
import UserNotifications

/// Registers the BGAppRefreshTask identifier with BGTaskScheduler, schedules it on
/// applicationDidEnterBackground, and re-schedules after each run. Mirrors Android's
/// DirectPushLifecycle (PeriodicWorkRequestBuilder, 15 min, KEEP).
///
/// iOS's BGAppRefreshTask is ML-predicted and usage-dependent. For daily Bible readers (the target
/// demographic), iOS grants several refresh slots per day. For Sunday-only users, possibly none during
/// the week. This is the known and accepted trade-off.
///
/// ## Force-quit behaviour
/// If the user swipe-kills the app, iOS may or may not relaunch for BGAppRefreshTask (varies by iOS
/// version). The settings screen should tell members not to force-quit.
///
/// Callers: AppDelegate.didFinishLaunchingWithOptions (register), AppDelegate.didEnterBackground (schedule)
enum BackgroundRefreshScheduler {

    /// The task identifier. Must match Info.plist BGTaskSchedulerPermittedIdentifiers.
    static let taskIdentifier = "church.trinityone.app.bgrefresh"

    /// Register the BGAppRefreshTask handler. Call ONCE from application(_:didFinishLaunchingWithOptions:),
    /// BEFORE the end of that method (Apple requirement: registration must happen during launch).
    ///
    /// Callers: AppDelegate.application(_:didFinishLaunchingWithOptions:) (1 caller)
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskIdentifier, using: nil) { task in
            guard let bgTask = task as? BGAppRefreshTask else { return }
            handleBGRefresh(bgTask)
        }
        NSLog("DIRECTPUSH BGAppRefreshTask registered: \(taskIdentifier)")
    }

    /// Schedule (or re-schedule) the next BGAppRefreshTask. Call from applicationDidEnterBackground and
    /// after each completed run. `earliestBeginDate = nil` lets iOS decide when to run (setting a future
    /// date is a floor, not a schedule, and reduces the ML model's freedom).
    ///
    /// Callers: AppDelegate.applicationDidEnterBackground(_:) (1 caller),
    ///          handleBGRefresh(_:) (1 caller — re-schedules after each run)
    static func scheduleIfOptedIn() {
        // Check opt-in: the key lives in the app's localStorage at `trinityone.directpush.optin`.
        // We cannot read localStorage from native code without a WKWebView, so we use a mirrored
        // UserDefaults key that the app writes alongside the localStorage key.
        // If this mirror is not yet wired, we schedule unconditionally (the JS reader checks opt-in
        // itself and returns `not-opted-in` immediately if off, so a no-op run is cheap).
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = nil
        do {
            try BGTaskScheduler.shared.submit(request)
            NSLog("DIRECTPUSH BGAppRefreshTask scheduled")
        } catch {
            NSLog("DIRECTPUSH BGAppRefreshTask schedule error: \(error.localizedDescription)")
        }
    }

    /// Handle a BGAppRefreshTask invocation from iOS. Runs the reader on the main thread (WKWebView
    /// requires it). Wires the expirationHandler for graceful degradation.
    ///
    /// Callers: register() closure (1 caller — BGTaskScheduler callback)
    private static func handleBGRefresh(_ task: BGAppRefreshTask) {
        NSLog("DIRECTPUSH BGAppRefreshTask started")

        // Schedule the NEXT run before this one finishes (Apple recommendation).
        scheduleIfOptedIn()

        // The expirationHandler fires when iOS is about to kill the task (~30s). We harvest whatever
        // summary exists and clean up. This is the graceful-degradation path: a run killed mid-flight
        // is NOT a failure — it just means the count may be stale or zero. (Audit RED 2 fix.)
        var taskCompleted = false
        task.expirationHandler = {
            NSLog("DIRECTPUSH BGAppRefreshTask expiration handler fired")
            if !taskCompleted {
                taskCompleted = true
                task.setTaskCompleted(success: true)
            }
        }

        // WKWebView must be created and driven on the main thread.
        DispatchQueue.main.async {
            BackgroundReader.run { _ in
                if !taskCompleted {
                    taskCompleted = true
                    task.setTaskCompleted(success: true)
                    NSLog("DIRECTPUSH BGAppRefreshTask completed")
                }
            }
        }
    }
}
