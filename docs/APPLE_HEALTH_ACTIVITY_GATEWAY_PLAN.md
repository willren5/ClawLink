# ClawLink Apple Health / Activity Gateway Plan

## Goal
Allow ClawLink to optionally act as a secure bridge so OpenClaw can request read-only Apple Health and Activity summaries from user-approved iOS devices.

## Scope (Phase 1)
- Read-only metrics: steps, active energy, exercise minutes, stand hours, sleep duration.
- Explicit per-metric consent in app.
- Gateway integration via a dedicated OpenClaw Skill (server-side component).
- No background continuous streaming in Phase 1.

## User Experience
1. User opens `Settings -> Health Bridge` in ClawLink.
2. User enables bridge and selects allowed metrics.
3. User approves HealthKit permissions via iOS prompt.
4. OpenClaw calls bridge skill endpoint and receives normalized JSON summary.
5. User can revoke all permissions and disconnect bridge at any time.

## Architecture
- iOS app:
  - HealthKit reader module.
  - Local policy store (allowed metrics, retention window).
  - Signed request verifier (token + nonce + timestamp).
- OpenClaw gateway skill:
  - `health.summary` command.
  - Request/response schema validation.
  - Rate limiting and audit logs.
- Transport:
  - Existing gateway WS channel preferred.
  - Fallback: HTTPS signed request callback.

## Security Requirements
- Opt-in only (default OFF).
- Per-metric toggle, not blanket access.
- Read-only, no write-back.
- Short-lived signed requests (nonce + timestamp expiry <= 60s).
- Local on-device cache only, default TTL <= 15 minutes.
- Redact PII in gateway logs by default.

## Data Contract (Draft)
```json
{
  "date": "2026-03-05",
  "timezone": "Asia/Shanghai",
  "activity": {
    "steps": 8123,
    "activeEnergyKcal": 412,
    "exerciseMinutes": 39,
    "standHours": 10
  },
  "sleep": {
    "durationMinutes": 421
  },
  "source": "ios-healthkit",
  "generatedAt": "2026-03-05T04:00:00.000Z"
}
```

## Milestones
- M1: UI settings + permission flow + local mock data.
- M2: HealthKit real reader + schema normalization.
- M3: Gateway skill integration + signed request verification.
- M4: E2E test on real device + privacy review + docs.

## Open Risks
- HealthKit access requires real device validation; simulator coverage is limited.
- Regional policy/legal constraints for health data processing.
- Battery impact if polling interval is too aggressive.

## Success Criteria
- User can enable/disable bridge in under 30 seconds.
- Gateway fetch succeeds with < 2s p95 latency on LAN.
- No health data returned when bridge is OFF or permission revoked.
