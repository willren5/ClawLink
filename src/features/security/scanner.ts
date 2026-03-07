export type SecuritySeverity = 'CRITICAL' | 'WARNING' | 'INFO';
export type SecurityPermission =
  | 'network_access'
  | 'command_execution'
  | 'package_installation'
  | 'file_system_write'
  | 'secret_material';

export type SecurityFindingType =
  | 'BASE64_STRING'
  | 'SHELL_COMMAND'
  | 'URL_OR_IP_IN_CODE_BLOCK'
  | 'PACKAGE_INSTALL'
  | 'FILE_SYSTEM_OPERATION';

export interface SecurityScanTarget {
  filePath: string;
  content: string;
}

export interface SecurityFinding {
  id: string;
  filePath: string;
  type: SecurityFindingType;
  severity: SecuritySeverity;
  match: string;
  line: number;
  contextStartLine: number;
  contextEndLine: number;
  context: string[];
}

export interface SecurityScanResult {
  total: number;
  critical: number;
  warning: number;
  info: number;
  permissions: SecurityPermission[];
  findings: SecurityFinding[];
}

export const BASE64_REGEX = /[A-Za-z0-9+/]{40,}={0,2}/g;

export const SHELL_COMMAND_REGEX =
  /(`[^`]+`|\$\([^)]+\)|\bsh\b|\bbash\b|\bcurl\b|\bwget\b|\beval\b|\bexec\b|\bsystem\b|\bos\.popen\b|\bsubprocess\b)/gi;

export const URL_REGEX = /https?:\/\/[^\s`"'<>]+/gi;

export const IPV4_REGEX = /\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b/g;

export const PACKAGE_INSTALL_REGEX =
  /\b(?:pip(?:3)?\s+install|npm\s+install|pnpm\s+add|yarn\s+add|apt-get\s+install)\b/gi;

export const FILE_OPERATION_REGEX =
  /\b(?:rm\s+-rf|rm\s+-r|rm\s+\S+|mv\s+\S+\s+\S+|cp\s+\S+\s+\S+|chmod\s+\S+\s+\S+|chown\s+\S+\s+\S+)\b/gi;

const CONTEXT_RADIUS = 3;

function execAllMatches(input: string, pattern: RegExp): string[] {
  const regex = new RegExp(pattern.source, pattern.flags);
  const matches: string[] = [];
  let current = regex.exec(input);

  while (current) {
    const value = current[0]?.trim();
    if (value) {
      matches.push(value);
    }
    current = regex.exec(input);
  }

  return matches;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function extractContext(lines: string[], lineIndex: number): { start: number; end: number; context: string[] } {
  const start = Math.max(0, lineIndex - CONTEXT_RADIUS);
  const end = Math.min(lines.length - 1, lineIndex + CONTEXT_RADIUS);
  return {
    start: start + 1,
    end: end + 1,
    context: lines.slice(start, end + 1),
  };
}

function pushFinding(
  findings: SecurityFinding[],
  target: SecurityScanTarget,
  type: SecurityFindingType,
  severity: SecuritySeverity,
  match: string,
  lineIndex: number,
  lines: string[],
): void {
  const contextData = extractContext(lines, lineIndex);
  const id = `${target.filePath}:${lineIndex + 1}:${type}:${findings.length + 1}`;

  findings.push({
    id,
    filePath: target.filePath,
    type,
    severity,
    match,
    line: lineIndex + 1,
    contextStartLine: contextData.start,
    contextEndLine: contextData.end,
    context: contextData.context,
  });
}

function severityForBase64(match: string): SecuritySeverity {
  return match.length >= 120 ? 'CRITICAL' : 'WARNING';
}

function severityForFileOperation(match: string): SecuritySeverity {
  const lower = match.toLowerCase();
  if (lower.includes('rm ')) {
    return 'CRITICAL';
  }
  if (lower.includes('chown') || lower.includes('chmod')) {
    return 'WARNING';
  }
  return 'INFO';
}

function severityForCodeBlockAddress(match: string): SecuritySeverity {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(match)) {
    return 'WARNING';
  }
  return 'INFO';
}

function scanTarget(target: SecurityScanTarget): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = target.content.split(/\r?\n/);
  let inCodeBlock = false;

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }

    const base64Matches = dedupe(execAllMatches(line, BASE64_REGEX));
    base64Matches.forEach((match) => {
      pushFinding(findings, target, 'BASE64_STRING', severityForBase64(match), match, lineIndex, lines);
    });

    const shellMatches = dedupe(execAllMatches(line, SHELL_COMMAND_REGEX));
    shellMatches.forEach((match) => {
      pushFinding(findings, target, 'SHELL_COMMAND', 'CRITICAL', match, lineIndex, lines);
    });

    const packageMatches = dedupe(execAllMatches(line, PACKAGE_INSTALL_REGEX));
    packageMatches.forEach((match) => {
      pushFinding(findings, target, 'PACKAGE_INSTALL', 'WARNING', match, lineIndex, lines);
    });

    const fileOperationMatches = dedupe(execAllMatches(line, FILE_OPERATION_REGEX));
    fileOperationMatches.forEach((match) => {
      pushFinding(
        findings,
        target,
        'FILE_SYSTEM_OPERATION',
        severityForFileOperation(match),
        match,
        lineIndex,
        lines,
      );
    });

    if (inCodeBlock) {
      const urlMatches = dedupe(execAllMatches(line, URL_REGEX));
      const ipMatches = dedupe(execAllMatches(line, IPV4_REGEX));
      [...urlMatches, ...ipMatches].forEach((match) => {
        pushFinding(
          findings,
          target,
          'URL_OR_IP_IN_CODE_BLOCK',
          severityForCodeBlockAddress(match),
          match,
          lineIndex,
          lines,
        );
      });
    }
  });

  return findings;
}

function derivePermissions(findings: SecurityFinding[]): SecurityPermission[] {
  const permissions = new Set<SecurityPermission>();

  for (const finding of findings) {
    switch (finding.type) {
      case 'BASE64_STRING':
        permissions.add('secret_material');
        break;
      case 'SHELL_COMMAND':
        permissions.add('command_execution');
        break;
      case 'PACKAGE_INSTALL':
        permissions.add('package_installation');
        break;
      case 'FILE_SYSTEM_OPERATION':
        permissions.add('file_system_write');
        break;
      case 'URL_OR_IP_IN_CODE_BLOCK':
        permissions.add('network_access');
        break;
      default:
        break;
    }
  }

  return Array.from(permissions);
}

export function scanSecurityTargets(targets: SecurityScanTarget[]): SecurityScanResult {
  const findings = targets.flatMap((target) => scanTarget(target));

  return {
    total: findings.length,
    critical: findings.filter((item) => item.severity === 'CRITICAL').length,
    warning: findings.filter((item) => item.severity === 'WARNING').length,
    info: findings.filter((item) => item.severity === 'INFO').length,
    permissions: derivePermissions(findings),
    findings,
  };
}

export function scanRawText(content: string, filePath = 'inline-input'): SecurityScanResult {
  return scanSecurityTargets([{ filePath, content }]);
}
