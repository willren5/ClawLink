import WidgetKit
import SwiftUI

private enum ClawMultiGatewayShared {
  static let appGroup = "group.com.fadmediagroup.clawlink"
  static let multiGatewayKey = "multi-gateway:status"
  static let activeProfileClassKey = "surface.activeProfileClass"
  static let focusFilterModeKey = "surface.focus.filterMode"
  static let supportedSchemaVersion = 1
}

private enum SurfaceProfileClass: String {
  case production
  case nonproduction
  case unknown
}

private func readSurfaceProfileClass(defaults: UserDefaults?) -> SurfaceProfileClass {
  guard
    let raw = defaults?.string(forKey: ClawMultiGatewayShared.activeProfileClassKey)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
    let resolved = SurfaceProfileClass(rawValue: raw)
  else {
    return .unknown
  }

  return resolved
}

private func surfaceSuppressionReason(defaults: UserDefaults?) -> String? {
  let mode = defaults?.string(forKey: ClawMultiGatewayShared.focusFilterModeKey)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? "all"
  if mode == "personal" {
    return "Hidden by Personal Focus"
  }
  if mode == "work" && readSurfaceProfileClass(defaults: defaults) != .production {
    return "Hidden for non-production gateway"
  }
  return nil
}

private struct MultiGatewaySnapshot: Decodable {
  struct GatewayItem: Decodable {
    let gatewayId: String
    let name: String
    let status: String
    let lastCheck: Double
    let isActive: Bool
  }

  let schemaVersion: Int?
  let updatedAt: Double
  let gateways: [GatewayItem]
}

private struct ClawLinkMultiGatewayEntry: TimelineEntry {
  let date: Date
  let gateways: [MultiGatewaySnapshot.GatewayItem]
  let requiresAppUpdate: Bool
  let surfacesSuppressed: Bool
  let suppressionReason: String?
}

private func multiGatewayStatusColor(_ status: String) -> Color {
  let normalized = status.lowercased()
  if normalized.contains("online") {
    return Color(red: 0.09, green: 0.63, blue: 0.42)
  }
  if normalized.contains("degraded") || normalized.contains("reconnect") {
    return Color(red: 0.89, green: 0.58, blue: 0.14)
  }
  return Color(red: 0.82, green: 0.28, blue: 0.34)
}

private func multiGatewayStatusLabel(_ status: String) -> String {
  let normalized = status.lowercased()
  if normalized.contains("online") {
    return "Online"
  }
  if normalized.contains("degraded") || normalized.contains("reconnect") {
    return "Reconnecting"
  }
  return "Offline"
}

private struct ClawLinkMultiGatewayProvider: TimelineProvider {
  private func readSnapshot() -> MultiGatewaySnapshot? {
    guard
      let defaults = UserDefaults(suiteName: ClawMultiGatewayShared.appGroup),
      let raw = defaults.string(forKey: ClawMultiGatewayShared.multiGatewayKey),
      let data = raw.data(using: .utf8)
    else {
      return nil
    }

    return try? JSONDecoder().decode(MultiGatewaySnapshot.self, from: data)
  }

  private func makeEntry(now: Date) -> ClawLinkMultiGatewayEntry {
    let defaults = UserDefaults(suiteName: ClawMultiGatewayShared.appGroup)
    let suppressionReason = surfaceSuppressionReason(defaults: defaults)
    let surfacesSuppressed = suppressionReason != nil

    guard let snapshot = readSnapshot() else {
      return ClawLinkMultiGatewayEntry(
        date: now,
        gateways: [],
        requiresAppUpdate: false,
        surfacesSuppressed: surfacesSuppressed,
        suppressionReason: suppressionReason
      )
    }

    let schemaVersion = snapshot.schemaVersion ?? 1
    return ClawLinkMultiGatewayEntry(
      date: now,
      gateways: schemaVersion > ClawMultiGatewayShared.supportedSchemaVersion ? [] : Array(snapshot.gateways.prefix(3)),
      requiresAppUpdate: schemaVersion > ClawMultiGatewayShared.supportedSchemaVersion,
      surfacesSuppressed: surfacesSuppressed,
      suppressionReason: suppressionReason
    )
  }

  func placeholder(in context: Context) -> ClawLinkMultiGatewayEntry {
    makeEntry(now: Date())
  }

  func getSnapshot(in context: Context, completion: @escaping (ClawLinkMultiGatewayEntry) -> Void) {
    completion(makeEntry(now: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ClawLinkMultiGatewayEntry>) -> Void) {
    let now = Date()
    let entry = makeEntry(now: now)
    completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(10 * 60))))
  }
}

private struct ClawLinkMultiGatewayWidgetView: View {
  let entry: ClawLinkMultiGatewayEntry
  @Environment(\.colorScheme) private var colorScheme

  private var backgroundGradient: LinearGradient {
    if colorScheme == .dark {
      return LinearGradient(
        colors: [Color(red: 0.07, green: 0.09, blue: 0.12), Color(red: 0.11, green: 0.14, blue: 0.18)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
    }

    return LinearGradient(
      colors: [Color(red: 0.99, green: 0.99, blue: 0.98), Color(red: 0.94, green: 0.97, blue: 0.95)],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  var body: some View {
    let content = VStack(alignment: .leading, spacing: 10) {
      Text("Gateways")
        .font(.system(size: 12, weight: .semibold, design: .rounded))
        .foregroundStyle(Color.secondary)

      if entry.requiresAppUpdate {
        Text("Please update ClawLink")
          .font(.system(size: 14, weight: .bold, design: .rounded))
      } else if entry.surfacesSuppressed {
        Text(entry.suppressionReason ?? "Hidden by Focus")
          .font(.system(size: 13, weight: .medium, design: .rounded))
          .foregroundStyle(Color.secondary)
      } else if entry.gateways.isEmpty {
        Text("No gateway status yet")
          .font(.system(size: 13, weight: .medium, design: .rounded))
          .foregroundStyle(Color.secondary)
      } else {
        ForEach(Array(entry.gateways.enumerated()), id: \.element.gatewayId) { _, gateway in
          HStack(spacing: 10) {
            Circle()
              .fill(multiGatewayStatusColor(gateway.status))
              .frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 2) {
              HStack(spacing: 6) {
                Text(gateway.name)
                  .font(.system(size: 13, weight: .bold, design: .rounded))
                  .lineLimit(1)
                if gateway.isActive {
                  Text("ACTIVE")
                    .font(.system(size: 9, weight: .black, design: .rounded))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color(red: 0.15, green: 0.4, blue: 0.33).opacity(0.16), in: Capsule())
                }
              }
              Text(multiGatewayStatusLabel(gateway.status))
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(Color.secondary)
            }
            Spacer()
          }
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

struct ClawLinkMultiGatewayWidget: Widget {
  let kind = "ClawLinkMultiGatewayWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ClawLinkMultiGatewayProvider()) { entry in
      ClawLinkMultiGatewayWidgetView(entry: entry)
    }
    .configurationDisplayName("ClawLink Gateways")
    .description("Overview of up to three saved gateways.")
    .supportedFamilies([.systemMedium])
  }
}
