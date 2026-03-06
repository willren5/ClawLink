export type HealthBridgeMetricKey =
  | 'steps'
  | 'activeEnergyKcal'
  | 'exerciseMinutes'
  | 'standHours'
  | 'sleepDuration';

export type HealthBridgePermissionStatus = 'idle' | 'authorized' | 'denied' | 'unavailable';

export interface HealthBridgeSummary {
  date: string;
  timezone: string;
  activity: Partial<Record<'steps' | 'activeEnergyKcal' | 'exerciseMinutes' | 'standHours', number>>;
  sleep?: {
    durationMinutes: number;
  };
  source: 'ios-healthkit' | 'ios-healthkit-mock';
  generatedAt: string;
}
