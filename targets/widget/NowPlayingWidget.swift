import SwiftUI
import WidgetKit

/// The 集中 sound that is playing, shown on the home screen (a medium widget with a play / pause button).
/// The app writes the state into the shared App Group (see modules/widget-bridge) and reloads this widget.
private let appGroup = "group.app.musicspace.player"

struct NowPlaying: Decodable {
    let active: Bool
    let title: String
    let hz: Int
    let playing: Bool
}

struct Entry: TimelineEntry {
    let date: Date
    let now: NowPlaying?
    let cover: UIImage?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: .now, now: nil, cover: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(load())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        // the app asks for a reload whenever the state changes, so there is no timer
        completion(Timeline(entries: [load()], policy: .never))
    }

    private func load() -> Entry {
        var now: NowPlaying? = nil
        if let json = UserDefaults(suiteName: appGroup)?.string(forKey: "nowPlaying"),
           let data = json.data(using: .utf8) {
            now = try? JSONDecoder().decode(NowPlaying.self, from: data)
        }
        var cover: UIImage? = nil
        if let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup),
           let data = try? Data(contentsOf: dir.appendingPathComponent("cover.jpg")) {
            cover = UIImage(data: data)
        }
        return Entry(date: .now, now: now, cover: cover)
    }
}

struct NowPlayingView: View {
    let entry: Entry

    var body: some View {
        if let now = entry.now, now.active {
            HStack(spacing: 14) {
                ZStack(alignment: .bottomLeading) {
                    if let image = entry.cover {
                        Image(uiImage: image).resizable().scaledToFill()
                    } else {
                        Color.teal.opacity(0.4)
                    }
                    Text("\(now.hz) Hz")
                        .font(.system(size: 14, weight: .light))
                        .foregroundStyle(.white)
                        .padding(6)
                }
                .frame(width: 88, height: 88)
                .clipShape(RoundedRectangle(cornerRadius: 14))

                VStack(alignment: .leading, spacing: 8) {
                    Text(now.title)
                        .font(.headline)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text("LIVE")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.7))
                    Capsule()
                        .fill(.white.opacity(0.25))
                        .frame(height: 4)
                }

                Button(intent: ToggleIntent()) {
                    Image(systemName: now.playing ? "pause.fill" : "play.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
            }
            .padding(14)
            .containerBackground(for: .widget) {
                Color(red: 0.12, green: 0.15, blue: 0.2)
            }
        } else {
            Text("集中の音は止まっています")
                .font(.caption)
                .foregroundStyle(.secondary)
                .containerBackground(for: .widget) {
                    Color(red: 0.12, green: 0.15, blue: 0.2)
                }
        }
    }
}

@main
struct NowPlayingWidget: Widget {
    let kind = "NowPlayingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            NowPlayingView(entry: entry)
        }
        .configurationDisplayName("集中の音")
        .description("再生中の集中の音を表示します。")
        .supportedFamilies([.systemMedium])
    }
}
