import { createMMKV } from 'react-native-mmkv';

export const appStorage = createMMKV({
  id: 'claw-link-mmkv',
  encryptionKey: 'claw-link-local-cache-v1',
});

export function setString(key: string, value: string): void {
  appStorage.set(key, value);
}

export function getString(key: string): string | undefined {
  return appStorage.getString(key);
}

export function setNumber(key: string, value: number): void {
  appStorage.set(key, value);
}

export function getNumber(key: string): number | undefined {
  return appStorage.getNumber(key);
}

export function setBoolean(key: string, value: boolean): void {
  appStorage.set(key, value);
}

export function getBoolean(key: string): boolean | undefined {
  return appStorage.getBoolean(key);
}

export function setObject<T extends object>(key: string, value: T): void {
  appStorage.set(key, JSON.stringify(value));
}

export function getObject<T extends object>(key: string): T | undefined {
  const raw = appStorage.getString(key);
  if (!raw) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as T;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function removeItem(key: string): void {
  appStorage.remove(key);
}

export function clearAllStorage(): void {
  appStorage.clearAll();
}
