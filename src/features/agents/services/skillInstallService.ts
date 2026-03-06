import { z } from 'zod';

import { scanSecurityTargets, type SecurityScanTarget } from '../../security/scanner';
import type {
  ClawHubSkillMetadata,
  SkillScanProgress,
  SkillSecurityReport,
  SkillSourceFile,
} from '../types/skills';

const CLAWHUB_HOST = 'api.clawhub.ai';
const CLAWHUB_BASE_URL = `https://${CLAWHUB_HOST}/v1/skills`;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_SCAN_FILES = 14;
const MAX_FILE_SIZE = 350_000;

const RawMetadataSchema = z.record(z.string(), z.unknown());

interface MetadataFetchResult {
  metadataEndpoint: string;
  metadata: ClawHubSkillMetadata;
}

export interface BuildSkillSecurityReportOptions {
  onProgress?: (progress: SkillScanProgress) => void;
}

function sanitizeSkillName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Skill input is required.');
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (!segments.length) {
        throw new Error('Invalid skill URL path.');
      }
      return decodeURIComponent(segments[segments.length - 1]);
    } catch {
      throw new Error('Invalid skill URL.');
    }
  }

  return trimmed;
}

function readString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readSourceFiles(raw: Record<string, unknown>): SkillSourceFile[] {
  const filesRaw = raw.files;
  if (!Array.isArray(filesRaw)) {
    return [];
  }

  return filesRaw
    .map((item): SkillSourceFile | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Record<string, unknown>;
      const path = readString(record, ['path', 'name', 'file']);
      if (!path) {
        return null;
      }

      const url = readString(record, ['url', 'rawUrl', 'raw_url', 'downloadUrl', 'download_url']);
      return {
        path,
        url,
      };
    })
    .filter((item): item is SkillSourceFile => item !== null);
}

function toMetadata(skillName: string, raw: Record<string, unknown>): ClawHubSkillMetadata {
  const repository = raw.repository;
  const repositoryRecord = repository && typeof repository === 'object' ? (repository as Record<string, unknown>) : {};

  return {
    skillName: readString(raw, ['name', 'skillName', 'skill_name']) ?? skillName,
    version: readString(raw, ['version', 'latestVersion', 'latest_version']),
    description: readString(raw, ['description', 'summary']),
    repositoryUrl: readString(repositoryRecord, ['url', 'htmlUrl', 'html_url']),
    rawBaseUrl: readString(repositoryRecord, ['rawBaseUrl', 'raw_base_url']),
    sourceFiles: readSourceFiles(raw),
    skillMdUrl: readString(raw, ['skillMdUrl', 'skill_md_url', 'readmeUrl', 'readme_url']),
    skillJsonUrl: readString(raw, ['skillJsonUrl', 'skill_json_url', 'manifestUrl', 'manifest_url']),
  };
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextFile(url: string): Promise<string> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  if (text.length > MAX_FILE_SIZE) {
    return text.slice(0, MAX_FILE_SIZE);
  }

  return text;
}

function resolveFileUrl(path: string, rawBaseUrl?: string): string | undefined {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (!rawBaseUrl) {
    return undefined;
  }

  try {
    const normalizedBase = rawBaseUrl.endsWith('/') ? rawBaseUrl : `${rawBaseUrl}/`;
    const sanitizedPath = path.startsWith('/') ? path.slice(1) : path;
    return new URL(sanitizedPath, normalizedBase).toString();
  } catch {
    return undefined;
  }
}

function filePathFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.split('/').filter(Boolean).slice(-2).join('/');
    return pathname || parsed.hostname;
  } catch {
    return url;
  }
}

function isPrivateIpv4Host(hostname: string): boolean {
  const segments = hostname.split('.').map((item) => Number.parseInt(item, 10));
  if (segments.length !== 4 || segments.some((item) => Number.isNaN(item) || item < 0 || item > 255)) {
    return false;
  }

  if (segments[0] === 10 || segments[0] === 127 || segments[0] === 0) {
    return true;
  }

  if (segments[0] === 169 && segments[1] === 254) {
    return true;
  }

  if (segments[0] === 172 && segments[1] >= 16 && segments[1] <= 31) {
    return true;
  }

  if (segments[0] === 192 && segments[1] === 168) {
    return true;
  }

  if (segments[0] === 100 && segments[1] >= 64 && segments[1] <= 127) {
    return true;
  }

  return false;
}

function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    return true;
  }

  if (!normalized.includes('.') && !normalized.includes(':')) {
    return true;
  }

  if (isPrivateIpv4Host(normalized)) {
    return true;
  }

  if (normalized.includes(':')) {
    if (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd')
    ) {
      return true;
    }
  }

  return false;
}

function isSafeScanUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return false;
    }

    return !isUnsafeHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function isAllowedFollowupUrl(url: string, allowedHosts: Set<string>): boolean {
  try {
    const parsed = new URL(url);
    if (!isSafeScanUrl(url)) {
      return false;
    }
    return allowedHosts.has(parsed.host) || parsed.host === CLAWHUB_HOST;
  } catch {
    return false;
  }
}

function extractReferences(source: string): string[] {
  const refs = new Set<string>();

  const linkRegex = /\[[^\]]+\]\(([^)]+)\)/g;
  let linkMatch = linkRegex.exec(source);
  while (linkMatch) {
    const link = linkMatch[1]?.trim();
    if (link) {
      refs.add(link);
    }
    linkMatch = linkRegex.exec(source);
  }

  const quotedFileRegex = /["'`]([A-Za-z0-9_./-]+\.(?:json|ya?ml|toml|ini|cfg|conf|md|txt|sh|py|ts|js))["'`]/g;
  let fileMatch = quotedFileRegex.exec(source);
  while (fileMatch) {
    const path = fileMatch[1]?.trim();
    if (path) {
      refs.add(path);
    }
    fileMatch = quotedFileRegex.exec(source);
  }

  return Array.from(refs);
}

