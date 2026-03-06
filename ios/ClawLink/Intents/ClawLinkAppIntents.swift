import AppIntents
import Foundation

private enum ClawIntentShared {
  static let appGroup = "group.com.fadmediagroup.clawlink"
  static let snapshotKey = "system-surface:snapshot"
  static let shortcutCommandKey = "shortcut.command.pending"
}

private func stringValue(_ value: Any?, default defaultValue: String) -> String {
  guard let value = value as? String else {
    return defaultValue
  }
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmed.isEmpty ? defaultValue : trimmed
}

private func intValue(_ value: Any?, default defaultValue: Int = 0) -> Int {
  if let value = value as? Int {
    return value
  }
  if let value = value as? Double {
    return Int(value)
  }
  if let value = value as? String, let parsed = Int(value) {
    return parsed
  }
  return defaultValue
}

private func readGatewayStatusSummary() -> String {
  guard
    let defaults = UserDefaults(suiteName: ClawIntentShared.appGroup),
    let raw = defaults.string(forKey: ClawIntentShared.snapshotKey),
    let data = raw.data(using: .utf8),
    let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  else {
    return "ClawLink gateway snapshot unavailable."
  }

  let title = stringValue(json["title"], default: "ClawLink")
  let connection = stringValue(json["connection"], default: "offline").lowercased()
  let subtitle = stringValue(json["subtitle"], default: "No active tasks")
  let sessions = intValue(json["activeSessions"])
  let channels = intValue(json["activeChannels"])
  let queue = intValue(json["pendingQueue"])

  let connectionLabel: String
  if connection.contains("online") {
    connectionLabel = "online"
  } else if connection.contains("degraded") || connection.contains("reconnect") {
    connectionLabel = "reconnecting"
  } else {
    connectionLabel = "offline"
  }

  return "\(title) is \(connectionLabel). \(subtitle). Sessions \(sessions), channels \(channels), queue \(queue)."
}

private func queueShortcutCommand(
  kind: String,
  agentId: String?,
  message: String?
) -> Bool {
  guard let defaults = UserDefaults(suiteName: ClawIntentShared.appGroup) else {
    return false
  }

  let payload: [String: Any] = [
    "id": UUID().uuidString,
    "kind": kind,
    "agentId": agentId ?? NSNull(),
    "message": message ?? NSNull(),
    "createdAt": Date().timeIntervalSince1970 * 1000,
  ]

  guard
    let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
    let raw = String(data: data, encoding: .utf8)
  else {
    return false
  }

  defaults.set(raw, forKey: ClawIntentShared.shortcutCommandKey)
  defaults.synchronize()
  return true
}

@available(iOS 16.0, *)
struct ClawGatewayStatusIntent: AppIntent {
  static let title: LocalizedStringResource = "Gateway Status"
  static var description = IntentDescription("Read the latest ClawLink gateway status summary.")

  func perform() async throws -> some IntentResult & ProvidesDialog {
    .result(dialog: IntentDialog(stringLiteral: readGatewayStatusSummary()))
  }
}

@available(iOS 16.0, *)
struct ClawRestartAgentIntent: AppIntent {
  static let title: LocalizedStringResource = "Restart Agent"
  static var description = IntentDescription("Open ClawLink and restart a specific agent.")
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Agent ID")
  var agentId: String

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let normalizedAgentId = agentId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedAgentId.isEmpty else {
      return .result(dialog: "Agent ID is required.")
    }

    let queued = queueShortcutCommand(kind: "restart_agent", agentId: normalizedAgentId, message: nil)
    return .result(dialog: queued ? "Restart queued for \(normalizedAgentId)." : "Unable to queue restart request.")
  }
}

@available(iOS 16.0, *)
struct ClawSendMessageIntent: AppIntent {
  static let title: LocalizedStringResource = "Send Message"
  static var description = IntentDescription("Open ClawLink and send a message to an agent.")
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Agent ID")
  var agentId: String

  @Parameter(title: "Message")
  var message: String

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let normalizedAgentId = agentId.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)

    guard !normalizedAgentId.isEmpty else {
      return .result(dialog: "Agent ID is required.")
    }
    guard !normalizedMessage.isEmpty else {
      return .result(dialog: "Message is required.")
    }

    let queued = queueShortcutCommand(kind: "send_message", agentId: normalizedAgentId, message: normalizedMessage)
    return .result(dialog: queued ? "Message queued for \(normalizedAgentId)." : "Unable to queue message.")
  }
}

@available(iOS 16.0, *)
struct ClawLinkShortcuts: AppShortcutsProvider {
  static var shortcutTileColor: ShortcutTileColor = .teal

  static var appShortcuts: [AppShortcut] {
    [
      AppShortcut(
        intent: ClawGatewayStatusIntent(),
        phrases: [
          "Get gateway status in \(.applicationName)",
          "Check ClawLink status in \(.applicationName)",
        ],
        shortTitle: "Gateway Status",
        systemImageName: "dot.radiowaves.left.and.right"
      ),
      AppShortcut(
        intent: ClawRestartAgentIntent(),
        phrases: [
          "Restart agent \(\.$agentId) in \(.applicationName)",
        ],
        shortTitle: "Restart Agent",
        systemImageName: "arrow.clockwise.circle"
      ),
      AppShortcut(
        intent: ClawSendMessageIntent(),
        phrases: [
          "Send \(\.$message) to \(\.$agentId) in \(.applicationName)",
        ],
        shortTitle: "Send Message",
        systemImageName: "paperplane"
      ),
    ]
  }
}
