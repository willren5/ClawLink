import Foundation
import ActivityKit
import WidgetKit
import Speech
import HealthKit
import CoreSpotlight
import React

private enum ClawSurfaceShared {
  static let appGroup = "group.com.fadmediagroup.clawlink"
  static let snapshotKey = "system-surface:snapshot"
  static let multiGatewayKey = "multi-gateway:status"
  static let liveActivityEnabledKey = "surface.liveActivityEnabled"
  static let dynamicIslandEnabledKey = "surface.dynamicIslandEnabled"
  static let widgetEnabledKey = "surface.widgetEnabled"
  static let activeProfileClassKey = "surface.activeProfileClass"
  static let supportedSchemaVersion = 1
  static let focusFilterModeKey = "surface.focus.filterMode"
  static let controlRefreshAtKey = "surface.control.refreshRequestedAt"
  static let controlRefreshHandledAtKey = "surface.control.refreshHandledAt"
  static let shortcutCommandKey = "shortcut.command.pending"
}

private enum SurfaceProfileClass: String {
  case production
  case nonproduction
  case unknown
}

private func readSurfaceProfileClass(defaults: UserDefaults?) -> SurfaceProfileClass {
  guard
    let raw = defaults?.string(forKey: ClawSurfaceShared.activeProfileClassKey)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
    let resolved = SurfaceProfileClass(rawValue: raw)
  else {
    return .unknown
  }

  return resolved
}

private func surfaceSuppressionReason(defaults: UserDefaults?) -> String? {
  let mode = defaults?.string(forKey: ClawSurfaceShared.focusFilterModeKey)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? "all"
  if mode == "personal" {
    return "Hidden by Personal Focus"
  }

  if mode == "work" && readSurfaceProfileClass(defaults: defaults) != .production {
    return "Hidden for non-production gateway"
  }

  return nil
}

private enum HealthBridgeShared {
  static let availabilityAvailable = "available"
  static let availabilityUnavailable = "unavailable"
  static let statusGranted = "granted"
  static let statusDenied = "denied"
  static let statusUnknown = "unknown"
}

private enum HealthBridgeMetric: String, CaseIterable {
  case steps
  case activeEnergyKcal
  case exerciseMinutes
  case standHours
  case sleepDuration

  var objectType: HKObjectType? {
    switch self {
    case .steps:
      return HKObjectType.quantityType(forIdentifier: .stepCount)
    case .activeEnergyKcal:
      return HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)
    case .exerciseMinutes:
      return HKObjectType.quantityType(forIdentifier: .appleExerciseTime)
    case .standHours:
      return HKObjectType.quantityType(forIdentifier: .appleStandHour)
    case .sleepDuration:
      return HKObjectType.categoryType(forIdentifier: .sleepAnalysis)
    }
  }
}

