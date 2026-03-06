import WidgetKit
import SwiftUI

private enum ClawCostWidgetShared {
  static let appGroup = "group.com.fadmediagroup.clawlink"
  static let snapshotKey = "system-surface:snapshot"
  static let supportedSchemaVersion = 1
}

private struct CostWidgetSnapshot: Decodable {
  let schemaVersion: Int?
  let title: String
  let connection: String
  let costToday: Double?
  let costYesterday: Double?
  let requestsToday: Int?
  let tokenUsageToday: Int?

  private enum CodingKeys: String, CodingKey {
    case schemaVersion
    case title
    case connection
    case costToday
    case costYesterday
    case requestsToday
    case tokenUsageToday
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if let intSchemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) {
      schemaVersion = intSchemaVersion
    } else if let doubleSchemaVersion = try container.decodeIfPresent(Double.self, forKey: .schemaVersion) {
      schemaVersion = Int(doubleSchemaVersion)
    } else {
      schemaVersion = nil
    }

    title = (try container.decodeIfPresent(String.self, forKey: .title) ?? "ClawLink").trimmingCharacters(in: .whitespacesAndNewlines)
    connection = (try container.decodeIfPresent(String.self, forKey: .connection) ?? "offline").trimmingCharacters(in: .whitespacesAndNewlines)

    if let value = try container.decodeIfPresent(Double.self, forKey: .costToday) {
      costToday = value
    } else if let value = try container.decodeIfPresent(Int.self, forKey: .costToday) {
      costToday = Double(value)
    } else {
      costToday = nil
    }

    if let value = try container.decodeIfPresent(Double.self, forKey: .costYesterday) {
      costYesterday = value
    } else if let value = try container.decodeIfPresent(Int.self, forKey: .costYesterday) {
      costYesterday = Double(value)
    } else {
      costYesterday = nil
    }

    if let value = try container.decodeIfPresent(Int.self, forKey: .requestsToday) {
      requestsToday = value
    } else if let value = try container.decodeIfPresent(Double.self, forKey: .requestsToday) {
      requestsToday = Int(value)
    } else {
      requestsToday = nil
    }

    if let value = try container.decodeIfPresent(Int.self, forKey: .tokenUsageToday) {
      tokenUsageToday = value
    } else if let value = try container.decodeIfPresent(Double.self, forKey: .tokenUsageToday) {
      tokenUsageToday = Int(value)
    } else {
      tokenUsageToday = nil
    }
  }
}

private struct ClawLinkCostEntry: TimelineEntry {
  let date: Date
  let title: String
  let connection: String
  let costToday: Double?
  let costYesterday: Double?
  let requestsToday: Int?
  let tokenUsageToday: Int?
  let requiresAppUpdate: Bool
}

private func costWidgetConnectionColor(_ connection: String) -> Color {
  let normalized = connection.lowercased()
  if normalized.contains("online") {
    return Color(red: 0.09, green: 0.63, blue: 0.42)
  }
  if normalized.contains("degraded") || normalized.contains("reconnect") {
    return Color(red: 0.89, green: 0.58, blue: 0.14)
  }
  return Color(red: 0.82, green: 0.28, blue: 0.34)
}

private func formatCompactMetric(_ value: Int?) -> String {
  guard let value else {
    return "--"
  }
  let safeValue = max(0, value)
  if safeValue >= 1_000_000 {
    return String(format: "%.1fM", Double(safeValue) / 1_000_000)
  }
  if safeValue >= 1000 {
    return String(format: "%.1fK", Double(safeValue) / 1000)
  }
  return "\(safeValue)"
}

private func costTrend(today: Double?, yesterday: Double?) -> (symbol: String, text: String, color: Color) {
  guard let today, let yesterday, yesterday >= 0 else {
    return ("minus", "No baseline", Color.secondary)
  }

  let delta = today - yesterday
  if abs(delta) < 0.005 {
    return ("equal", "Flat vs yesterday", Color.secondary)
  }

  let percentage = yesterday > 0 ? abs(delta / yesterday) * 100 : 100
  if delta > 0 {
    return ("arrow.up.right", String(format: "+%.0f%% vs yesterday", percentage), Color(red: 0.82, green: 0.28, blue: 0.34))
  }
  return ("arrow.down.right", String(format: "-%.0f%% vs yesterday", percentage), Color(red: 0.09, green: 0.63, blue: 0.42))
}

private struct ClawLinkCostProvider: TimelineProvider {
  private func readSnapshot() -> CostWidgetSnapshot? {
    guard
      let defaults = UserDefaults(suiteName: ClawCostWidgetShared.appGroup),
      let raw = defaults.string(forKey: ClawCostWidgetShared.snapshotKey),
      let data = raw.data(using: .utf8)
    else {
      return nil
    }

    return try? JSONDecoder().decode(CostWidgetSnapshot.self, from: data)
  }

