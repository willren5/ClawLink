"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildIncidentConditionKey = buildIncidentConditionKey;
exports.defaultDeepLinkForAlert = defaultDeepLinkForAlert;
exports.quickActionIdsForAlert = quickActionIdsForAlert;
exports.describeAlertQuickAction = describeAlertQuickAction;
exports.describeAlertQuickActions = describeAlertQuickActions;
const QUICK_ACTION_DEFINITIONS = {
    reconnect_gateway: {
        id: 'reconnect_gateway',
        deepLink: 'clawlink://dashboard',
    },
    open_monitor: {
        id: 'open_monitor',
        deepLink: 'clawlink://monitor',
    },
    flush_queue: {
        id: 'flush_queue',
        deepLink: 'clawlink://chat',
    },
    open_chat: {
        id: 'open_chat',
        deepLink: 'clawlink://chat',
    },
    refresh_agents: {
        id: 'refresh_agents',
        deepLink: 'clawlink://agents',
    },
    open_agents: {
        id: 'open_agents',
        deepLink: 'clawlink://agents',
    },
    open_dashboard: {
        id: 'open_dashboard',
        deepLink: 'clawlink://dashboard',
    },
};
function localized(language, zh, en) {
    return language === 'zh' ? zh : en;
}
function buildIncidentConditionKey(type, dedupeKey) {
    const normalized = dedupeKey?.trim();
    return normalized ? `${type}:${normalized}` : type;
}
function defaultDeepLinkForAlert(type) {
    if (type === 'queue_backlog') {
        return 'clawlink://chat';
    }
    if (type === 'disconnect_timeout') {
        return 'clawlink://monitor';
    }
    if (type === 'budget_near_limit' || type === 'budget_exceeded') {
        return 'clawlink://dashboard';
    }
    return 'clawlink://agents';
}
function quickActionIdsForAlert(type) {
    switch (type) {
        case 'disconnect_timeout':
            return ['reconnect_gateway', 'open_monitor'];
        case 'queue_backlog':
            return ['flush_queue', 'open_chat'];
        case 'budget_near_limit':
        case 'budget_exceeded':
            return ['open_dashboard'];
        default:
            return ['refresh_agents', 'open_agents'];
    }
}
function describeAlertQuickAction(actionId, language) {
    const base = QUICK_ACTION_DEFINITIONS[actionId];
    switch (actionId) {
        case 'reconnect_gateway':
            return {
                ...base,
                label: localized(language, '立即重连', 'Reconnect'),
            };
        case 'open_monitor':
            return {
                ...base,
                label: localized(language, '打开监控', 'Open Monitor'),
            };
        case 'flush_queue':
            return {
                ...base,
                label: localized(language, '刷新队列', 'Flush Queue'),
            };
        case 'open_chat':
            return {
                ...base,
                label: localized(language, '打开聊天', 'Open Chat'),
            };
        case 'refresh_agents':
            return {
                ...base,
                label: localized(language, '刷新状态', 'Refresh'),
            };
        case 'open_agents':
            return {
                ...base,
                label: localized(language, '打开 Agents', 'Open Agents'),
            };
        case 'open_dashboard':
            return {
                ...base,
                label: localized(language, '打开首页', 'Open Dashboard'),
            };
        default:
            return {
                ...base,
                label: actionId,
            };
    }
}
function describeAlertQuickActions(type, language) {
    return quickActionIdsForAlert(type).map((actionId) => describeAlertQuickAction(actionId, language));
}
