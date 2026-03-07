import ActivityKit
import WidgetKit
import SwiftUI

private enum ClawLiveShared {
  static let appGroup = "group.com.fadmediagroup.clawlink"
  static let dynamicIslandEnabledKey = "surface.dynamicIslandEnabled"
  static let activeProfileClassKey = "surface.activeProfileClass"
  static let focusFilterModeKey = "surface.focus.filterMode"
}

private enum SurfaceProfileClass: String {
  case production
  case nonproduction
  case unknown
}

private func readSurfaceProfileClass(defaults: UserDefaults?) -> SurfaceProfileClass {
  guard
    let raw = defaults?.string(forKey: ClawLiveShared.activeProfileClassKey)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
    let resolved = SurfaceProfileClass(rawValue: raw)
  else {
    return .unknown
  }

  return resolved
}

private func surfaceSuppressionReason() -> String? {
  let defaults = UserDefaults(suiteName: ClawLiveShared.appGroup)
  let mode = defaults?.string(forKey: ClawLiveShared.focusFilterModeKey)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? "all"
  if mode == "personal" {
    return "Hidden by Personal Focus"
  }
  if mode == "work" && readSurfaceProfileClass(defaults: defaults) != .production {
    return "Hidden for non-production gateway"
  }
  return nil
}

private enum ClawSurfaceRoute {
  static let dashboard = "dashboard"
  static let chat = "chat"
  static let monitor = "monitor"
  static let agents = "agents"
}

private func dynamicIslandEnabled() -> Bool {
  guard let defaults = UserDefaults(suiteName: ClawLiveShared.appGroup) else {
    return true
  }
  if defaults.object(forKey: ClawLiveShared.dynamicIslandEnabledKey) == nil {
    return true
  }
  return defaults.bool(forKey: ClawLiveShared.dynamicIslandEnabledKey)
}

private enum SurfaceConnectionState {
  case online
  case degraded
  case offline

  var symbol: String {
    switch self {
    case .online:
      return "checkmark.circle.fill"
    case .degraded:
      return "arrow.triangle.2.circlepath.circle.fill"
    case .offline:
      return "xmark.circle.fill"
    }
  }

  var accent: Color {
    switch self {
    case .online:
      return Color(red: 0.09, green: 0.63, blue: 0.42)
    case .degraded:
      return Color(red: 0.89, green: 0.58, blue: 0.14)
    case .offline:
      return Color(red: 0.82, green: 0.28, blue: 0.34)
    }
  }
}

private func resolveConnectionState(_ connection: String) -> SurfaceConnectionState {
  let normalized = connection.lowercased()
  if normalized.contains("online") || normalized.contains("在线") {
    return .online
  }
  if normalized.contains("degraded") || normalized.contains("重连") || normalized.contains("reconnect") {
    return .degraded
  }
  return .offline
}

private func normalizedTimestamp(_ value: Double) -> Date {
  let seconds = value > 1_000_000_000_000 ? value / 1000 : value
  if seconds.isFinite && seconds > 0 {
    return Date(timeIntervalSince1970: seconds)
  }
  return Date()
}

private func normalizedSeconds(_ value: Double) -> TimeInterval? {
  guard value.isFinite && value > 0 else {
    return nil
  }
  return value > 1_000_000_000_000 ? value / 1000 : value
}

private func compactFreshnessText(from value: Double) -> String {
  let age = max(Int(Date().timeIntervalSince(normalizedTimestamp(value))), 0)
  if age < 5 {
    return "now"
  }
  if age < 60 {
    return "\(age)s"
  }

  let minutes = age / 60
  if minutes < 60 {
    return "\(minutes)m"
  }

  let hours = minutes / 60
  if hours < 24 {
    return "\(hours)h"
  }

  return "\(hours / 24)d"
}

private func formatCostLabel(_ value: Double) -> String {
  if value < 0 {
    return "No cost"
  }
  return String(format: "$%.2f", value)
}

private func disconnectElapsedText(from disconnectedSince: Double, prefix: String) -> String {
  guard let seconds = normalizedSeconds(disconnectedSince) else {
    return prefix
  }

  let duration = max(Int(Date().timeIntervalSince1970 - seconds), 0)
  if duration < 60 {
    return "\(prefix) \(duration)s"
  }

  let minutes = duration / 60
  if minutes < 60 {
    return "\(prefix) \(minutes)m"
  }

  let hours = minutes / 60
  return "\(prefix) \(hours)h"
}

