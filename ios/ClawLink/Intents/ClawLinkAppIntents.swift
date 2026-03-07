import AppIntents
import Foundation

private func queueShortcutCommand(
  kind: String,
  agentId: String?,
  message: String?
) -> Bool {
  appendShortcutIntentRequest(
    ClawShortcutIntentRequest(
      id: UUID().uuidString,
      kind: kind,
      agentId: agentId,
      message: message,
      createdAt: Date().timeIntervalSince1970 * 1000
    )
  )
}

@available(iOS 16.0, *)
struct ClawGatewayStatusIntent: AppIntent {
  static let title: LocalizedStringResource = "Gateway Status"
  static var description = IntentDescription("Read the latest ClawLink gateway status summary.")

  func perform() async throws -> some IntentResult & ProvidesDialog {
    .result(dialog: IntentDialog(stringLiteral: readShortcutGatewaySummary()))
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
    AppShortcut(
      intent: ClawGatewayStatusIntent(),
      phrases: [
        "Get gateway status in \(.applicationName)",
        "Check ClawLink status in \(.applicationName)",
      ],
      shortTitle: "Gateway Status",
      systemImageName: "dot.radiowaves.left.and.right"
    )
    AppShortcut(
      intent: ClawRestartAgentIntent(),
      phrases: [
        "Restart agent in \(.applicationName)",
        "Open agent controls in \(.applicationName)",
      ],
      shortTitle: "Restart Agent",
      systemImageName: "arrow.clockwise.circle"
    )
    AppShortcut(
      intent: ClawSendMessageIntent(),
      phrases: [
        "Send message in \(.applicationName)",
        "Open chat in \(.applicationName)",
      ],
      shortTitle: "Send Message",
      systemImageName: "paperplane"
    )
  }
}
