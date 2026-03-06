import Foundation
import React

@objc(ClawSurfaceBridge)
class ClawSurfaceBridge: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc func publishLiveActivity(_ payload: String,
                                 resolver resolve: @escaping RCTPromiseResolveBlock,
                                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    // TODO: Decode payload and forward to ActivityKit update API.
    resolve(nil)
  }

  @objc func publishWidgetState(_ payload: String,
                                resolver resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
    // TODO: Write payload JSON into App Group UserDefaults for WidgetKit timeline provider.
    resolve(nil)
  }

  @objc func endLiveActivity(_ resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
    // TODO: End active activity.
    resolve(nil)
  }
}