private func compactDisconnectText(from disconnectedSince: Double) -> String {
  disconnectElapsedText(from: disconnectedSince, prefix: "OFF")
}

private func expandedStatusText(state: ClawLinkActivityAttributes.ContentState, connectionState: SurfaceConnectionState) -> String {
  switch connectionState {
  case .online:
    return "ONLINE"
  case .degraded:
    return "RECONNECTING"
  case .offline:
    return disconnectElapsedText(from: state.disconnectedSince, prefix: "OFFLINE")
  }
}

private func deepLink(_ path: String) -> URL {
  URL(string: "clawlink://\(path)")!
}

struct ClawLinkActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var connection: String
    var activeAgentName: String
    var activeTaskSummary: String
    var sessionsCount: Int
    var channelsCount: Int
    var queueCount: Int
    var pendingMessages: Int
    var lastUpdated: Double
    var disconnectedSince: Double
    var costToday: Double
    var errorAgentCount: Int
  }

  var sessionId: String
  var agentName: String
}

private struct StatusIconAnimationModifier: ViewModifier {
  let connectionState: SurfaceConnectionState

  @ViewBuilder
  func body(content: Content) -> some View {
    switch connectionState {
    case .online:
      if #available(iOS 17.0, *) {
        content.symbolEffect(.pulse.byLayer, options: .repeating)
      } else {
        content
      }
    case .degraded:
      if #available(iOS 18.0, *) {
        content.symbolEffect(.rotate, options: .repeating)
      } else if #available(iOS 17.0, *) {
        content.symbolEffect(.pulse.byLayer, options: .repeating)
      } else {
        content
      }
    case .offline:
      content
    }
  }
}

private struct StatusIconView: View {
  let connectionState: SurfaceConnectionState

  var body: some View {
    Image(systemName: connectionState.symbol)
      .foregroundStyle(connectionState.accent)
      .modifier(StatusIconAnimationModifier(connectionState: connectionState))
  }
}

private struct ConnectionBadgeView: View {
  let connectionState: SurfaceConnectionState
  let label: String

  var body: some View {
    HStack(spacing: 5) {
      StatusIconView(connectionState: connectionState)
        .font(.system(size: 11, weight: .bold))
      Text(label)
        .font(.system(size: 11, weight: .bold, design: .rounded))
        .lineLimit(1)
    }
    .foregroundStyle(connectionState.accent)
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .background(connectionState.accent.opacity(0.16), in: Capsule())
  }
}

private struct LiveMetricChip: View {
  let symbol: String
  let label: String
  let valueText: String
  let tint: Color
  let textColor: Color

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: symbol)
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(tint)
      Text("\(label) \(valueText)")
        .font(.system(size: 11, weight: .semibold, design: .rounded))
        .foregroundStyle(textColor)
        .lineLimit(1)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 5)
    .background(tint.opacity(0.16), in: Capsule())
  }
}

private struct DeepLinkPillButton: View {
  let title: String
  let symbol: String
  let tint: Color
  let destination: URL

  var body: some View {
    Link(destination: destination) {
      HStack(spacing: 4) {
        Image(systemName: symbol)
          .font(.system(size: 10, weight: .semibold))
        Text(title)
          .font(.system(size: 11, weight: .bold, design: .rounded))
          .lineLimit(1)
      }
      .foregroundStyle(tint)
      .padding(.horizontal, 10)
      .padding(.vertical, 7)
      .background(tint.opacity(0.16), in: Capsule())
    }
  }
}

private struct DynamicIslandCenterContent: View {
  let context: ActivityViewContext<ClawLinkActivityAttributes>
  let connectionState: SurfaceConnectionState

