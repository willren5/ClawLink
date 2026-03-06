import type { SecurityScanResult, SecurityScanTarget } from '../../security/scanner';

export interface InstalledSkill {
  name: string;
  version: string;
  description?: string;
  installedAt?: string;
  trusted?: boolean;
}

export interface SkillSourceFile {
  path: string;
  url?: string;
}

export interface ClawHubSkillMetadata {
  skillName: string;
  version?: string;
  description?: string;
  repositoryUrl?: string;
  rawBaseUrl?: string;
  sourceFiles: SkillSourceFile[];
  skillMdUrl?: string;
  skillJsonUrl?: string;
}

export type SkillScanStage = 'metadata' | 'collecting' | 'fetching' | 'scanning' | 'completed';

export interface SkillScanProgress {
  stage: SkillScanStage;
  message: string;
  scannedFileCount: number;
  queuedCount: number;
  currentFilePath?: string;
}

export interface SkillScanSourceSummary {
  metadataEndpoint: string;
  repositoryUrl?: string;
  initialCandidates: string[];
  fetchedUrls: string[];
  failedUrls: string[];
  blockedReferences: string[];
}

export interface SkillSecurityReport {
  skillName: string;
  version?: string;
  generatedAt: number;
  metadata: ClawHubSkillMetadata;
  sourceSummary: SkillScanSourceSummary;
  targets: SecurityScanTarget[];
  scan: SecurityScanResult;
}
