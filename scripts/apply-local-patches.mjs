import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const expoNotificationsPermissionsModulePath = resolve(
  root,
  'node_modules/expo-notifications/ios/ExpoNotifications/Permissions/PermissionsModule.swift',
);

function patchExpoNotificationsPermissionsModule() {
  if (!existsSync(expoNotificationsPermissionsModulePath)) {
    return;
  }

  const source = readFileSync(expoNotificationsPermissionsModulePath, 'utf8');
  if (source.includes('parseNotificationPermission(_ permission: [AnyHashable: Any])')) {
    return;
  }

  const importNeedle = "import ExpoModulesCore\nimport UIKit\n";
  const importReplacement = `import ExpoModulesCore\nimport UIKit\n\nprivate func permissionString(for status: EXPermissionStatus) -> String {\n  switch status {\n  case EXPermissionStatusGranted:\n    return \"granted\"\n  case EXPermissionStatusDenied:\n    return \"denied\"\n  default:\n    return \"undetermined\"\n  }\n}\n\nprivate func parseNotificationPermission(_ permission: [AnyHashable: Any]) -> [AnyHashable: Any] {\n  var parsed = permission\n  let statusValue =\n    (permission[\"status\"] as? NSNumber)?.intValue ??\n    (permission[\"status\"] as? Int) ??\n    Int(EXPermissionStatusUndetermined.rawValue)\n  let status = EXPermissionStatus(rawValue: UInt32(statusValue)) ?? EXPermissionStatusUndetermined\n  parsed[\"status\"] = permissionString(for: status)\n  parsed[\"expires\"] = \"never\"\n  parsed[\"granted\"] = status == EXPermissionStatusGranted\n  parsed[\"canAskAgain\"] = status != EXPermissionStatusDenied\n  return parsed\n}\n`;
  const resolverNeedle = '          promise.resolver(EXPermissionsService.parsePermission(fromRequester: permission))';
  const resolverReplacement = '          promise.resolver(parseNotificationPermission(permission))';

  let next = source;
  if (next.includes(importNeedle)) {
    next = next.replace(importNeedle, importReplacement);
  }
  next = next.replace(resolverNeedle, resolverReplacement);

  if (next !== source) {
    writeFileSync(expoNotificationsPermissionsModulePath, next, 'utf8');
  }
}

patchExpoNotificationsPermissionsModule();