  private var hasActiveAgent: Bool {
    !context.state.activeAgentName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private var displayAgentName: String {
    let name = context.state.activeAgentName.trimmingCharacters(in: .whitespacesAndNewlines)
    if !name.isEmpty {
      return name
    }

    let attributeName = context.attributes.agentName.trimmingCharacters(in: .whitespacesAndNewlines)
    return attributeName.isEmpty ? "ClawLink" : attributeName
  }

  private var displayTask: String {
    if let suppressionReason = surfaceSuppressionReason() {
      return suppressionReason
    }

    let task = context.state.activeTaskSummary.trimmingCharacters(in: .whitespacesAndNewlines)
    if !task.isEmpty {
      return task
    }
    return "No active tasks"
  }

  private var secondarySummary: String {
    if context.state.pendingMessages > 0 {
      return "\(max(0, context.state.pendingMessages)) pending sync · \(max(0, context.state.channelsCount)) channels"
    }
    if context.state.sessionsCount > 0 {
      return "\(max(0, context.state.sessionsCount)) active sessions · \(max(0, context.state.channelsCount)) channels"
    }
    if context.state.channelsCount > 0 {
      return "\(max(0, context.state.channelsCount)) channels online"
    }
    return "Ready for new work"
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      if hasActiveAgent {
        Text(displayAgentName)
          .font(.system(size: 12, weight: .bold, design: .rounded))
      } else {
        Text(displayTask)
          .font(.system(size: 12, weight: .bold, design: .rounded))
          .lineLimit(1)
      }

      Text(hasActiveAgent ? displayTask : secondarySummary)
        .font(.system(size: 11, weight: .medium, design: .rounded))
        .foregroundStyle(.primary.opacity(0.82))
        .lineLimit(1)
    }
  }
}

private struct DynamicIslandBottomActions: View {
  let errorCount: Int
  let connectionState: SurfaceConnectionState

  var body: some View {
    ViewThatFits {
      HStack(spacing: 8) {
        DeepLinkPillButton(title: "Chat", symbol: "message.fill", tint: connectionState.accent, destination: deepLink(ClawSurfaceRoute.chat))
        DeepLinkPillButton(title: "Monitor", symbol: "chart.bar.fill", tint: connectionState.accent, destination: deepLink(ClawSurfaceRoute.monitor))
        if errorCount > 0 {
          DeepLinkPillButton(
            title: "⚠ \(errorCount) Agent Error",
            symbol: "exclamationmark.triangle.fill",
            tint: Color(red: 0.82, green: 0.28, blue: 0.34),
            destination: deepLink(ClawSurfaceRoute.agents)
          )
        }
      }

      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 8) {
          DeepLinkPillButton(title: "Chat", symbol: "message.fill", tint: connectionState.accent, destination: deepLink(ClawSurfaceRoute.chat))
          DeepLinkPillButton(title: "Monitor", symbol: "chart.bar.fill", tint: connectionState.accent, destination: deepLink(ClawSurfaceRoute.monitor))
        }
        if errorCount > 0 {
          DeepLinkPillButton(
            title: "⚠ \(errorCount) Agent Error",
            symbol: "exclamationmark.triangle.fill",
            tint: Color(red: 0.82, green: 0.28, blue: 0.34),
            destination: deepLink(ClawSurfaceRoute.agents)
          )
        }
      }
    }
  }
}

private struct ClawLinkLiveActivityView: View {
  let context: ActivityViewContext<ClawLinkActivityAttributes>
  @Environment(\.colorScheme) private var colorScheme

  private var connectionState: SurfaceConnectionState {
    resolveConnectionState(context.state.connection)
  }

