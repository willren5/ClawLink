internal import Expo
import React
import ReactAppDependencyProvider
import CoreSpotlight
import AppIntents

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
#if DEBUG
    let allowMetro = ProcessInfo.processInfo.environment["CLAWLINK_ALLOW_METRO"] == "1"
    if !allowMetro {
      RCTDevLoadingViewSetEnabled(false)
      RCTBundleURLProviderAllowPackagerServerAccess(false)
      let settings = RCTBundleURLProvider.sharedSettings()
      settings.enableDev = false
      settings.enableMinification = true
    }
#endif

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    if #available(iOS 16.0, *) {
      ClawLinkShortcuts.updateAppShortcutParameters()
    }

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    if userActivity.activityType == CSSearchableItemActionType,
      let identifier = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
      let deepLink = spotlightDeepLink(from: identifier)
    {
      _ = RCTLinkingManager.application(application, open: deepLink, options: [:])
      return true
    }

    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }

  private func spotlightDeepLink(from identifier: String) -> URL? {
    let parts = identifier.split(separator: ":", maxSplits: 1).map(String.init)
    guard parts.count == 2 else {
      return nil
    }

    let type = parts[0]
    let id = parts[1].addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? parts[1]
    switch type {
    case "gateway":
      return URL(string: "clawlink://dashboard?gatewayId=\(id)")
    case "agent":
      return URL(string: "clawlink://agents?agentId=\(id)")
    case "session":
      return URL(string: "clawlink://chat?sessionId=\(id)")
    default:
      return nil
    }
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins
  private func shouldUseMetroBundle() -> Bool {
#if DEBUG
    // Default to embedded bundle to avoid Metro dependency and blank screen on physical devices.
    // Set CLAWLINK_ALLOW_METRO=1 only when you intentionally want Metro for JS debugging.
    return ProcessInfo.processInfo.environment["CLAWLINK_ALLOW_METRO"] == "1"
#else
    return false
#endif
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? {
#if DEBUG
    // Default debug path uses embedded bundle to avoid Metro dependency on simulator/device.
    // Set CLAWLINK_USE_METRO=1 in scheme Environment Variables when you explicitly want Metro.
    if shouldUseMetroBundle() {
      return bridge.bundleURL ?? bundleURL() ?? Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    }
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
      ?? bridge.bundleURL
      ?? bundleURL()
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }

  override func bundleURL() -> URL? {
#if DEBUG
    if shouldUseMetroBundle() {
      return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
    }
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
