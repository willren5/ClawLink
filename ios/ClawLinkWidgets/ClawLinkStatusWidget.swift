import ActivityKit
import WidgetKit
import SwiftUI
import AppIntents

private enum ClawWidgetShared {
  static let appGroup = "group.com.fadmediagroup.clawlink"
  static let snapshotKey = "system-surface:snapshot"
  static let widgetEnabledKey = "surface.widgetEnabled"
  static let activeProfileClassKey = "surface.activeProfileClass"
  static let supportedSchemaVersion = 1
  static let controlRefreshAtKey = "surface.control.refreshRequestedAt"
  static let focusFilterModeKey = "surface.focus.filterMode"
}

private enum SurfaceProfileClass: String {
  case production
  case nonproduction
  case unknown
}

private func readSurfaceProfileClass(defaults: UserDefaults?) -> SurfaceProfileClass {
  guard
    let raw = defaults?.string(forKey: ClawWidgetShared.activeProfileClassKey)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
    let resolved = SurfaceProfileClass(rawValue: raw)
  else {
    return .unknown
  }

  return resolved
}

private func surfaceSuppressionReason(defaults: UserDefaults?) -> String? {
  let mode = defaults?.string(forKey: ClawWidgetShared.focusFilterModeKey)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? "all"
  if mode == "personal" {
    return "Hidden by Personal Focus"
  }
  if mode == "work" && readSurfaceProfileClass(defaults: defaults) != .production {
    return "Hidden for non-production gateway"
  }
  return nil
}

private extension KeyedDecodingContainer {
  func decodeStringValue(forKey key: Key, default defaultValue: String) -> String {
    let value = (try? decodeIfPresent(String.self, forKey: key))?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let value, !value.isEmpty {
      return value
    }
    return defaultValue
  }

  func decodeIntValue(forKey key: Key, default defaultValue: Int) -> Int {
    max((try? decodeIfPresent(Int.self, forKey: key)) ?? defaultValue, 0)
  }

  func decodeDoubleValue(forKey key: Key, default defaultValue: Double) -> Double {
    let value = (try? decodeIfPresent(Double.self, forKey: key)) ?? defaultValue
    return value.isFinite ? value : defaultValue
  }
}

private func fallbackWidgetTimestamp() -> Double {
  Date().timeIntervalSince1970 * 1000
}

private func deepLink(_ path: String) -> URL {
  URL(string: "clawlink://\(path)")!
}

private struct SharedSurfaceSnapshot: Codable {
  struct ActiveAgentSnapshot: Codable {
    let agentId: String
    let agentName: String
    let currentTask: String
    let model: String?
    let isStreaming: Bool

    private enum CodingKeys: String, CodingKey {
      case agentId
      case agentName
      case currentTask
      case model
      case isStreaming
    }

    init(from decoder: Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      self.agentId = container.decodeStringValue(forKey: .agentId, default: "")
      self.agentName = container.decodeStringValue(forKey: .agentName, default: "")
      self.currentTask = container.decodeStringValue(forKey: .currentTask, default: "")
      let normalizedModel = (try? container.decodeIfPresent(String.self, forKey: .model))?.trimmingCharacters(in: .whitespacesAndNewlines)
      self.model = normalizedModel?.isEmpty == false ? normalizedModel : nil
      self.isStreaming = (try? container.decodeIfPresent(Bool.self, forKey: .isStreaming)) ?? false
    }
  }

  let schemaVersion: Int?
  let title: String
  let subtitle: String
  let icon: String
  let connection: String
  let activeSessions: Int
  let activeChannels: Int
  let pendingQueue: Int
  let pendingMessages: Int?
  let timestamp: Double
  let disconnectedSince: Double?
  let activeAgent: ActiveAgentSnapshot?
  let costToday: Double?
  let errorCount: Int?

  private enum CodingKeys: String, CodingKey {
    case schemaVersion
    case title
    case subtitle
    case icon
    case connection
    case activeSessions
    case activeChannels
    case pendingQueue
    case pendingMessages
    case timestamp
    case disconnectedSince
    case activeAgent
    case costToday
    case errorCount
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.schemaVersion = try? container.decodeIfPresent(Int.self, forKey: .schemaVersion)
    self.title = container.decodeStringValue(forKey: .title, default: "ClawLink")
    self.subtitle = container.decodeStringValue(forKey: .subtitle, default: "")
    self.icon = container.decodeStringValue(forKey: .icon, default: "checkmark.circle.fill")
    self.connection = container.decodeStringValue(forKey: .connection, default: "offline")
    self.activeSessions = container.decodeIntValue(forKey: .activeSessions, default: 0)
    self.activeChannels = container.decodeIntValue(forKey: .activeChannels, default: 0)
    self.pendingQueue = container.decodeIntValue(forKey: .pendingQueue, default: 0)
    if let pendingMessages = try? container.decodeIfPresent(Int.self, forKey: .pendingMessages) {
      self.pendingMessages = max(pendingMessages, 0)
    } else {
      self.pendingMessages = nil
    }
    self.timestamp = container.decodeDoubleValue(forKey: .timestamp, default: fallbackWidgetTimestamp())
    self.disconnectedSince = try? container.decodeIfPresent(Double.self, forKey: .disconnectedSince)
    self.activeAgent = try? container.decodeIfPresent(ActiveAgentSnapshot.self, forKey: .activeAgent)
    self.costToday = try? container.decodeIfPresent(Double.self, forKey: .costToday)
    self.errorCount = try? container.decodeIfPresent(Int.self, forKey: .errorCount)
  }
}

