import { useCallback, useEffect, useRef, useState } from 'react';

import * as Haptics from 'expo-haptics';

import { getSkills, installSkill, uninstallSkill } from '../../../lib/api';
import { authenticateAction } from '../../../lib/security/biometric';
import { useAuditLogStore } from '../../security/store/auditLogStore';
import { buildSkillSecurityReport } from '../services/skillInstallService';
import type { InstalledSkill, SkillScanProgress, SkillSecurityReport } from '../types/skills';

interface UseSkillManagerParams {
  onSkillChanged?: () => Promise<void>;
}

interface UseSkillManagerResult {
  skills: InstalledSkill[];
  loading: boolean;
  refreshing: boolean;
  scanLoading: boolean;
  installing: boolean;
  uninstallingSkill: string | null;
  error: string | null;
  report: SkillSecurityReport | null;
  reportApproved: boolean;
  scanProgress: SkillScanProgress | null;
  refreshSkills: () => Promise<void>;
  generateReport: (input: string) => Promise<void>;
  approveReport: () => void;
  installApprovedSkill: () => Promise<boolean>;
  closeReport: () => void;
  uninstallOneSkill: (skillName: string) => Promise<boolean>;
}

export function useSkillManager(params: UseSkillManagerParams = {}): UseSkillManagerResult {
  const onSkillChanged = params.onSkillChanged;
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [uninstallingSkill, setUninstallingSkill] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SkillSecurityReport | null>(null);
  const [reportApproved, setReportApproved] = useState(false);
  const [scanProgress, setScanProgress] = useState<SkillScanProgress | null>(null);
  const appendAuditEntry = useAuditLogStore((state) => state.appendEntry);

  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshSkills = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }

    setRefreshing(true);
    setError(null);

    try {
      const response = await getSkills();
      if (!mountedRef.current) {
        return;
      }

      setSkills(
        response.skills.map((item) => ({
          name: item.name,
          version: item.version,
          description: item.description,
          installedAt: item.installedAt,
          trusted: item.trusted,
        })),
      );
    } catch (nextError: unknown) {
      if (!mountedRef.current) {
        return;
      }
      setError(nextError instanceof Error ? nextError.message : 'Failed to load skills');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  const generateReport = useCallback(async (input: string) => {
    const normalized = input.trim();
    if (!normalized) {
      setError('Please enter a skill name or ClawHub URL.');
      return;
    }

    setError(null);
    setReport(null);
    setReportApproved(false);
    setScanProgress({
      stage: 'metadata',
      message: 'Preparing security scan',
      scannedFileCount: 0,
      queuedCount: 0,
    });
    setScanLoading(true);

    try {
      const nextReport = await buildSkillSecurityReport(normalized, {
        onProgress: (progress) => {
          if (!mountedRef.current) {
            return;
          }
          setScanProgress(progress);
        },
      });
      if (!mountedRef.current) {
        return;
      }
      setReport(nextReport);
    } catch (scanError: unknown) {
      if (!mountedRef.current) {
        return;
      }
      setError(scanError instanceof Error ? scanError.message : 'Security scan failed.');
      setScanProgress(null);
    } finally {
      if (mountedRef.current) {
        setScanLoading(false);
      }
    }
  }, []);

  const installApprovedSkill = useCallback(async (): Promise<boolean> => {
    if (!report || !reportApproved) {
      setError('Please review and approve the security report first.');
      return false;
    }

    const allowed = await authenticateAction(`Install ${report.skillName}?`);
    if (!allowed) {
      appendAuditEntry({
        action: 'install_skill',
        target: report.skillName,
        result: 'cancelled',
        detail: 'Biometric check cancelled',
      });
      return false;
    }

    setInstalling(true);
    setError(null);

    try {
      await installSkill({ name: report.skillName, version: report.version });
      await refreshSkills();
      if (onSkillChanged) {
        await onSkillChanged();
      }
      if (mountedRef.current) {
        setReport(null);
        setReportApproved(false);
        setScanProgress(null);
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      appendAuditEntry({
        action: 'install_skill',
        target: report.skillName,
        result: 'success',
      });
      return true;
    } catch (installError: unknown) {
      if (mountedRef.current) {
        setError(installError instanceof Error ? installError.message : 'Install failed.');
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      appendAuditEntry({
        action: 'install_skill',
        target: report.skillName,
        result: 'failure',
        detail: installError instanceof Error ? installError.message : undefined,
      });
      return false;
    } finally {
      if (mountedRef.current) {
        setInstalling(false);
      }
    }
  }, [appendAuditEntry, onSkillChanged, refreshSkills, report, reportApproved]);

  const uninstallOneSkill = useCallback(
    async (skillName: string): Promise<boolean> => {
      const allowed = await authenticateAction(`Uninstall ${skillName}?`);
      if (!allowed) {
        appendAuditEntry({
          action: 'uninstall_skill',
          target: skillName,
          result: 'cancelled',
          detail: 'Biometric check cancelled',
        });
        return false;
      }

      setUninstallingSkill(skillName);
      setError(null);

      try {
        await uninstallSkill(skillName);
        await refreshSkills();
        if (onSkillChanged) {
          await onSkillChanged();
        }
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        appendAuditEntry({
          action: 'uninstall_skill',
          target: skillName,
          result: 'success',
        });
        return true;
      } catch (uninstallError: unknown) {
        if (mountedRef.current) {
          setError(uninstallError instanceof Error ? uninstallError.message : 'Uninstall failed.');
        }
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        appendAuditEntry({
          action: 'uninstall_skill',
          target: skillName,
          result: 'failure',
          detail: uninstallError instanceof Error ? uninstallError.message : undefined,
        });
        return false;
      } finally {
        if (mountedRef.current) {
          setUninstallingSkill(null);
        }
      }
    },
    [appendAuditEntry, onSkillChanged, refreshSkills],
  );

  return {
    skills,
    loading,
    refreshing,
    scanLoading,
    installing,
    uninstallingSkill,
    error,
    report,
    reportApproved,
    scanProgress,
    refreshSkills,
    generateReport,
    approveReport: () => {
      if (report?.scan.critical && report.scan.critical > 0) {
        setError(`Detected ${report.scan.critical} critical findings. Install only if source is trusted.`);
      } else {
        setError(null);
      }
      setReportApproved(true);
    },
    installApprovedSkill,
    closeReport: () => {
      setReport(null);
      setReportApproved(false);
      setScanProgress(null);
    },
    uninstallOneSkill,
  };
}
