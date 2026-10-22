import AppIntents
import Foundation

/// The play / pause button of the widget: it tells the app (by a notification between the two processes)
/// to toggle the 集中 sound. The app listens for it in modules/widget-bridge.
struct ToggleIntent: AppIntent {
    static var title: LocalizedStringResource = "再生・停止"

    func perform() async throws -> some IntentResult {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName("app.musicspace.widget.toggle" as CFString),
            nil,
            nil,
            true
        )
        return .result()
    }
}