private func requestedHealthMetrics(from payload: String) -> [HealthBridgeMetric] {
  guard
    let data = payload.data(using: .utf8),
    let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
    let metrics = json["metrics"] as? [String]
  else {
    return HealthBridgeMetric.allCases
  }

  let parsed = metrics.compactMap { HealthBridgeMetric(rawValue: $0) }
  return parsed.isEmpty ? HealthBridgeMetric.allCases : parsed
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

private func fallbackSnapshotTimestamp() -> Double {
  Date().timeIntervalSince1970 * 1000
}

private struct SurfaceSnapshot: Codable {
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

    init(
      agentId: String = "",
      agentName: String = "",
      currentTask: String = "",
      model: String? = nil,
      isStreaming: Bool = false
    ) {
      self.agentId = agentId.trimmingCharacters(in: .whitespacesAndNewlines)
      self.agentName = agentName.trimmingCharacters(in: .whitespacesAndNewlines)
      self.currentTask = currentTask.trimmingCharacters(in: .whitespacesAndNewlines)
      let normalizedModel = model?.trimmingCharacters(in: .whitespacesAndNewlines)
      self.model = normalizedModel?.isEmpty == false ? normalizedModel : nil
      self.isStreaming = isStreaming
    }

    init(from decoder: Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      self.init(
        agentId: container.decodeStringValue(forKey: .agentId, default: ""),
        agentName: container.decodeStringValue(forKey: .agentName, default: ""),
        currentTask: container.decodeStringValue(forKey: .currentTask, default: ""),
        model: try container.decodeIfPresent(String.self, forKey: .model),
        isStreaming: (try? container.decodeIfPresent(Bool.self, forKey: .isStreaming)) ?? false
      )
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
  let costYesterday: Double?
  let requestsToday: Int?
  let tokenUsageToday: Int?
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
    case costYesterday
    case requestsToday
    case tokenUsageToday
    case errorCount
  }

  init(
    schemaVersion: Int? = nil,
    title: String = "ClawLink",
    subtitle: String = "",
    icon: String = "checkmark.circle.fill",
    connection: String = "offline",
    activeSessions: Int = 0,
    activeChannels: Int = 0,
    pendingQueue: Int = 0,
    pendingMessages: Int? = nil,
    timestamp: Double = fallbackSnapshotTimestamp(),
    disconnectedSince: Double? = nil,
    activeAgent: ActiveAgentSnapshot? = nil,
    costToday: Double? = nil,
    costYesterday: Double? = nil,
    requestsToday: Int? = nil,
    tokenUsageToday: Int? = nil,
    errorCount: Int? = nil
  ) {
    self.schemaVersion = schemaVersion
    self.title = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "ClawLink" : title.trimmingCharacters(in: .whitespacesAndNewlines)
    self.subtitle = subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
    self.icon = icon.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "checkmark.circle.fill" : icon.trimmingCharacters(in: .whitespacesAndNewlines)
    self.connection = connection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "offline" : connection.trimmingCharacters(in: .whitespacesAndNewlines)
    self.activeSessions = max(activeSessions, 0)
    self.activeChannels = max(activeChannels, 0)
    self.pendingQueue = max(pendingQueue, 0)
    self.pendingMessages = pendingMessages.map { max($0, 0) }
    self.timestamp = timestamp.isFinite ? timestamp : fallbackSnapshotTimestamp()
    self.disconnectedSince = disconnectedSince
    self.activeAgent = activeAgent
    self.costToday = costToday
    self.costYesterday = costYesterday
    self.requestsToday = requestsToday
    self.tokenUsageToday = tokenUsageToday
    self.errorCount = errorCount
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      schemaVersion: try? container.decodeIfPresent(Int.self, forKey: .schemaVersion),
      title: container.decodeStringValue(forKey: .title, default: "ClawLink"),
      subtitle: container.decodeStringValue(forKey: .subtitle, default: ""),
      icon: container.decodeStringValue(forKey: .icon, default: "checkmark.circle.fill"),
      connection: container.decodeStringValue(forKey: .connection, default: "offline"),
      activeSessions: container.decodeIntValue(forKey: .activeSessions, default: 0),
      activeChannels: container.decodeIntValue(forKey: .activeChannels, default: 0),
      pendingQueue: container.decodeIntValue(forKey: .pendingQueue, default: 0),
      pendingMessages: try? container.decodeIfPresent(Int.self, forKey: .pendingMessages),
      timestamp: container.decodeDoubleValue(forKey: .timestamp, default: fallbackSnapshotTimestamp()),
      disconnectedSince: try? container.decodeIfPresent(Double.self, forKey: .disconnectedSince),
      activeAgent: try? container.decodeIfPresent(ActiveAgentSnapshot.self, forKey: .activeAgent),
      costToday: try? container.decodeIfPresent(Double.self, forKey: .costToday),
      costYesterday: try? container.decodeIfPresent(Double.self, forKey: .costYesterday),
      requestsToday: try? container.decodeIfPresent(Int.self, forKey: .requestsToday),
      tokenUsageToday: try? container.decodeIfPresent(Int.self, forKey: .tokenUsageToday),
      errorCount: try? container.decodeIfPresent(Int.self, forKey: .errorCount)
    )
  }

  var resolvedAgentName: String {
    let explicitAgent = activeAgent?.agentName.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !explicitAgent.isEmpty {
      return explicitAgent
    }

    let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedTitle.isEmpty ? "ClawLink" : trimmedTitle
  }

  var resolvedTaskSummary: String {
    let task = activeAgent?.currentTask.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !task.isEmpty {
      return task
    }

    let trimmedSubtitle = subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedSubtitle.isEmpty ? "No active tasks" : trimmedSubtitle
  }
}

private struct SurfaceSnapshotPatch: Decodable {
  let title: String?
  let subtitle: String?
  let icon: String?
  let connection: String?
  let activeSessions: Int?
  let activeChannels: Int?
  let pendingQueue: Int?
  let pendingMessages: Int?
  let timestamp: Double?
  let disconnectedSince: Double??
  let activeAgent: SurfaceSnapshot.ActiveAgentSnapshot??
  let costToday: Double??
  let costYesterday: Double??
  let requestsToday: Int??
  let tokenUsageToday: Int??
  let errorCount: Int??
}

private struct SurfaceFullPayloadEnvelope: Decodable {
  let kind: String
  let schemaVersion: Int?
  let timestamp: Double?
  let snapshot: SurfaceSnapshot
}

private struct SurfacePayloadEnvelope: Decodable {
  let kind: String
  let schemaVersion: Int?
  let timestamp: Double?
  let changedKeys: [String]?
  let snapshot: SurfaceSnapshotPatch?
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

@objc(ClawSurfaceBridge)
final class ClawSurfaceBridge: NSObject {
  private var speechTasks: [UUID: SFSpeechRecognitionTask] = [:]
  private let healthStore = HKHealthStore()