private struct ClawLinkStatusEntry: TimelineEntry {
  let date: Date
  let title: String
  let subtitle: String
  let connection: String
  let pendingQueue: Int
  let activeSessions: Int
  let activeChannels: Int
  let costToday: Double?
  let errorCount: Int
  let widgetEnabled: Bool
  let requiresAppUpdate: Bool
  let surfacesSuppressed: Bool
  let suppressionReason: String?
}

private func normalizedConnection(_ value: String) -> String {
  let normalized = value.lowercased()
  if normalized.contains("online") {
    return "online"
  }
  if normalized.contains("degraded") || normalized.contains("reconnect") {
    return "degraded"
  }
  return "offline"
}

private func connectionColor(_ connection: String) -> Color {
  switch normalizedConnection(connection) {
  case "online":
    return Color(red: 0.09, green: 0.63, blue: 0.42)
  case "degraded":
    return Color(red: 0.89, green: 0.58, blue: 0.14)
  default:
    return Color(red: 0.82, green: 0.28, blue: 0.34)
  }
}

private func connectionLabel(_ connection: String) -> String {
  switch normalizedConnection(connection) {
  case "online":
    return "Online"
  case "degraded":
    return "Reconnecting"
  default:
    return "Offline"
  }
}

private struct ClawLinkStatusProvider: TimelineProvider {
  private func readSnapshot() -> SharedSurfaceSnapshot? {
    guard
      let defaults = UserDefaults(suiteName: ClawWidgetShared.appGroup),
      let raw = defaults.string(forKey: ClawWidgetShared.snapshotKey),
      let data = raw.data(using: .utf8)
    else {
      return nil
    }

    return try? JSONDecoder().decode(SharedSurfaceSnapshot.self, from: data)
  }

  private func readWidgetEnabled() -> Bool {
    guard let defaults = UserDefaults(suiteName: ClawWidgetShared.appGroup) else {
      return true
    }
    if defaults.object(forKey: ClawWidgetShared.widgetEnabledKey) == nil {
      return true
    }
    return defaults.bool(forKey: ClawWidgetShared.widgetEnabledKey)
  }

  private func makeEntry(now: Date) -> ClawLinkStatusEntry {
    let defaults = UserDefaults(suiteName: ClawWidgetShared.appGroup)
    let suppressionReason = surfaceSuppressionReason(defaults: defaults)
    let surfacesSuppressed = suppressionReason != nil

    if let snapshot = readSnapshot() {
      let schemaVersion = snapshot.schemaVersion ?? 1
      if schemaVersion > ClawWidgetShared.supportedSchemaVersion {
        return ClawLinkStatusEntry(
          date: now,
          title: "ClawLink",
          subtitle: "Please update ClawLink",
          connection: "offline",
          pendingQueue: 0,
          activeSessions: 0,
          activeChannels: 0,
          costToday: nil,
          errorCount: 0,
          widgetEnabled: readWidgetEnabled(),
          requiresAppUpdate: true,
          surfacesSuppressed: surfacesSuppressed,
          suppressionReason: suppressionReason
        )
      }

      let subtitle = snapshot.subtitle.isEmpty ? "No surface snapshot detail yet" : snapshot.subtitle
      return ClawLinkStatusEntry(
        date: now,
        title: snapshot.title,
        subtitle: subtitle,
        connection: snapshot.connection,
        pendingQueue: max(snapshot.pendingQueue, 0),
        activeSessions: max(snapshot.activeSessions, 0),
        activeChannels: max(snapshot.activeChannels, 0),
        costToday: snapshot.costToday,
        errorCount: max(snapshot.errorCount ?? 0, 0),
        widgetEnabled: readWidgetEnabled(),
        requiresAppUpdate: false,
        surfacesSuppressed: surfacesSuppressed,
        suppressionReason: suppressionReason
      )
    }

    return ClawLinkStatusEntry(
      date: now,
      title: "ClawLink",
      subtitle: "No surface snapshot yet",
      connection: "offline",
      pendingQueue: 0,
      activeSessions: 0,
      activeChannels: 0,
      costToday: nil,
      errorCount: 0,
      widgetEnabled: readWidgetEnabled(),
      requiresAppUpdate: false,
      surfacesSuppressed: surfacesSuppressed,
      suppressionReason: suppressionReason
    )
  }

