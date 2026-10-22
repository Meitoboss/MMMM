import ExpoModulesCore
import WidgetKit

/// The bridge to the home screen widget: the state goes into the shared App Group, and the widget's button comes back as `onToggle`.
public class WidgetBridgeModule: Module {
  private static let group = "group.app.musicspace.player"
  private static let toggleName = "app.musicspace.widget.toggle"

  public func definition() -> ModuleDefinition {
    Name("WidgetBridge")
    Events("onToggle")

    Function("setState") { (json: String) in
      UserDefaults(suiteName: Self.group)?.set(json, forKey: "nowPlaying")
      WidgetCenter.shared.reloadAllTimelines()
    }

    Function("setCover") { (path: String) in
      guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.group) else { return }
      let target = dir.appendingPathComponent("cover.jpg")
      try? FileManager.default.removeItem(at: target)
      if let source = URL(string: path) {
        try? FileManager.default.copyItem(at: source, to: target)
      }
      WidgetCenter.shared.reloadAllTimelines()
    }

    OnCreate {
      CFNotificationCenterAddObserver(
        CFNotificationCenterGetDarwinNotifyCenter(),
        Unmanaged.passUnretained(self).toOpaque(),
        { _, observer, _, _, _ in
          guard let observer else { return }
          let module = Unmanaged<WidgetBridgeModule>.fromOpaque(observer).takeUnretainedValue()
          module.sendEvent("onToggle", [:])
        },
        Self.toggleName as CFString,
        nil,
        .deliverImmediately
      )
    }

    OnDestroy {
      CFNotificationCenterRemoveObserver(
        CFNotificationCenterGetDarwinNotifyCenter(),
        Unmanaged.passUnretained(self).toOpaque(),
        CFNotificationName(Self.toggleName as CFString),
        nil
      )
    }
  }
}
