import WidgetKit
import SwiftUI

@main
struct ClawLinkWidgetsBundle: WidgetBundle {
  var body: some Widget {
    ClawLinkStatusWidget()
    ClawLinkCostWidget()
    ClawLinkMultiGatewayWidget()
    ClawLinkLiveActivityWidget()
    if #available(iOSApplicationExtension 18.0, *) {
      ClawLinkControlWidget()
    }
  }
}