  private func nextRefreshSeconds(for entry: ClawLinkStatusEntry) -> TimeInterval {
    if entry.requiresAppUpdate {
      return 15 * 60
    }

    if entry.surfacesSuppressed {
      return 5 * 60
    }

    if normalizedConnection(entry.connection) == "offline" {
      return 15 * 60
    }

    if entry.pendingQueue > 0 {
      return 30
    }

    return 5 * 60
  }

  func placeholder(in context: Context) -> ClawLinkStatusEntry {
    makeEntry(now: Date())
  }

  func getSnapshot(in context: Context, completion: @escaping (ClawLinkStatusEntry) -> Void) {
    completion(makeEntry(now: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ClawLinkStatusEntry>) -> Void) {
    let now = Date()
    let entry = makeEntry(now: now)
    let timeline = Timeline(entries: [entry], policy: .after(now.addingTimeInterval(nextRefreshSeconds(for: entry))))
    completion(timeline)
  }
}

private struct StatusMetricView: View {
  let title: String
  let value: String
  let titleColor: Color
  let valueColor: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title)
        .font(.caption2)
        .foregroundStyle(titleColor)
      Text(value)
        .font(.headline)
        .fontWeight(.semibold)
        .foregroundStyle(valueColor)
    }
  }
}

private struct ClawLinkStatusWidgetView: View {
  let entry: ClawLinkStatusEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var colorScheme

  private var widgetBackground: LinearGradient {
    let colors: [Color] =
      colorScheme == .dark
      ? [
        Color(red: 0.05, green: 0.07, blue: 0.08),
        Color(red: 0.10, green: 0.13, blue: 0.15)
      ]
      : [
        Color(red: 0.98, green: 0.99, blue: 1.0),
        Color(red: 0.95, green: 0.97, blue: 0.98)
      ]
    return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
  }

  private var titleColor: Color {
    colorScheme == .dark
      ? Color(red: 0.79, green: 1.0, blue: 0.96)
      : Color(red: 0.15, green: 0.27, blue: 0.32)
  }

  private var primaryTextColor: Color {
    colorScheme == .dark
      ? Color(red: 0.88, green: 0.96, blue: 0.99)
      : Color(red: 0.16, green: 0.24, blue: 0.29)
  }

  private var secondaryTextColor: Color {
    colorScheme == .dark
      ? Color(red: 0.67, green: 0.77, blue: 0.81)
      : Color(red: 0.33, green: 0.43, blue: 0.49)
  }

  @ViewBuilder
  private var systemContent: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(entry.title)
        .font(.headline)
        .foregroundStyle(titleColor)

      if entry.surfacesSuppressed {
        Text(entry.suppressionReason ?? "Hidden by Focus")
          .font(.caption)
          .foregroundStyle(secondaryTextColor)
      } else if entry.widgetEnabled && !entry.requiresAppUpdate {
        Text(entry.subtitle)
          .font(.caption)
          .lineLimit(2)
          .foregroundStyle(primaryTextColor)

        HStack(spacing: 12) {
          StatusMetricView(title: "Sessions", value: "\(entry.activeSessions)", titleColor: secondaryTextColor, valueColor: primaryTextColor)
          StatusMetricView(title: "Channels", value: "\(entry.activeChannels)", titleColor: secondaryTextColor, valueColor: primaryTextColor)
          StatusMetricView(title: "Queue", value: "\(entry.pendingQueue)", titleColor: secondaryTextColor, valueColor: primaryTextColor)
        }

        if let cost = entry.costToday, cost >= 0 {
          Text(String(format: "Cost $%.2f", cost))
            .font(.caption2)
            .foregroundStyle(secondaryTextColor)
        }

        if entry.errorCount > 0 {
          Text("⚠ \(entry.errorCount) Agent Error")
            .font(.caption2)
            .foregroundStyle(Color(red: 0.82, green: 0.28, blue: 0.34))
        }
      } else {
        Text(entry.requiresAppUpdate ? "Please update ClawLink" : "Widget updates are disabled")
          .font(.caption)
          .foregroundStyle(secondaryTextColor)
      }