  private func writeStoredSnapshot(_ snapshot: SurfaceSnapshot, defaults: UserDefaults) throws {
    let data = try JSONEncoder().encode(snapshot)
    guard let raw = String(data: data, encoding: .utf8) else {
      throw NSError(domain: "ClawSurfaceBridge", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to encode snapshot."])
    }
    defaults.set(raw, forKey: ClawSurfaceShared.snapshotKey)
    defaults.synchronize()
  }

  private func mergedSnapshot(
    base: SurfaceSnapshot,
    patch: SurfaceSnapshotPatch?,
    changedKeys: [String],
    timestamp: Double?
  ) -> SurfaceSnapshot {
    let changed = Set(changedKeys)

    return SurfaceSnapshot(
      schemaVersion: base.schemaVersion,
      title: changed.contains("title") ? (patch?.title ?? base.title) : base.title,
      subtitle: changed.contains("subtitle") ? (patch?.subtitle ?? base.subtitle) : base.subtitle,
      icon: changed.contains("icon") ? (patch?.icon ?? base.icon) : base.icon,
      connection: changed.contains("connection") ? (patch?.connection ?? base.connection) : base.connection,
      activeSessions: changed.contains("activeSessions") ? (patch?.activeSessions ?? base.activeSessions) : base.activeSessions,
      activeChannels: changed.contains("activeChannels") ? (patch?.activeChannels ?? base.activeChannels) : base.activeChannels,
      pendingQueue: changed.contains("pendingQueue") ? (patch?.pendingQueue ?? base.pendingQueue) : base.pendingQueue,
      pendingMessages: changed.contains("pendingMessages") ? (patch?.pendingMessages ?? nil) : base.pendingMessages,
      timestamp: timestamp ?? patch?.timestamp ?? base.timestamp,
      disconnectedSince: changed.contains("disconnectedSince") ? (patch?.disconnectedSince ?? nil) : base.disconnectedSince,
      activeAgent: changed.contains("activeAgent") ? (patch?.activeAgent ?? nil) : base.activeAgent,
      costToday: changed.contains("costToday") ? (patch?.costToday ?? nil) : base.costToday,
      costYesterday: changed.contains("costYesterday") ? (patch?.costYesterday ?? nil) : base.costYesterday,
      requestsToday: changed.contains("requestsToday") ? (patch?.requestsToday ?? nil) : base.requestsToday,
      tokenUsageToday: changed.contains("tokenUsageToday") ? (patch?.tokenUsageToday ?? nil) : base.tokenUsageToday,
      errorCount: changed.contains("errorCount") ? (patch?.errorCount ?? nil) : base.errorCount
    )
  }

  private func resolveSnapshot(from payload: String, defaults: UserDefaults?) throws -> SurfaceSnapshot {
    guard let data = payload.data(using: .utf8) else {
      throw NSError(domain: "ClawSurfaceBridge", code: -2, userInfo: [NSLocalizedDescriptionKey: "Invalid snapshot payload."])
    }

    if let fullEnvelope = try? JSONDecoder().decode(SurfaceFullPayloadEnvelope.self, from: data), fullEnvelope.kind == "full" {
      return fullEnvelope.snapshot
    }

    if let envelope = try? JSONDecoder().decode(SurfacePayloadEnvelope.self, from: data), envelope.kind == "patch" {
      let schemaVersion = envelope.schemaVersion ?? ClawSurfaceShared.supportedSchemaVersion
      let base = readStoredSnapshot() ?? SurfaceSnapshot(schemaVersion: schemaVersion)
      return mergedSnapshot(base: base, patch: envelope.snapshot, changedKeys: envelope.changedKeys ?? [], timestamp: envelope.timestamp)
    }

    return try JSONDecoder().decode(SurfaceSnapshot.self, from: data)
  }

  private func readStoredSnapshot() -> SurfaceSnapshot? {
    guard
      let defaults = UserDefaults(suiteName: ClawSurfaceShared.appGroup),
      let raw = defaults.string(forKey: ClawSurfaceShared.snapshotKey),
      let data = raw.data(using: .utf8)
    else {
      return nil
    }

    return try? JSONDecoder().decode(SurfaceSnapshot.self, from: data)
  }

  private func healthMetricPayload(selectedMetrics: [HealthBridgeMetric]? = nil) -> [String: String] {
    let metrics = selectedMetrics ?? HealthBridgeMetric.allCases
    var payload: [String: String] = [:]

    for metric in HealthBridgeMetric.allCases {
      guard metrics.contains(metric), let objectType = metric.objectType else {
        payload[metric.rawValue] = HealthBridgeShared.statusUnknown
        continue
      }

      switch healthStore.authorizationStatus(for: objectType) {
      case .sharingAuthorized:
        payload[metric.rawValue] = HealthBridgeShared.statusGranted
      case .sharingDenied:
        payload[metric.rawValue] = HealthBridgeShared.statusDenied
      case .notDetermined:
        payload[metric.rawValue] = HealthBridgeShared.statusUnknown
      @unknown default:
        payload[metric.rawValue] = HealthBridgeShared.statusUnknown
      }
    }

    return payload
  }

  private func overallHealthAuthorizationStatus(metricStatuses: [String: String]) -> String {
    let values = Array(metricStatuses.values)
    if values.contains(HealthBridgeShared.statusGranted) {
      return HealthBridgeShared.statusGranted
    }
    if values.contains(HealthBridgeShared.statusDenied) {
      return HealthBridgeShared.statusDenied
    }
    return HealthBridgeShared.statusUnknown
  }

  private func healthAuthorizationPayload(selectedMetrics: [HealthBridgeMetric]? = nil) -> [String: Any] {
    guard HKHealthStore.isHealthDataAvailable() else {
      return [
        "availability": HealthBridgeShared.availabilityUnavailable,
        "status": HealthBridgeShared.statusUnknown,
        "metricStatuses": Dictionary(uniqueKeysWithValues: HealthBridgeMetric.allCases.map { ($0.rawValue, HealthBridgeShared.statusUnknown) })
      ]
    }

    let metricStatuses = healthMetricPayload(selectedMetrics: selectedMetrics)
    return [
      "availability": HealthBridgeShared.availabilityAvailable,
      "status": overallHealthAuthorizationStatus(metricStatuses: metricStatuses),
      "metricStatuses": metricStatuses
    ]
  }

  private func healthBridgeDateString(from date: Date) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar.autoupdatingCurrent
    formatter.timeZone = TimeZone.autoupdatingCurrent
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }

  private func healthBridgeTimestampString(from date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone.autoupdatingCurrent
    return formatter.string(from: date)
  }

  private func fetchCumulativeQuantity(
    for identifier: HKQuantityTypeIdentifier,
    unit: HKUnit,
    completion: @escaping (Result<Double, Error>) -> Void
  ) {
    guard let quantityType = HKObjectType.quantityType(forIdentifier: identifier) else {
      completion(.success(0))
      return
    }

    let now = Date()
    let startOfDay = Calendar.autoupdatingCurrent.startOfDay(for: now)
    let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: now, options: .strictStartDate)
    let query = HKStatisticsQuery(quantityType: quantityType, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, statistics, error in
      if let error {
        completion(.failure(error))
        return
      }

      let value = statistics?.sumQuantity()?.doubleValue(for: unit) ?? 0
      completion(.success(value))
    }

    healthStore.execute(query)
  }

  private func isSleepCategoryAsleep(_ value: Int) -> Bool {
    if value == HKCategoryValueSleepAnalysis.asleep.rawValue {
      return true
    }

    if #available(iOS 16.0, *) {
      return value == HKCategoryValueSleepAnalysis.asleepCore.rawValue
        || value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue
        || value == HKCategoryValueSleepAnalysis.asleepREM.rawValue
        || value == HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue
    }

