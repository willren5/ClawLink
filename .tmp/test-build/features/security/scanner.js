"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILE_OPERATION_REGEX = exports.PACKAGE_INSTALL_REGEX = exports.IPV4_REGEX = exports.URL_REGEX = exports.SHELL_COMMAND_REGEX = exports.BASE64_REGEX = void 0;
exports.scanSecurityTargets = scanSecurityTargets;
exports.scanRawText = scanRawText;
exports.BASE64_REGEX = /[A-Za-z0-9+/]{40,}={0,2}/g;
exports.SHELL_COMMAND_REGEX = /(`[^`]+`|\$\([^)]+\)|\bsh\b|\bbash\b|\bcurl\b|\bwget\b|\beval\b|\bexec\b|\bsystem\b|\bos\.popen\b|\bsubprocess\b)/gi;
exports.URL_REGEX = /https?:\/\/[^\s`"'<>]+/gi;
exports.IPV4_REGEX = /\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b/g;
exports.PACKAGE_INSTALL_REGEX = /\b(?:pip(?:3)?\s+install|npm\s+install|pnpm\s+add|yarn\s+add|apt-get\s+install)\b/gi;
exports.FILE_OPERATION_REGEX = /\b(?:rm\s+-rf|rm\s+-r|rm\s+\S+|mv\s+\S+\s+\S+|cp\s+\S+\s+\S+|chmod\s+\S+\s+\S+|chown\s+\S+\s+\S+)\b/gi;
const CONTEXT_RADIUS = 3;
function execAllMatches(input, pattern) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const matches = [];
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
function dedupe(values) {
    return Array.from(new Set(values));
}
function extractContext(lines, lineIndex) {
    const start = Math.max(0, lineIndex - CONTEXT_RADIUS);
    const end = Math.min(lines.length - 1, lineIndex + CONTEXT_RADIUS);
    return {
        start: start + 1,
        end: end + 1,
        context: lines.slice(start, end + 1),
    };
}
function pushFinding(findings, target, type, severity, match, lineIndex, lines) {
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
function severityForBase64(match) {
    return match.length >= 120 ? 'CRITICAL' : 'WARNING';
}
function severityForFileOperation(match) {
    const lower = match.toLowerCase();
    if (lower.includes('rm ')) {
        return 'CRITICAL';
    }
    if (lower.includes('chown') || lower.includes('chmod')) {
        return 'WARNING';
    }
    return 'INFO';
}
function severityForCodeBlockAddress(match) {
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(match)) {
        return 'WARNING';
    }
    return 'INFO';
}
function scanTarget(target) {
    const findings = [];
    const lines = target.content.split(/\r?\n/);
    let inCodeBlock = false;
    lines.forEach((line, lineIndex) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
        }
        const base64Matches = dedupe(execAllMatches(line, exports.BASE64_REGEX));
        base64Matches.forEach((match) => {
            pushFinding(findings, target, 'BASE64_STRING', severityForBase64(match), match, lineIndex, lines);
        });
        const shellMatches = dedupe(execAllMatches(line, exports.SHELL_COMMAND_REGEX));
        shellMatches.forEach((match) => {
            pushFinding(findings, target, 'SHELL_COMMAND', 'CRITICAL', match, lineIndex, lines);
        });
        const packageMatches = dedupe(execAllMatches(line, exports.PACKAGE_INSTALL_REGEX));
        packageMatches.forEach((match) => {
            pushFinding(findings, target, 'PACKAGE_INSTALL', 'WARNING', match, lineIndex, lines);
        });
        const fileOperationMatches = dedupe(execAllMatches(line, exports.FILE_OPERATION_REGEX));
        fileOperationMatches.forEach((match) => {
            pushFinding(findings, target, 'FILE_SYSTEM_OPERATION', severityForFileOperation(match), match, lineIndex, lines);
        });
        if (inCodeBlock) {
            const urlMatches = dedupe(execAllMatches(line, exports.URL_REGEX));
            const ipMatches = dedupe(execAllMatches(line, exports.IPV4_REGEX));
            [...urlMatches, ...ipMatches].forEach((match) => {
                pushFinding(findings, target, 'URL_OR_IP_IN_CODE_BLOCK', severityForCodeBlockAddress(match), match, lineIndex, lines);
            });
        }
    });
    return findings;
}
function derivePermissions(findings) {
    const permissions = new Set();
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
function scanSecurityTargets(targets) {
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
function scanRawText(content, filePath = 'inline-input') {
    return scanSecurityTargets([{ filePath, content }]);
}
