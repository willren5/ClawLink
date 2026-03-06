import * as LocalAuthentication from 'expo-local-authentication';

export async function authenticateAction(reason: string): Promise<boolean> {
  const compatible = await LocalAuthentication.hasHardwareAsync();
  if (!compatible) {
    return false;
  }

  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) {
    return false;
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
    fallbackLabel: 'Use Passcode',
    disableDeviceFallback: false,
  });

  return result.success;
}
