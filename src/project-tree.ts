export const PROJECT_DIRECTORY_TREE = `
ClawChat/
+-- README.md
+-- app/
|   +-- _layout.tsx
|   +-- index.tsx
|   +-- connection.tsx
|   +-- permissions.tsx
|   +-- (tabs)/
|   |   +-- _layout.tsx
|   |   +-- dashboard.tsx
|   |   +-- agents.tsx
|   |   +-- monitor.tsx
|   |   +-- chat.tsx
|   +-- settings/
|       +-- gateways.tsx
+-- src/
    +-- project-tree.ts
    +-- constants/
    |   +-- storageKeys.ts
    +-- lib/
    |   +-- api/
    |   |   +-- client.ts
    |   |   +-- endpoints.ts
    |   |   +-- index.ts
    |   |   +-- types.ts
    |   +-- mmkv/
    |   |   +-- storage.ts
    |   |   +-- zustandStorage.ts
    |   +-- schemas/
    |   |   +-- api.ts
    |   |   +-- index.ts
    |   +-- secure/
    |   |   +-- tokenVault.ts
    |   +-- security/
    |   |   +-- biometric.ts
    |   +-- utils/
    |       +-- network.ts
    |       +-- ringBuffer.ts
    +-- features/
        +-- connection/
        |   +-- types.ts
        |   +-- hooks/
        |   |   +-- useConnectionHeartbeat.ts
        |   +-- services/
        |   |   +-- connectionService.ts
        |   +-- store/
        |   |   +-- connectionStore.ts
        |   +-- screens/
        |       +-- ConnectionScreen.tsx
        |       +-- GatewayProfilesScreen.tsx
        +-- onboarding/
        |   +-- store/
        |   |   +-- permissionsStore.ts
        |   +-- screens/
        |       +-- PermissionsScreen.tsx
        +-- dashboard/
        |   +-- types.ts
        |   +-- mocks/
        |   |   +-- mockDashboard.ts
        |   +-- store/
        |   |   +-- dashboardStore.ts
        |   +-- screens/
        |       +-- DashboardScreen.tsx
        +-- settings/
        |   +-- store/
        |       +-- pricingStore.ts
        +-- agents/
        |   +-- types/
        |   |   +-- index.ts
        |   |   +-- skills.ts
        |   +-- hooks/
        |   |   +-- useAgentsControl.ts
        |   |   +-- useSkillManager.ts
        |   +-- services/
        |   |   +-- skillInstallService.ts
        |   +-- screens/
        |       +-- AgentsScreen.tsx
        +-- monitor/
        |   +-- types/
        |   |   +-- index.ts
        |   +-- hooks/
        |   |   +-- useGatewayLogsStream.ts
        |   |   +-- useHostMetricsStream.ts
        |   +-- store/
        |   |   +-- monitorSettingsStore.ts
        |   +-- screens/
        |       +-- MonitorScreen.tsx
        +-- chat/
        |   +-- types/
        |   |   +-- index.ts
        |   +-- services/
        |   |   +-- hash.ts
        |   |   +-- gatewayContext.ts
        |   |   +-- streaming.ts
        |   |   +-- transcription.ts
        |   +-- store/
        |   |   +-- chatStore.ts
        |   +-- screens/
        |       +-- ChatScreen.tsx
        +-- security/
            +-- scanner.ts
+-- docs/
    +-- MANUAL.md
    +-- WORKLOG.md
`;
