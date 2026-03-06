import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY_PREFIX = 'claw_link_token_';
const LEGACY_TOKEN_KEY_PREFIX = 'claw_console_token_';
const MAX_KEY_STEM_LENGTH = 48;
const SECURE_STORE_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} as const;

function normalizeTokenRef(tokenRef: string): string {
  return typeof tokenRef === 'string' ? tokenRef.trim() : '';
}

function isValidSecureStoreKey(key: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(key);
}

function sanitizeTokenRef(tokenRef: string): string {
  const normalized = normalizeTokenRef(tokenRef);
  if (!normalized) {
    return 'ref';
  }

  const sanitized = normalized
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!sanitized) {
    return 'ref';
  }

  return sanitized.slice(0, MAX_KEY_STEM_LENGTH);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildPrimaryTokenKey(tokenRef: string, prefix = TOKEN_KEY_PREFIX): string {
  const normalized = normalizeTokenRef(tokenRef);
  return `${prefix}${sanitizeTokenRef(normalized)}_${stableHash(normalized)}`;
}

function buildLegacyTokenKey(tokenRef: string, prefix = TOKEN_KEY_PREFIX): string {
  return `${prefix}${normalizeTokenRef(tokenRef)}`;
}

function candidateTokenKeys(tokenRef: string, prefix = TOKEN_KEY_PREFIX): string[] {
  const primaryKey = buildPrimaryTokenKey(tokenRef, prefix);
  const legacyKey = buildLegacyTokenKey(tokenRef, prefix);

  if (legacyKey === primaryKey || !isValidSecureStoreKey(legacyKey)) {
    return [primaryKey];
  }

  return [primaryKey, legacyKey];
}

async function safeSetItem(key: string, value: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS);
    return true;
  } catch {
    return false;
  }
}

async function safeGetItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function safeDeleteItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Best effort cleanup.
  }
}

export async function saveGatewayToken(tokenRef: string, token: string): Promise<void> {
  const [primaryKey] = candidateTokenKeys(tokenRef);
  const saved = await safeSetItem(primaryKey, token);
  if (!saved) {
    throw new Error('Failed to store gateway token securely. Please try again.');
  }
}

async function readTokenFromKeys(keys: string[]): Promise<{ key: string; token: string } | null> {
  for (const key of keys) {
    const token = await safeGetItem(key);
    if (token) {
      return { key, token };
    }
  }
  return null;
}

export async function getGatewayToken(tokenRef: string): Promise<string | null> {
  const currentKeys = candidateTokenKeys(tokenRef, TOKEN_KEY_PREFIX);
  const primaryCurrentKey = currentKeys[0];
  const currentTokenEntry = await readTokenFromKeys(currentKeys);

  if (currentTokenEntry) {
    if (currentTokenEntry.key !== primaryCurrentKey) {
      await safeSetItem(primaryCurrentKey, currentTokenEntry.token);
      await safeDeleteItem(currentTokenEntry.key);
    }
    return currentTokenEntry.token;
  }

  const legacyKeys = candidateTokenKeys(tokenRef, LEGACY_TOKEN_KEY_PREFIX);
  const legacyTokenEntry = await readTokenFromKeys(legacyKeys);
  if (!legacyTokenEntry) {
    return null;
  }

  await safeSetItem(primaryCurrentKey, legacyTokenEntry.token);
  await Promise.all(legacyKeys.map((key) => safeDeleteItem(key)));
  return legacyTokenEntry.token;
}

export async function deleteGatewayToken(tokenRef: string): Promise<void> {
  const keys = [
    ...candidateTokenKeys(tokenRef, TOKEN_KEY_PREFIX),
    ...candidateTokenKeys(tokenRef, LEGACY_TOKEN_KEY_PREFIX),
  ];
  const deduped = [...new Set(keys)];
  await Promise.all(deduped.map((key) => safeDeleteItem(key)));
}