    return false
  }

  private func fetchSleepDurationMinutes(completion: @escaping (Result<Double, Error>) -> Void) {
    guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
      completion(.success(0))
      return
    }

    let now = Date()
    let calendar = Calendar.autoupdatingCurrent
    let startOfDay = calendar.startOfDay(for: now)
    let windowStart = calendar.date(byAdding: .hour, value: -18, to: startOfDay) ?? calendar.date(byAdding: .day, value: -1, to: now) ?? now
    let predicate = HKQuery.predicateForSamples(withStart: windowStart, end: now, options: [])

    let query = HKSampleQuery(sampleType: sleepType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { [weak self] _, samples, error in
      if let error {
        completion(.failure(error))
        return
      }

      let sleepSamples = (samples as? [HKCategorySample]) ?? []
      let totalMinutes = sleepSamples.reduce(0.0) { partial, sample in
        guard self?.isSleepCategoryAsleep(sample.value) == true else {
          return partial
        }

        return partial + sample.endDate.timeIntervalSince(sample.startDate) / 60
      }

      completion(.success(totalMinutes))
    }

    healthStore.execute(query)
  }

  private func fetchHealthBridgeSummary(
    selectedMetrics: [HealthBridgeMetric],
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    guard HKHealthStore.isHealthDataAvailable() else {
      completion(.failure(NSError(domain: "ClawSurfaceBridge", code: -20, userInfo: [NSLocalizedDescriptionKey: "Health data is unavailable on this device."])))
      return
    }

    let authorizedMetrics = selectedMetrics.filter { metric in
      guard let objectType = metric.objectType else {
        return false
      }

      return healthStore.authorizationStatus(for: objectType) == .sharingAuthorized
    }

    guard !authorizedMetrics.isEmpty else {
      completion(.failure(NSError(domain: "ClawSurfaceBridge", code: -21, userInfo: [NSLocalizedDescriptionKey: "No authorized Health Bridge metrics are available."])))
      return
    }

    let group = DispatchGroup()
    let stateQueue = DispatchQueue(label: "com.fadmediagroup.clawlink.healthbridge")
    var activityPayload: [String: Int] = [:]
    var sleepPayload: [String: Int]? = nil
    var firstError: Error?

    for metric in authorizedMetrics {
      group.enter()

      switch metric {
      case .steps:
        fetchCumulativeQuantity(for: .stepCount, unit: .count()) { result in
          stateQueue.sync {
            switch result {
            case .success(let value):
              activityPayload[metric.rawValue] = Int(value.rounded())
            case .failure(let error):
              if firstError == nil {
                firstError = error
              }
            }
          }
          group.leave()
        }
      case .activeEnergyKcal:
        fetchCumulativeQuantity(for: .activeEnergyBurned, unit: .kilocalorie()) { result in
          stateQueue.sync {
            switch result {
            case .success(let value):
              activityPayload[metric.rawValue] = Int(value.rounded())
            case .failure(let error):
              if firstError == nil {
                firstError = error
              }
            }
          }
          group.leave()
        }
      case .exerciseMinutes:
        fetchCumulativeQuantity(for: .appleExerciseTime, unit: .minute()) { result in
          stateQueue.sync {
            switch result {
            case .success(let value):
              activityPayload[metric.rawValue] = Int(value.rounded())
            case .failure(let error):
              if firstError == nil {
                firstError = error
              }
            }
          }
          group.leave()
        }
      case .standHours:
        fetchCumulativeQuantity(for: .appleStandHour, unit: .count()) { result in
          stateQueue.sync {
            switch result {
            case .success(let value):
              activityPayload[metric.rawValue] = Int(value.rounded())
            case .failure(let error):
              if firstError == nil {
                firstError = error
              }
            }
          }
          group.leave()
        }
      case .sleepDuration:
        fetchSleepDurationMinutes { result in
          stateQueue.sync {
            switch result {
            case .success(let value):
              sleepPayload = ["durationMinutes": Int(value.rounded())]
            case .failure(let error):
              if firstError == nil {
                firstError = error
              }
            }
          }
          group.leave()
        }
      }
    }

    group.notify(queue: .main) { [weak self] in
      if let error = firstError {
        completion(.failure(error))
        return
      }

      let now = Date()
      var payload: [String: Any] = [
        "date": self?.healthBridgeDateString(from: now) ?? "",
        "timezone": TimeZone.autoupdatingCurrent.identifier,
        "activity": activityPayload,
        "source": "ios-healthkit",
        "generatedAt": self?.healthBridgeTimestampString(from: now) ?? ""
      ]

      if let sleepPayload {
        payload["sleep"] = sleepPayload
      }

      completion(.success(payload))
    }
  }

  private func liveActivityEnabled() -> Bool {
    guard let defaults = UserDefaults(suiteName: ClawSurfaceShared.appGroup) else {
      return true
    }
    if defaults.object(forKey: ClawSurfaceShared.liveActivityEnabledKey) == nil {
      return true
    }
    return defaults.bool(forKey: ClawSurfaceShared.liveActivityEnabledKey)
  }

  @available(iOS 16.1, *)
  private func staleContentState(timestamp: Double) -> ClawLinkActivityAttributes.ContentState {
    ClawLinkActivityAttributes.ContentState(
      connection: "offline",
      activeAgentName: "",
      activeTaskSummary: "Please update ClawLink",
      sessionsCount: 0,
      channelsCount: 0,
      queueCount: 0,
      pendingMessages: 0,
      lastUpdated: timestamp,
      disconnectedSince: 0,
      costToday: -1,
      errorAgentCount: 0
    )
  }

  @available(iOS 16.1, *)
  private func contentState(from snapshot: SurfaceSnapshot) -> ClawLinkActivityAttributes.ContentState {
    ClawLinkActivityAttributes.ContentState(
      connection: snapshot.connection,
      activeAgentName: snapshot.activeAgent?.agentName.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
      activeTaskSummary: snapshot.resolvedTaskSummary,
      sessionsCount: max(snapshot.activeSessions, 0),
      channelsCount: max(snapshot.activeChannels, 0),
      queueCount: max(snapshot.pendingQueue, 0),
      pendingMessages: max(snapshot.pendingMessages ?? snapshot.pendingQueue, 0),
      lastUpdated: snapshot.timestamp,
      disconnectedSince: snapshot.disconnectedSince ?? 0,
      costToday: snapshot.costToday ?? -1,
      errorAgentCount: max(snapshot.errorCount ?? 0, 0)
    )
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc
  func publishWidgetState(
    _ payload: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    guard let defaults = UserDefaults(suiteName: ClawSurfaceShared.appGroup) else {
      rejecter("surface_group_unavailable", "App Group storage unavailable.", nil)
      return
    }

    do {
      let snapshot = try resolveSnapshot(from: payload, defaults: defaults)
      try writeStoredSnapshot(snapshot, defaults: defaults)
      WidgetCenter.shared.reloadTimelines(ofKind: "ClawLinkStatusWidget")
      WidgetCenter.shared.reloadAllTimelines()
      resolver(nil)
    } catch {
      rejecter("surface_invalid_payload", "Invalid widget snapshot payload.", error)
    }
  }

  @objc
  func publishMultiGatewayState(
    _ payload: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    guard let defaults = UserDefaults(suiteName: ClawSurfaceShared.appGroup) else {
      rejecter("surface_group_unavailable", "App Group storage unavailable.", nil)
      return
    }

    defaults.set(payload, forKey: ClawSurfaceShared.multiGatewayKey)
    defaults.synchronize()
    WidgetCenter.shared.reloadTimelines(ofKind: "ClawLinkMultiGatewayWidget")
    WidgetCenter.shared.reloadAllTimelines()
    resolver(nil)
  }

  @objc
  func updateSurfacePreferences(
    _ payload: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    guard let defaults = UserDefaults(suiteName: ClawSurfaceShared.appGroup) else {
      rejecter("surface_group_unavailable", "App Group storage unavailable.", nil)
      return
    }

    guard let data = payload.data(using: .utf8) else {
      rejecter("surface_invalid_payload", "Invalid preferences payload.", nil)
      return
    }

    do {
      if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
        if let liveActivityEnabled = json["liveActivityEnabled"] as? Bool {
          defaults.set(liveActivityEnabled, forKey: ClawSurfaceShared.liveActivityEnabledKey)
        }

        if let dynamicIslandEnabled = json["dynamicIslandEnabled"] as? Bool {
          defaults.set(dynamicIslandEnabled, forKey: ClawSurfaceShared.dynamicIslandEnabledKey)
        }

        if let widgetEnabled = json["widgetEnabled"] as? Bool {
          defaults.set(widgetEnabled, forKey: ClawSurfaceShared.widgetEnabledKey)
        }

        if let activeProfileClass = json["activeProfileClass"] as? String {
          defaults.set(activeProfileClass, forKey: ClawSurfaceShared.activeProfileClassKey)
        }

        defaults.synchronize()
        WidgetCenter.shared.reloadTimelines(ofKind: "ClawLinkStatusWidget")
        WidgetCenter.shared.reloadAllTimelines()
      }

      resolver(nil)
    } catch {
      rejecter("surface_invalid_payload", "Failed to parse preferences payload.", error)
    }
  }

  @objc
  func publishLiveActivity(
    _ payload: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    if #available(iOS 16.1, *) {
      guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        resolver(nil)
        return
      }

      guard liveActivityEnabled() else {
        Task {
          for activity in Activity<ClawLinkActivityAttributes>.activities {
            await activity.end(dismissalPolicy: .immediate)
          }
          resolver(nil)
        }
        return
      }

      do {
        let defaults = UserDefaults(suiteName: ClawSurfaceShared.appGroup)
        if surfaceSuppressionReason(defaults: defaults) != nil {
          Task {
            for activity in Activity<ClawLinkActivityAttributes>.activities {
              await activity.end(dismissalPolicy: .immediate)
            }
            resolver(nil)
          }
          return
        }

        let snapshot = try resolveSnapshot(from: payload, defaults: defaults)
        if let schemaVersion = snapshot.schemaVersion, schemaVersion > ClawSurfaceShared.supportedSchemaVersion {
          let staleState = staleContentState(timestamp: snapshot.timestamp)
          let staleAttributes = ClawLinkActivityAttributes(sessionId: "claw-link", agentName: snapshot.resolvedAgentName)
          Task {
            do {
              if let current = Activity<ClawLinkActivityAttributes>.activities.first {
                await current.update(using: staleState)
              } else {
                _ = try Activity.request(attributes: staleAttributes, contentState: staleState, pushType: nil)
              }
              resolver(nil)
            } catch {
              rejecter("surface_live_activity_failed", "Unable to update live activity.", error)
            }
          }
          return
        }

        let contentState = contentState(from: snapshot)
        let attributes = ClawLinkActivityAttributes(
          sessionId: "claw-link",
          agentName: snapshot.resolvedAgentName
        )

        Task {
          do {
            if let current = Activity<ClawLinkActivityAttributes>.activities.first {
              await current.update(using: contentState)
            } else {
              _ = try Activity.request(
                attributes: attributes,
                contentState: contentState,
                pushType: nil
              )
            }
            resolver(nil)
          } catch {
            rejecter("surface_live_activity_failed", "Unable to update live activity.", error)
          }
        }
      } catch {
        rejecter("surface_invalid_payload", "Unable to decode live activity payload.", error)
      }
    } else {
      resolver(nil)
    }
  }

  @objc
  func endLiveActivity(
    _ resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    if #available(iOS 16.1, *) {
      Task {
        for activity in Activity<ClawLinkActivityAttributes>.activities {
          await activity.end(dismissalPolicy: .immediate)
        }
        resolver(nil)
      }
      return
    }

    resolver(nil)
  }

  @objc
  func transcribeLocalAudio(
    _ uri: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    guard #available(iOS 13.0, *) else {
      rejecter("speech_unavailable", "Local speech recognition requires iOS 13+", nil)
      return
    }

    let requestAuthAndTranscribe = {
      let fileURL: URL
      if uri.hasPrefix("file://"), let parsed = URL(string: uri) {
        fileURL = parsed
      } else {
        fileURL = URL(fileURLWithPath: uri)
      }

      guard FileManager.default.fileExists(atPath: fileURL.path) else {
        rejecter("speech_missing_file", "Audio file not found for local transcription.", nil)
        return
      }

      guard let recognizer = SFSpeechRecognizer(locale: Locale.current), recognizer.isAvailable else {
        rejecter("speech_unavailable", "Local speech recognizer is unavailable.", nil)
        return
      }

      let taskId = UUID()
      let request = SFSpeechURLRecognitionRequest(url: fileURL)
      request.shouldReportPartialResults = false
      if #available(iOS 13.0, *), recognizer.supportsOnDeviceRecognition {
        request.requiresOnDeviceRecognition = true
      }

      let task = recognizer.recognitionTask(with: request) { [weak self] result, error in
        if let error = error {
          self?.speechTasks.removeValue(forKey: taskId)
          rejecter("speech_transcribe_failed", "Local transcription failed.", error)
          return
        }

        guard let result = result, result.isFinal else {
          return
        }

        self?.speechTasks.removeValue(forKey: taskId)
        resolver(result.bestTranscription.formattedString)
      }

      self.speechTasks[taskId] = task
    }

    SFSpeechRecognizer.requestAuthorization { status in
      DispatchQueue.main.async {
        if status == .authorized {
          requestAuthAndTranscribe()
        } else {
          rejecter("speech_denied", "Speech recognition permission denied.", nil)
        }
      }
    }
  }

  @objc
  func indexSpotlightItems(
    _ payload: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    guard let data = payload.data(using: .utf8) else {
      rejecter("spotlight_invalid_payload", "Invalid spotlight payload.", nil)
      return
    }

    do {
      let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
      let gateways = raw["gateways"] as? [[String: Any]] ?? []
      let agents = raw["agents"] as? [[String: Any]] ?? []
      let sessions = raw["sessions"] as? [[String: Any]] ?? []

      var items: [CSSearchableItem] = []

      for gateway in gateways {
        guard let id = gateway["id"] as? String, !id.isEmpty else { continue }
        let name = (gateway["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = (name?.isEmpty == false ? name! : id)
        let deepLink = "clawlink://dashboard?gatewayId=\(id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id)"
        let attributeSet = CSSearchableItemAttributeSet(itemContentType: "public.item")
        attributeSet.title = title
        attributeSet.contentDescription = "Switch gateway profile in ClawLink"
        attributeSet.keywords = ["gateway", "clawlink", title]
        attributeSet.relatedUniqueIdentifier = id
        attributeSet.contentURL = URL(string: deepLink)
        items.append(
          CSSearchableItem(
            uniqueIdentifier: "gateway:\(id)",
            domainIdentifier: "clawlink.gateway",
            attributeSet: attributeSet
          )
        )
      }

      for agent in agents {
        guard let id = agent["id"] as? String, !id.isEmpty else { continue }
        let name = (agent["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = (name?.isEmpty == false ? name! : id)
        let deepLink = "clawlink://agents?agentId=\(id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id)"
        let attributeSet = CSSearchableItemAttributeSet(itemContentType: "public.item")
        attributeSet.title = title
        attributeSet.contentDescription = "Open agent detail in ClawLink"
        attributeSet.keywords = ["agent", "clawlink", title]
        attributeSet.relatedUniqueIdentifier = id
        attributeSet.contentURL = URL(string: deepLink)
        items.append(
          CSSearchableItem(
            uniqueIdentifier: "agent:\(id)",
            domainIdentifier: "clawlink.agent",
            attributeSet: attributeSet
          )
        )
      }

      for session in sessions {
        guard let id = session["id"] as? String, !id.isEmpty else { continue }
        let titleValue = (session["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = (titleValue?.isEmpty == false ? titleValue! : id)
        let deepLink = "clawlink://chat?sessionId=\(id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id)"
        let attributeSet = CSSearchableItemAttributeSet(itemContentType: "public.item")
        attributeSet.title = title
        attributeSet.contentDescription = "Open chat session in ClawLink"
        attributeSet.keywords = ["session", "chat", "clawlink", title]
        attributeSet.relatedUniqueIdentifier = id
        attributeSet.contentURL = URL(string: deepLink)
        items.append(
          CSSearchableItem(
            uniqueIdentifier: "session:\(id)",
            domainIdentifier: "clawlink.session",
            attributeSet: attributeSet
          )
        )
      }

      let domainIdentifiers = ["clawlink.gateway", "clawlink.agent", "clawlink.session"]
      CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: domainIdentifiers) { deleteError in
        if let deleteError = deleteError {
          rejecter("spotlight_clear_failed", "Unable to clear spotlight items.", deleteError)
          return
        }

        if items.isEmpty {
          resolver(0)
          return
        }

        CSSearchableIndex.default().indexSearchableItems(items) { error in
          if let error = error {
            rejecter("spotlight_index_failed", "Unable to index spotlight items.", error)
          } else {
            resolver(items.count)
          }
        }
      }
    } catch {
      rejecter("spotlight_invalid_payload", "Failed to parse spotlight payload.", error)
    }
  }

  @objc
  func clearSpotlightIndex(
    _ resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    CSSearchableIndex.default().deleteAllSearchableItems { error in
      if let error = error {
        rejecter("spotlight_clear_failed", "Failed to clear spotlight index.", error)
      } else {
        resolver(nil)
      }
    }
  }

  @objc
  func getFocusFilterMode(
    _ resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    guard let defaults = UserDefaults(suiteName: ClawSurfaceShared.appGroup) else {
      resolver("all")
      return
    }

    let value = defaults.string(forKey: ClawSurfaceShared.focusFilterModeKey) ?? "all"
    resolver(value)
  }

  @objc
  func consumeControlRefreshRequest(
    _ resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    guard let defaults = UserDefaults(suiteName: ClawSurfaceShared.appGroup) else {
      resolver(false)
      return
    }

    let requestedAt = defaults.double(forKey: ClawSurfaceShared.controlRefreshAtKey)
    let handledAt = defaults.double(forKey: ClawSurfaceShared.controlRefreshHandledAtKey)
    if requestedAt > 0 && requestedAt > handledAt {
      defaults.set(requestedAt, forKey: ClawSurfaceShared.controlRefreshHandledAtKey)
      defaults.synchronize()
      resolver(true)
      return
    }

    resolver(false)
  }

  @objc
  func consumePendingShortcutCommand(
    _ resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    let queue = consumeShortcutIntentRequests()
    guard !queue.isEmpty else {
      resolver(nil)
      return
    }

    do {
      let data = try JSONEncoder().encode(queue)
      resolver(String(data: data, encoding: .utf8))
    } catch {
      rejecter("shortcut_queue_encode_failed", "Unable to encode shortcut request queue.", error)
    }
  }

  @objc
  func getHealthBridgeAuthorizationStatus(
    _ resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    resolver(healthAuthorizationPayload())
  }

  @objc
  func requestHealthBridgePermissions(
    _ payload: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    guard HKHealthStore.isHealthDataAvailable() else {
      resolver(healthAuthorizationPayload())
      return
    }

    let requestedMetrics = requestedHealthMetrics(from: payload)

    let readTypes = Set(requestedMetrics.compactMap(\.objectType))
    healthStore.requestAuthorization(toShare: [], read: readTypes) { [weak self] _, error in
      DispatchQueue.main.async {
        if let error = error {
          rejecter("health_bridge_permission_failed", "HealthKit permission request failed.", error)
          return
        }

        resolver(self?.healthAuthorizationPayload(selectedMetrics: requestedMetrics) ?? self?.healthAuthorizationPayload() ?? [:])
      }
    }
  }

  @objc
  func getHealthBridgeSummary(
    _ payload: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    let requestedMetrics = requestedHealthMetrics(from: payload)
    fetchHealthBridgeSummary(selectedMetrics: requestedMetrics) { result in
      switch result {
      case .success(let payload):
        resolver(payload)
      case .failure(let error):
        rejecter("health_bridge_summary_failed", "Unable to fetch Health Bridge summary.", error)
      }
    }
  }

  @objc
  func getGatewayStatus(
    _ resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    guard let snapshot = readStoredSnapshot() else {
      resolver([
        "title": "ClawLink",
        "connection": "offline",
        "summary": "No gateway snapshot available.",
        "activeSessions": 0,
        "activeChannels": 0,
        "pendingQueue": 0,
        "pendingMessages": 0,
        "costToday": NSNull(),
        "costYesterday": NSNull(),
        "requestsToday": NSNull(),
        "tokenUsageToday": NSNull(),
        "timestamp": 0
      ])
      return
    }

    resolver([
      "title": snapshot.title,
      "connection": snapshot.connection,
      "summary": snapshot.resolvedTaskSummary,
      "activeSessions": max(snapshot.activeSessions, 0),
      "activeChannels": max(snapshot.activeChannels, 0),
      "pendingQueue": max(snapshot.pendingQueue, 0),
      "pendingMessages": max(snapshot.pendingMessages ?? snapshot.pendingQueue, 0),
      "costToday": snapshot.costToday as Any,
      "costYesterday": snapshot.costYesterday as Any,
      "requestsToday": snapshot.requestsToday as Any,
      "tokenUsageToday": snapshot.tokenUsageToday as Any,
      "timestamp": snapshot.timestamp
    ])
  }
}
