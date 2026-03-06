import Foundation

enum ClawIntentShared {
  static let appGroup = "group.com.fadmediagroup.clawlink"
  static let snapshotKey = "system-surface:snapshot"
  static let shortcutQueueKey = "shortcut-intents:queue"
}

struct ClawShortcutIntentRequest: Codable {
  let id: String
  let kind: String
  let agentId: String?
  let message: String?
  let createdAt: Double
}

private struct ClawIntentStatusSnapshot: Decodable {
  let title: String
  let connection: String
  let subtitle: String
  let activeSessions: Int
  let activeChannels: Int
  let pendingQueue: Int

  private enum CodingKeys: String, CodingKey {
    case title
    case connection
    case subtitle
    case activeSessions
    case activeChannels
    case pendingQueue
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    title = (try container.decodeIfPresent(String.self, forKey: .title) ?? "ClawLink").trimmingCharacters(in: .whitespacesAndNewlines)
    connection = (try container.decodeIfPresent(String.self, forKey: .connection) ?? "offline").trimmingCharacters(in: .whitespacesAndNewlines)
    subtitle = (try container.decodeIfPresent(String.self, forKey: .subtitle) ?? "No gateway snapshot available.").trimmingCharacters(in: .whitespacesAndNewlines)
    activeSessions = max((try container.decodeIfPresent(Int.self, forKey: .activeSessions)) ?? 0, 0)
    activeChannels = max((try container.decodeIfPresent(Int.self, forKey: .activeChannels)) ?? 0, 0)
    pendingQueue = max((try container.decodeIfPresent(Int.self, forKey: .pendingQueue)) ?? 0, 0)
  }
}

private func intentDefaults() -> UserDefaults? {
  UserDefaults(suiteName: ClawIntentShared.appGroup)
}

private func readShortcutIntentQueue() -> [ClawShortcutIntentRequest] {
  guard
    let defaults = intentDefaults(),
    let raw = defaults.string(forKey: ClawIntentShared.shortcutQueueKey),
    let data = raw.data(using: .utf8)
  else {
    return []
  }

  return (try? JSONDecoder().decode([ClawShortcutIntentRequest].self, from: data)) ?? []
}

func appendShortcutIntentRequest(_ request: ClawShortcutIntentRequest) {
  guard let defaults = intentDefaults() else {
    return
  }

  let queue = readShortcutIntentQueue() + [request]
  if let data = try? JSONEncoder().encode(queue),
     let payload = String(data: data, encoding: .utf8) {
    defaults.set(payload, forKey: ClawIntentShared.shortcutQueueKey)
    defaults.synchronize()
  }
}

func consumeShortcutIntentRequests() -> [ClawShortcutIntentRequest] {
  guard let defaults = intentDefaults() else {
    return []
  }

  let queue = readShortcutIntentQueue()
  defaults.removeObject(forKey: ClawIntentShared.shortcutQueueKey)
  defaults.synchronize()
  return queue
}

func readShortcutGatewaySummary() -> String {
  guard
    let defaults = intentDefaults(),
    let raw = defaults.string(forKey: ClawIntentShared.snapshotKey),
    let data = raw.data(using: .utf8),
    let snapshot = try? JSONDecoder().decode(ClawIntentStatusSnapshot.self, from: data)
  else {
    return "ClawLink is offline. No gateway snapshot available."
  }

  let connection = snapshot.connection.lowercased().contains("online")
    ? "online"
    : snapshot.connection.lowercased().contains("degraded") || snapshot.connection.lowercased().contains("reconnect")
      ? "reconnecting"
      : "offline"
  return "\(snapshot.title) is \(connection). \(snapshot.activeSessions) sessions, \(snapshot.activeChannels) channels, \(snapshot.pendingQueue) queued. \(snapshot.subtitle)"
}