  private func makeEntry(now: Date) -> ClawLinkCostEntry {
    guard let snapshot = readSnapshot() else {
      return ClawLinkCostEntry(
        date: now,
        title: "ClawLink",
        connection: "offline",
        costToday: nil,
        costYesterday: nil,
        requestsToday: nil,
        tokenUsageToday: nil,
        requiresAppUpdate: false
      )
    }

    let schemaVersion = snapshot.schemaVersion ?? 1
    if schemaVersion > ClawCostWidgetShared.supportedSchemaVersion {
      return ClawLinkCostEntry(
        date: now,
        title: snapshot.title.isEmpty ? "ClawLink" : snapshot.title,
        connection: "offline",
        costToday: nil,
        costYesterday: nil,
        requestsToday: nil,
        tokenUsageToday: nil,
        requiresAppUpdate: true
      )
    }

    return ClawLinkCostEntry(
      date: now,
      title: snapshot.title.isEmpty ? "ClawLink" : snapshot.title,
      connection: snapshot.connection,
      costToday: snapshot.costToday,
      costYesterday: snapshot.costYesterday,
      requestsToday: snapshot.requestsToday,
      tokenUsageToday: snapshot.tokenUsageToday,
      requiresAppUpdate: false
    )
  }

  func placeholder(in context: Context) -> ClawLinkCostEntry {
    makeEntry(now: Date())
  }

  func getSnapshot(in context: Context, completion: @escaping (ClawLinkCostEntry) -> Void) {
    completion(makeEntry(now: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ClawLinkCostEntry>) -> Void) {
    let now = Date()
    let entry = makeEntry(now: now)
    completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(15 * 60))))
  }
}

private struct CostWidgetMetricView: View {
  let label: String
  let value: String
  let accent: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(label)
        .font(.system(size: 11, weight: .medium, design: .rounded))
        .foregroundStyle(Color.secondary)
      Text(value)
        .font(.system(size: 15, weight: .bold, design: .rounded))
        .foregroundStyle(accent)
    }
  }
}

private struct ClawLinkCostWidgetView: View {
  let entry: ClawLinkCostEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var colorScheme

  private var accent: Color {
    costWidgetConnectionColor(entry.connection)
  }

  private var trend: (symbol: String, text: String, color: Color) {
    costTrend(today: entry.costToday, yesterday: entry.costYesterday)
  }

  private var backgroundGradient: LinearGradient {
    if colorScheme == .dark {
      return LinearGradient(
        colors: [
          Color(red: 0.07, green: 0.09, blue: 0.12),
          Color(red: 0.11, green: 0.14, blue: 0.18),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
    }

    return LinearGradient(
      colors: [
        Color(red: 0.99, green: 0.99, blue: 0.98),
        Color(red: 0.94, green: 0.97, blue: 0.95),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  var body: some View {
    let content = VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("Cost Today")
          .font(.system(size: 12, weight: .semibold, design: .rounded))
          .foregroundStyle(Color.secondary)
        Spacer()
        Circle()
          .fill(accent)
          .frame(width: 8, height: 8)
      }

      if entry.requiresAppUpdate {
        Text("Please update ClawLink")
          .font(.system(size: 14, weight: .bold, design: .rounded))
      } else {
        Text(entry.costToday.map { String(format: "$%.2f", $0) } ?? "$--")
          .font(.system(size: family == .systemSmall ? 28 : 30, weight: .bold, design: .rounded))
          .foregroundStyle(accent)

        if family == .systemSmall {
          HStack(spacing: 6) {
            Image(systemName: trend.symbol)
            Text(trend.text)
              .lineLimit(2)
          }
          .font(.system(size: 11, weight: .semibold, design: .rounded))
          .foregroundStyle(trend.color)
        } else {
          HStack(spacing: 16) {
            CostWidgetMetricView(label: "Requests", value: formatCompactMetric(entry.requestsToday), accent: accent)
            CostWidgetMetricView(label: "Tokens", value: formatCompactMetric(entry.tokenUsageToday), accent: accent)
          }

          HStack(spacing: 6) {
            Image(systemName: trend.symbol)
            Text(trend.text)
              .lineLimit(1)
          }
          .font(.system(size: 11, weight: .semibold, design: .rounded))
          .foregroundStyle(trend.color)
        }
      }
    }
    .padding(12)
    .widgetURL(URL(string: "clawlink://dashboard"))

    if #available(iOSApplicationExtension 17.0, *) {
      content.containerBackground(for: .widget) {
        backgroundGradient
      }
    } else {
      content.background(backgroundGradient)
    }
  }
}

struct ClawLinkCostWidget: Widget {
  let kind = "ClawLinkCostWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ClawLinkCostProvider()) { entry in
      ClawLinkCostWidgetView(entry: entry)
    }
    .configurationDisplayName("ClawLink Cost")
    .description("Track today's gateway cost, requests, and tokens.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