      Text("\(connectionLabel(entry.connection)) · \(entry.date.formatted(date: .omitted, time: .shortened))")
        .font(.caption2)
        .foregroundStyle(secondaryTextColor)
    }
    .padding(12)
  }

  @ViewBuilder
  private var lockScreenContent: some View {
    switch family {
    case .accessoryCircular:
      ZStack {
        Circle()
          .stroke(connectionColor(entry.connection).opacity(0.28), lineWidth: 3)
        Circle()
          .trim(from: 0, to: 1)
          .stroke(connectionColor(entry.connection), style: StrokeStyle(lineWidth: 3, lineCap: .round))
          .rotationEffect(.degrees(-90))
        Text("\(max(entry.pendingQueue, 0))")
          .font(.system(size: 12, weight: .bold, design: .rounded))
      }
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text(
          entry.surfacesSuppressed
            ? "Focus filtered"
            : "\(connectionLabel(entry.connection)) · S\(entry.activeSessions) C\(entry.activeChannels) Q\(entry.pendingQueue)"
        )
          .font(.system(size: 11, weight: .semibold, design: .rounded))
          .lineLimit(1)
        if entry.errorCount > 0 {
          Text("⚠ \(entry.errorCount) Agent Error")
            .font(.system(size: 10, weight: .bold, design: .rounded))
            .foregroundStyle(Color(red: 0.82, green: 0.28, blue: 0.34))
        }
      }
    case .accessoryInline:
      Text(entry.surfacesSuppressed ? "ClawLink ● Focus filtered" : "ClawLink ● \(entry.activeSessions) Sessions")
    default:
      EmptyView()
    }
  }

  var body: some View {
    let content = Group {
      if family == .systemSmall || family == .systemMedium {
        systemContent
      } else {
        lockScreenContent
      }
    }
    .widgetURL(deepLink("dashboard"))

    if #available(iOSApplicationExtension 17.0, *) {
      content.containerBackground(for: .widget) {
        widgetBackground
      }
    } else {
      content.background(widgetBackground)
    }
  }
}

struct ClawLinkStatusWidget: Widget {
  let kind: String = "ClawLinkStatusWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ClawLinkStatusProvider()) { entry in
      ClawLinkStatusWidgetView(entry: entry)
    }
    .configurationDisplayName("ClawLink Overview")
    .description("Quick view of gateway status, queue, and cost.")
    .supportedFamilies([
      .systemSmall,
      .systemMedium,
      .accessoryCircular,
      .accessoryRectangular,
      .accessoryInline,
    ])
  }
}

@available(iOS 16.0, *)
enum ClawLinkFocusFilterMode: String, AppEnum {
  case work
  case personal
  case all

  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "ClawLink Focus Filter")

  static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
    .work: DisplayRepresentation(title: "Work"),
    .personal: DisplayRepresentation(title: "Personal"),
    .all: DisplayRepresentation(title: "All"),
  ]
}

@available(iOS 16.0, *)
struct ClawLinkFocusFilterIntent: SetFocusFilterIntent {
  static var title: LocalizedStringResource = "ClawLink Notifications"
  static var description = IntentDescription("Filter ClawLink alerts by gateway profile type.")

  @Parameter(title: "Filter mode", default: .all)
  var mode: ClawLinkFocusFilterMode

  var displayRepresentation: DisplayRepresentation {
    switch mode {
    case .work:
      return DisplayRepresentation(title: "Work")
    case .personal:
      return DisplayRepresentation(title: "Personal")
    case .all:
      return DisplayRepresentation(title: "All")
    }
  }

  func perform() async throws -> some IntentResult {
    if let defaults = UserDefaults(suiteName: ClawWidgetShared.appGroup) {
      defaults.set(mode.rawValue, forKey: ClawWidgetShared.focusFilterModeKey)
      defaults.synchronize()
    }
    WidgetCenter.shared.reloadAllTimelines()
    if #available(iOSApplicationExtension 16.1, *),
      surfaceSuppressionReason(defaults: UserDefaults(suiteName: ClawWidgetShared.appGroup)) != nil
    {
      for activity in Activity<ClawLinkActivityAttributes>.activities {
        await activity.end(dismissalPolicy: .immediate)
      }
    }
    return .result()
  }
}

@available(iOSApplicationExtension 18.0, *)
struct RefreshGatewayStatusIntent: AppIntent {
  static var title: LocalizedStringResource = "Refresh Gateway"

  func perform() async throws -> some IntentResult {
    if let defaults = UserDefaults(suiteName: ClawWidgetShared.appGroup) {
      defaults.set(Date().timeIntervalSince1970 * 1000, forKey: ClawWidgetShared.controlRefreshAtKey)
      defaults.synchronize()
    }
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
  }
}

@available(iOSApplicationExtension 18.0, *)
struct ClawLinkControlWidget: ControlWidget {
  @available(iOSApplicationExtension 18.0, *)
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "ClawLinkControlWidget") {
      ControlWidgetButton(action: RefreshGatewayStatusIntent()) {
        Label("Refresh Gateway", systemImage: "arrow.clockwise.circle.fill")
      }
    }
    .displayName("ClawLink Refresh")
    .description("Request a gateway status refresh from Control Center.")
  }
}