  private var hasActiveAgent: Bool {
    !context.state.activeAgentName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private var primaryText: Color {
    colorScheme == .dark ? Color(red: 0.95, green: 0.99, blue: 1.0) : Color(red: 0.12, green: 0.18, blue: 0.22)
  }

  private var secondaryText: Color {
    colorScheme == .dark ? Color(red: 0.73, green: 0.80, blue: 0.87) : Color(red: 0.29, green: 0.36, blue: 0.42)
  }

  private var panelBackground: LinearGradient {
    if colorScheme == .dark {
      return LinearGradient(
        colors: [
          Color(red: 0.08, green: 0.11, blue: 0.13),
          Color(red: 0.12, green: 0.15, blue: 0.18),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
    }

    return LinearGradient(
      colors: [
        Color(red: 0.98, green: 0.99, blue: 1.0),
        Color(red: 0.95, green: 0.97, blue: 0.99),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  private var syncProgress: Double {
    let queue = max(context.state.queueCount, 0)
    let pending = max(context.state.pendingMessages, 0)
    if queue <= 0 {
      return 1
    }
    let synced = max(queue - pending, 0)
    return max(0, min(1, Double(synced) / Double(queue)))
  }

  private var displayAgentName: String {
    let explicit = context.state.activeAgentName.trimmingCharacters(in: .whitespacesAndNewlines)
    if !explicit.isEmpty {
      return explicit
    }

    let attributeName = context.attributes.agentName.trimmingCharacters(in: .whitespacesAndNewlines)
    return attributeName.isEmpty ? "ClawLink" : attributeName
  }

  private var displayTask: String {
    let task = context.state.activeTaskSummary.trimmingCharacters(in: .whitespacesAndNewlines)
    if !task.isEmpty {
      return task
    }
    return "All quiet"
  }

  private var summaryMetricLabel: String {
    if context.state.pendingMessages > 0 {
      return "\(max(0, context.state.pendingMessages))"
    }
    return formatCostLabel(context.state.costToday)
  }

  private var summaryMetricSymbol: String {
    context.state.pendingMessages > 0 ? "arrow.triangle.2.circlepath.circle.fill" : "dollarsign.circle.fill"
  }

  private var syncLabel: String {
    "\(max(context.state.queueCount - context.state.pendingMessages, 0))/\(max(context.state.queueCount, 0)) synced"
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      if context.state.errorAgentCount > 0 {
        HStack(spacing: 8) {
          Image(systemName: "exclamationmark.triangle.fill")
          Text("⚠ \(context.state.errorAgentCount) Agent Error")
            .lineLimit(1)
          Spacer(minLength: 0)
        }
        .font(.system(size: 12, weight: .bold, design: .rounded))
        .foregroundStyle(Color(red: 0.82, green: 0.28, blue: 0.34))
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Color(red: 0.82, green: 0.28, blue: 0.34).opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      }

      HStack(alignment: .top, spacing: 10) {
        Text(displayAgentName)
          .font(.system(size: 17, weight: .semibold, design: .rounded))
          .foregroundStyle(primaryText)
          .lineLimit(1)

        Spacer(minLength: 8)

        ConnectionBadgeView(
          connectionState: connectionState,
          label: expandedStatusText(state: context.state, connectionState: connectionState)
        )
      }

      VStack(alignment: .leading, spacing: 10) {
        Text(displayTask)
          .font(.system(size: 12, weight: hasActiveAgent ? .medium : .semibold, design: .rounded))
          .foregroundStyle(hasActiveAgent ? secondaryText : primaryText)
          .lineLimit(2)

        HStack(spacing: 8) {
          LiveMetricChip(
            symbol: "person.2.fill",
            label: "Sessions",
            valueText: "\(max(0, context.state.sessionsCount))",
            tint: connectionState.accent,
            textColor: primaryText
          )
          LiveMetricChip(
            symbol: "bolt.horizontal.fill",
            label: "Channels",
            valueText: "\(max(0, context.state.channelsCount))",
            tint: connectionState.accent,
            textColor: primaryText
          )
          LiveMetricChip(
            symbol: summaryMetricSymbol,
            label: context.state.pendingMessages > 0 ? "Sync" : "Cost",
            valueText: summaryMetricLabel,
            tint: connectionState.accent,
            textColor: primaryText
          )
        }
      }

      VStack(spacing: 6) {
        HStack {
          if context.state.costToday >= 0 {
            Text(formatCostLabel(context.state.costToday))
              .font(.system(size: 11, weight: .semibold, design: .rounded))
              .foregroundStyle(primaryText)
          } else {
            Text("Cost unavailable")
              .font(.system(size: 11, weight: .medium, design: .rounded))
              .foregroundStyle(secondaryText)
          }

          Spacer()

          Text(compactFreshnessText(from: context.state.lastUpdated))
            .font(.system(size: 11, weight: .medium, design: .rounded))
            .foregroundStyle(secondaryText)
        }

        if context.state.pendingMessages > 0 {
          HStack {
            Text(syncLabel)
              .font(.system(size: 11, weight: .semibold, design: .rounded))
              .foregroundStyle(secondaryText)
            Spacer()
          }
          ProgressView(value: syncProgress)
            .tint(connectionState.accent)
        }
      }
    }
    .padding(14)
    .background(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .fill(panelBackground)
        .overlay(
          RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(connectionState.accent.opacity(0.32), lineWidth: 0.8)
        )
    )
    .activityBackgroundTint(Color.clear)
    .activitySystemActionForegroundColor(primaryText)
    .widgetURL(deepLink(ClawSurfaceRoute.dashboard))
  }
}

struct ClawLinkLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: ClawLinkActivityAttributes.self) { context in
      ClawLinkLiveActivityView(context: context)
    } dynamicIsland: { context in
      let islandEnabled = dynamicIslandEnabled()
      let connectionState = resolveConnectionState(context.state.connection)

      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          if islandEnabled {
            ConnectionBadgeView(
              connectionState: connectionState,
              label: expandedStatusText(state: context.state, connectionState: connectionState)
            )
            .dynamicIsland(verticalPlacement: .belowIfTooWide)
          }
        }

        DynamicIslandExpandedRegion(.trailing) {
          if islandEnabled {
            VStack(alignment: .trailing, spacing: 2) {
              Text(compactFreshnessText(from: context.state.lastUpdated))
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .lineLimit(1)
              if context.state.costToday >= 0 {
                Text(formatCostLabel(context.state.costToday))
                  .font(.system(size: 12, weight: .bold, design: .rounded))
                  .lineLimit(1)
              }
            }
            .foregroundStyle(connectionState.accent)
            .dynamicIsland(verticalPlacement: .belowIfTooWide)
          }
        }

        DynamicIslandExpandedRegion(.center) {
          if islandEnabled {
            DynamicIslandCenterContent(context: context, connectionState: connectionState)
              .dynamicIsland(verticalPlacement: .belowIfTooWide)
          }
        }

        DynamicIslandExpandedRegion(.bottom) {
          if islandEnabled {
            DynamicIslandBottomActions(errorCount: context.state.errorAgentCount, connectionState: connectionState)
          } else {
            Text("Dynamic Island disabled")
              .font(.caption2)
              .foregroundStyle(Color.secondary)
          }
        }
      } compactLeading: {
        if islandEnabled {
          StatusIconView(connectionState: connectionState)
            .font(.system(size: 13, weight: .semibold))
        } else {
          Image(systemName: "pause.circle")
            .foregroundStyle(Color.secondary)
        }
      } compactTrailing: {
        if islandEnabled {
          if context.state.errorAgentCount > 0 {
            Text("⚠\(context.state.errorAgentCount)")
              .font(.system(size: 12, weight: .bold, design: .rounded))
              .foregroundStyle(Color(red: 0.82, green: 0.28, blue: 0.34))
          } else {
            switch connectionState {
            case .online:
              if context.state.pendingMessages > 0 {
                Text("↻\(max(0, context.state.pendingMessages))")
                  .font(.system(size: 12, weight: .bold, design: .rounded))
                  .foregroundStyle(connectionState.accent)
              } else if context.state.costToday >= 0 {
                Text(formatCostLabel(context.state.costToday))
                  .font(.system(size: 12, weight: .bold, design: .rounded))
                  .foregroundStyle(connectionState.accent)
              } else {
                Text(compactFreshnessText(from: context.state.lastUpdated))
                  .font(.system(size: 12, weight: .bold, design: .rounded))
                  .foregroundStyle(connectionState.accent)
              }
            case .degraded:
              if context.state.pendingMessages > 0 {
                Text("↻\(max(0, context.state.pendingMessages))")
                  .font(.system(size: 12, weight: .bold, design: .rounded))
                  .foregroundStyle(connectionState.accent)
              } else {
                Text("Retry")
                  .font(.system(size: 11, weight: .bold, design: .rounded))
                  .foregroundStyle(connectionState.accent)
              }
            case .offline:
              Text(compactDisconnectText(from: context.state.disconnectedSince))
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(connectionState.accent)
            }
          }
        } else {
          Text("--")
            .font(.system(size: 12, weight: .bold, design: .rounded))
            .foregroundStyle(Color.secondary)
        }
      } minimal: {
        if islandEnabled {
          if context.state.errorAgentCount > 0 {
            Image(systemName: "exclamationmark.triangle.fill")
              .font(.system(size: 12, weight: .bold))
              .foregroundStyle(Color(red: 0.82, green: 0.28, blue: 0.34))
          } else {
            switch connectionState {
            case .online:
              if context.state.queueCount > 0 || context.state.pendingMessages > 0 {
                Text("\(max(0, context.state.queueCount))")
                  .font(.system(size: 11, weight: .bold, design: .rounded))
                  .foregroundStyle(connectionState.accent)
              } else {
                Circle()
                  .fill(connectionState.accent)
                  .frame(width: 10, height: 10)
              }
            case .degraded:
              StatusIconView(connectionState: connectionState)
                .font(.system(size: 11, weight: .bold))
            case .offline:
              Circle()
                .fill(connectionState.accent)
                .frame(width: 10, height: 10)
            }
          }
        } else {
          Image(systemName: "pause.circle.fill")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(Color.secondary)
        }
      }
      .widgetURL(deepLink(ClawSurfaceRoute.dashboard))
    }
  }
}