function buildInitialCandidateUrls(metadata: ClawHubSkillMetadata): string[] {
  const candidates = new Set<string>();

  if (metadata.skillMdUrl) {
    candidates.add(metadata.skillMdUrl);
  }

  if (metadata.skillJsonUrl) {
    candidates.add(metadata.skillJsonUrl);
  }

  for (const file of metadata.sourceFiles) {
    if (file.url) {
      const lower = file.path.toLowerCase();
      if (lower.includes('skill.md') || lower.includes('skill.json') || lower.endsWith('.md') || lower.endsWith('.json')) {
        candidates.add(file.url);
      }
      continue;
    }

    const resolved = resolveFileUrl(file.path, metadata.rawBaseUrl);
    if (!resolved) {
      continue;
    }

    const lower = file.path.toLowerCase();
    if (lower.includes('skill.md') || lower.includes('skill.json') || lower.endsWith('.md') || lower.endsWith('.json')) {
      candidates.add(resolved);
    }
  }

  return Array.from(candidates);
}

async function fetchMetadata(skillInput: string): Promise<MetadataFetchResult> {
  const normalizedSkillName = sanitizeSkillName(skillInput);
  const metadataEndpoint = `${CLAWHUB_BASE_URL}/${encodeURIComponent(normalizedSkillName)}/latest`;
  const response = await fetchWithTimeout(metadataEndpoint);
  if (!response.ok) {
    throw new Error(`Failed to fetch ClawHub metadata: HTTP ${response.status}`);
  }

  const rawJson = RawMetadataSchema.parse(await response.json());
  return {
    metadataEndpoint,
    metadata: toMetadata(normalizedSkillName, rawJson),
  };
}

function publishProgress(
  onProgress: BuildSkillSecurityReportOptions['onProgress'],
  progress: SkillScanProgress,
): void {
  if (!onProgress) {
    return;
  }
  onProgress(progress);
}

export async function buildSkillSecurityReport(
  skillInput: string,
  options: BuildSkillSecurityReportOptions = {},
): Promise<SkillSecurityReport> {
  publishProgress(options.onProgress, {
    stage: 'metadata',
    message: 'Fetching skill metadata from ClawHub',
    scannedFileCount: 0,
    queuedCount: 0,
  });

  const metadataResult = await fetchMetadata(skillInput);
  const metadata = metadataResult.metadata;
  const targets: SecurityScanTarget[] = [];
  const blockedReferences = new Set<string>();

  targets.push({
    filePath: 'clawhub-metadata.json',
    content: JSON.stringify(metadata, null, 2),
  });

  const allowedHosts = new Set<string>([CLAWHUB_HOST]);
  const initialCandidates = buildInitialCandidateUrls(metadata);
  const queue = initialCandidates.filter((url) => {
    const safe = isSafeScanUrl(url);
    if (!safe) {
      blockedReferences.add(url);
    }
    return safe;
  });
  const fetched = new Set<string>();
  const fetchedUrls: string[] = [];
  const failedUrls: string[] = [];

  publishProgress(options.onProgress, {
    stage: 'collecting',
    message: `Collected ${queue.length} initial source candidates`,
    scannedFileCount: targets.length,
    queuedCount: queue.length,
  });

  while (queue.length > 0 && targets.length < MAX_SCAN_FILES) {
    const nextUrl = queue.shift();
    if (!nextUrl || fetched.has(nextUrl)) {
      continue;
    }

    fetched.add(nextUrl);

    publishProgress(options.onProgress, {
      stage: 'fetching',
      message: `Fetching ${filePathFromUrl(nextUrl)}`,
      scannedFileCount: targets.length,
      queuedCount: queue.length + 1,
      currentFilePath: filePathFromUrl(nextUrl),
    });

    try {
      const text = await fetchTextFile(nextUrl);
      fetchedUrls.push(nextUrl);

      targets.push({
        filePath: filePathFromUrl(nextUrl),
        content: text,
      });

      try {
        allowedHosts.add(new URL(nextUrl).host);
      } catch {
        continue;
      }

      const references = extractReferences(text);
      for (const ref of references) {
        let resolved: string | undefined;

        if (/^https?:\/\//i.test(ref)) {
          resolved = ref;
        } else {
          try {
            resolved = new URL(ref, nextUrl).toString();
          } catch {
            resolved = resolveFileUrl(ref, metadata.rawBaseUrl);
          }
        }

        if (!resolved) {
          continue;
        }

        if (!isAllowedFollowupUrl(resolved, allowedHosts)) {
          blockedReferences.add(resolved);
          continue;
        }

        if (!fetched.has(resolved)) {
          queue.push(resolved);
        }
      }
    } catch {
      failedUrls.push(nextUrl);
      continue;
    }
  }

  publishProgress(options.onProgress, {
    stage: 'scanning',
    message: `Running scanner across ${targets.length} files`,
    scannedFileCount: targets.length,
    queuedCount: queue.length,
  });

  const scan = scanSecurityTargets(targets);

  publishProgress(options.onProgress, {
    stage: 'completed',
    message: 'Security report ready',
    scannedFileCount: targets.length,
    queuedCount: 0,
  });

  return {
    skillName: metadata.skillName,
    version: metadata.version,
    generatedAt: Date.now(),
    metadata,
    sourceSummary: {
      metadataEndpoint: metadataResult.metadataEndpoint,
      repositoryUrl: metadata.repositoryUrl,
      initialCandidates,
      fetchedUrls,
      failedUrls,
      blockedReferences: Array.from(blockedReferences).slice(0, 40),
    },
    targets,
    scan,
  };
}
