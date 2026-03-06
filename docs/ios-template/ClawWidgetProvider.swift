import WidgetKit
import SwiftUI

struct ClawWidgetEntry: TimelineEntry {
  let date: Date
  let title: String
  let subtitle: String
  let connection: String
}

struct ClawWidgetProvider: TimelineProvider {
  func placeholder(in context: Context) -> ClawWidgetEntry {
    ClawWidgetEntry(date: Date(), title: "ClawLink", subtitle: "Loading...", connection: "degraded")
  }

  func getSnapshot(in context: Context, completion: @escaping (ClawWidgetEntry) -> Void) {
    completion(loadEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ClawWidgetEntry>) -> Void) {
    let entry = loadEntry()
    let next = Calendar.current.date(byAdding: .minute, value: 1, to: Date()) ?? Date().addingTimeInterval(60)
    completion(Timeline(entries: [entry], policy: .after(next)))
  }

  private func loadEntry() -> ClawWidgetEntry {
    // TODO: replace with real app group id
    let appGroup = "group.com.example.claw"
    let defaults = UserDefaults(suiteName: appGroup)
    let raw = defaults?.string(forKey: "system-surface:snapshot")

    guard
      let raw,
      let data = raw.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return ClawWidgetEntry(date: Date(), title: "ClawLink", subtitle: "No data", connection: "offline")
    }

    let title = (json["title"] as? String) ?? "ClawLink"
    let subtitle = (json["subtitle"] as? String) ?? "No data"
    let connection = (json["connection"] as? String) ?? "offline"
    return ClawWidgetEntry(date: Date(), title: title, subtitle: subtitle, connection: connection)
  }
}

