import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import Markdown, { type ASTNode, type RenderRules } from 'react-native-markdown-display';
import { useShallow } from 'zustand/react/shallow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiquidGlassPanel } from '../../../components/LiquidGlassPanel';
import { getAgents, getModels, getSessionsSummary } from '../../../lib/api';
import { isExperimentalFeatureEnabled } from '../../../lib/features/featureFlags';
import { useI18n } from '../../../lib/i18n';
import { useAgentsRuntimeStore } from '../../agents/store/agentsRuntimeStore';
import { adaptiveColor, createAdaptiveStyles, mapColorForMode, useAccentColor, useThemeMode } from '../../../theme/adaptiveStyles';
import { useConnectionStore } from '../../connection/store/connectionStore';
import { useAppPreferencesStore } from '../../settings/store/preferencesStore';
import { formatCurrencyAmount, usePricingStore } from '../../settings/store/pricingStore';
import { useChatStore } from '../store/chatStore';
import { resolveRunbooksForAgent, useChatRunbookStore, type ChatRunbook } from '../store/runbookStore';
import { MessageSearch, type MessageSearchResult } from '../components/MessageSearch';
import { exportSessionToFile, shareExportedSession } from '../services/sessionExport';
import { transcribeAudioUri } from '../services/transcription';
import type {
  ChatAttachment,
  ChatAttachmentPreview,
  LocalChatMessage,
  LocalChatSession,
  ReasoningEffort,
} from '../types';

const MAX_ATTACHMENTS = 3;
const MAX_IMAGE_BASE64_LENGTH = 32_000_000;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium';

function withAlpha(color: string, alpha: string): string {
  const normalized = color.trim().replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(normalized) ? `#${normalized}${alpha}` : color;
}

interface AgentOption {
  id: string;
  name: string;
  model?: string;
}

interface ModelOption {
  id: string;
  label: string;
  supportsReasoning: boolean;
  contextWindow?: number;
}

interface ComposerAttachment {
  payload: ChatAttachment;
  preview: ChatAttachmentPreview;
}

interface SessionSection {
  key: string;
  title: string;
  data: LocalChatSession[];
}

interface SessionStats {
  messageCount: number;
  imageCount: number;
}

interface InlineNotice {
  title: string;
  body: string;
  tone: 'info' | 'error' | 'success';
}

function supportsReasoningByModel(modelId: string): boolean {
  return /(codex|gpt-5)/i.test(modelId);
}

function isLegacyAliasModel(label: string): boolean {
  return /\blegacy alias\b/i.test(label);
}

async function uriToBase64ViaFileReader(uri: string): Promise<string | undefined> {
  if (typeof FileReader === 'undefined') {
    return undefined;
  }

  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('file-reader-failed'));
      reader.onloadend = () => {
        resolve(typeof reader.result === 'string' ? reader.result : '');
      };
      reader.readAsDataURL(blob);
    });

    const marker = ';base64,';
    const markerIndex = dataUrl.indexOf(marker);
    if (markerIndex === -1) {
      return undefined;
    }

    const base64 = dataUrl.slice(markerIndex + marker.length);
    return base64 || undefined;
  } catch {
    return undefined;
  }
}

function toDayStart(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function toWeekStart(value: number): number {
  const date = new Date(value);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - diff);
  return date.getTime();
}

function toMonthStart(value: number): number {
  const date = new Date(value);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatMonthTitle(value: number): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
  });
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatCompactTokenCount(value: number): string {
  const safeValue = Math.max(0, value);
  if (safeValue >= 1_000_000) {
    return `${(safeValue / 1_000_000).toFixed(1)}M`;
  }
  if (safeValue >= 1000) {
    return `${(safeValue / 1000).toFixed(1)}K`;
  }
  return `${safeValue}`;
}

function sectionTitleByKey(sectionKey: string, fallback: string, t: ReturnType<typeof useI18n>['t']): string {
  switch (sectionKey) {
    case 'today':
      return t('chat_section_today');
    case 'yesterday':
      return t('chat_section_yesterday');
    case 'this-week':
      return t('chat_section_this_week');
    case 'last-week':
      return t('chat_section_last_week');
    case 'this-month':
      return t('chat_section_this_month');
    default:
      return fallback;
  }
}

function formatSyncStatusLabel(value: LocalChatMessage['syncStatus'], t: ReturnType<typeof useI18n>['t']): string {
  switch (value) {
    case 'pending':
      return t('chat_sync_pending');
    case 'streaming':
      return t('chat_sync_streaming');
    case 'synced':
      return t('chat_sync_synced');
    case 'failed':
      return t('chat_sync_failed');
    default:
      return value;
  }
}

function estimateContextLimit(modelId: string | null | undefined): number {
  const normalized = modelId?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return 128_000;
  }
  if (normalized.includes('gpt-4o-mini') || normalized.includes('gpt-4.1-mini')) {
    return 128_000;
  }
  if (normalized.includes('gpt-4o') || normalized.includes('gpt-4.1') || normalized.includes('gpt-5')) {
    return 128_000;
  }
  if (normalized.includes('o3') || normalized.includes('o4')) {
    return 200_000;
  }
  if (normalized.includes('codex')) {
    return 128_000;
  }
  return 128_000;
}

function timelineIconByKind(kind: 'tool' | 'reasoning' | 'io' | 'response'): string {
  switch (kind) {
    case 'tool':
      return '🔧';
    case 'reasoning':
      return '🧠';
    case 'io':
      return '📄';
    case 'response':
      return '✅';
    default:
      return '•';
  }
}

function resolveLanguageFromFence(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return 'plain';
  }
  const primary = normalized.split(/\s+/)[0];
  if (primary === 'ts' || primary === 'tsx') {
    return 'typescript';
  }
  if (primary === 'js' || primary === 'jsx') {
    return 'javascript';
  }
  if (primary === 'sh' || primary === 'bash' || primary === 'zsh') {
    return 'shell';
  }
  return primary;
}

function resolveCodeHighlightKeywords(language: string): string[] {
  if (language === 'javascript' || language === 'typescript') {
    return ['const', 'let', 'var', 'if', 'else', 'return', 'await', 'async', 'function', 'import', 'from', 'export'];
  }
  if (language === 'python') {
    return ['def', 'if', 'elif', 'else', 'return', 'import', 'from', 'class', 'for', 'while', 'try', 'except'];
  }
  if (language === 'json') {
    return ['true', 'false', 'null'];
  }
  if (language === 'shell' || language === 'bash') {
    return ['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'function', 'export'];
  }
  return [];
}

function tokenizeCodeLine(
  line: string,
  language: string,
): Array<{ text: string; type: 'comment' | 'string' | 'number' | 'keyword' | 'plain' }> {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
    return [{ text: line, type: 'comment' }];
  }

  const tokens: Array<{ text: string; type: 'comment' | 'string' | 'number' | 'keyword' | 'plain' }> = [];
  const keywords = new Set(resolveCodeHighlightKeywords(language));
  const parts = line.split(/(\s+|["'`].*?["'`]|-?\d+(?:\.\d+)?\b|[A-Za-z_]\w*)/g).filter(Boolean);

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (/^["'`].*["'`]$/.test(part)) {
      tokens.push({ text: part, type: 'string' });
      continue;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(part)) {
      tokens.push({ text: part, type: 'number' });
      continue;
    }
    if (keywords.has(lower)) {
      tokens.push({ text: part, type: 'keyword' });
      continue;
    }
    tokens.push({ text: part, type: 'plain' });
  }

  return tokens;
}

function parseMentionedAgent(content: string, agents: AgentOption[]): AgentOption | null {
  const match = content.match(/@([^\s]+)/);
  if (!match) {
    return null;
  }
  const raw = match[1].trim().toLowerCase();
  if (!raw) {
    return null;
  }

  for (const agent of agents) {
    const normalizedName = agent.name.trim().toLowerCase().replace(/\s+/g, '');
    const normalizedId = agent.id.trim().toLowerCase();
    if (raw === normalizedName || raw === normalizedId) {
      return agent;
    }
  }

  return null;
}

function groupSessionsByRecency(
  sessions: LocalChatSession[],
  t: ReturnType<typeof useI18n>['t'],
): SessionSection[] {
  const now = Date.now();
  const todayStart = toDayStart(now);
  const yesterdayStart = todayStart - DAY_IN_MS;
  const weekStart = toWeekStart(now);
  const lastWeekStart = weekStart - 7 * DAY_IN_MS;
  const monthStart = toMonthStart(now);

  const today: LocalChatSession[] = [];
  const yesterday: LocalChatSession[] = [];
  const thisWeek: LocalChatSession[] = [];
  const lastWeek: LocalChatSession[] = [];
  const thisMonth: LocalChatSession[] = [];
  const olderByMonth = new Map<number, LocalChatSession[]>();

  for (const session of sessions) {
    const updatedAt = session.updatedAt;

    if (updatedAt >= todayStart) {
      today.push(session);
      continue;
    }

    if (updatedAt >= yesterdayStart) {
      yesterday.push(session);
      continue;
    }

    if (updatedAt >= weekStart) {
      thisWeek.push(session);
      continue;
    }

    if (updatedAt >= lastWeekStart) {
      lastWeek.push(session);
      continue;
    }

    if (updatedAt >= monthStart) {
      thisMonth.push(session);
      continue;
    }

    const monthKey = toMonthStart(updatedAt);
    const existing = olderByMonth.get(monthKey);
    if (existing) {
      existing.push(session);
      continue;
    }
    olderByMonth.set(monthKey, [session]);
  }

  const sections: SessionSection[] = [];
  if (today.length > 0) {
    sections.push({ key: 'today', title: t('chat_section_today'), data: today });
  }
  if (yesterday.length > 0) {
    sections.push({ key: 'yesterday', title: t('chat_section_yesterday'), data: yesterday });
  }
  if (thisWeek.length > 0) {
    sections.push({ key: 'this-week', title: t('chat_section_this_week'), data: thisWeek });
  }
  if (lastWeek.length > 0) {
    sections.push({ key: 'last-week', title: t('chat_section_last_week'), data: lastWeek });
  }
  if (thisMonth.length > 0) {
    sections.push({ key: 'this-month', title: t('chat_section_this_month'), data: thisMonth });
  }

  const olderSections = Array.from(olderByMonth.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([monthKey, data]) => ({
      key: `month:${monthKey}`,
      title: formatMonthTitle(monthKey),
      data,
    }));

  return [...sections, ...olderSections];
}

const MessageAttachmentGallery = memo(function MessageAttachmentGallery(props: {
  messageId: string;
  attachments: ChatAttachmentPreview[];
}): JSX.Element | null {
  const { width } = useWindowDimensions();
  const themeMode = useThemeMode();
  const featureOverrides = useAppPreferencesStore((state) => state.featureOverrides);
  const carouselEnabled = useMemo(
    () => isExperimentalFeatureEnabled('chatImageCarousel', featureOverrides),
    [featureOverrides],
  );
  const imageAttachments = useMemo(
    () => props.attachments.filter((attachment) => attachment.type === 'image'),
    [props.attachments],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const pageWidth = Math.max(140, Math.min(width - 84, 220));

  useEffect(() => {
    setActiveIndex(0);
  }, [props.messageId]);

  if (imageAttachments.length === 0) {
    return null;
  }

  if (!carouselEnabled || imageAttachments.length === 1) {
    return (
      <View style={styles.messageAttachmentRow}>
        {imageAttachments.map((attachment, index) =>
          attachment.previewUri ? (
            <Image
              key={`${props.messageId}:img:${index}`}
              source={{ uri: attachment.previewUri }}
              style={styles.messageImage}
              resizeMode="cover"
            />
          ) : (
            <View key={`${props.messageId}:img:${index}`} style={styles.messageImagePlaceholder}>
              <Text style={styles.messageImagePlaceholderText}>Image</Text>
            </View>
          ),
        )}
      </View>
    );
  }

  return (
    <View style={styles.messageCarouselWrap}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.messageCarouselContent}
        onMomentumScrollEnd={(event) => {
          const nextIndex = Math.round(event.nativeEvent.contentOffset.x / Math.max(pageWidth, 1));
          setActiveIndex(Math.max(0, Math.min(imageAttachments.length - 1, nextIndex)));
        }}
      >
        {imageAttachments.map((attachment, index) => (
          <View
            key={`${props.messageId}:carousel:${index}`}
            style={[styles.messageCarouselPage, { width: pageWidth }]}
          >
            {attachment.previewUri ? (
              <Image
                source={{ uri: attachment.previewUri }}
                style={[
                  styles.messageCarouselImage,
                  {
                    width: pageWidth - 2,
                    borderColor: mapColorForMode('#1E293B', themeMode),
                  },
                ]}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.messageImagePlaceholder, { width: pageWidth - 2 }]}>
                <Text style={styles.messageImagePlaceholderText}>Image</Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
      <View style={styles.messageCarouselDots}>
        {imageAttachments.map((_, index) => (
          <View
            key={`${props.messageId}:dot:${index}`}
            style={[
              styles.messageCarouselDot,
              index === activeIndex && styles.messageCarouselDotActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
});

const MessageBubble = memo(function MessageBubble(props: {
  message: LocalChatMessage;
  onRetry: (messageId: string, sessionId: string) => void;
  highlighted?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const isUser = props.message.role === 'user';
  const themeMode = useThemeMode();
  const accentColor = useAccentColor();
  const usePlainText =
    isUser ||
    (props.message.role === 'assistant' &&
      (props.message.syncStatus === 'streaming' || props.message.syncStatus === 'failed'));
  const featureOverrides = useAppPreferencesStore((state) => state.featureOverrides);
  const reasoningTimelineEnabled = useMemo(
    () => isExperimentalFeatureEnabled('reasoningTimeline', featureOverrides),
    [featureOverrides],
  );
  const bubbleSurfaceStyle = useMemo(
    () =>
      isUser
        ? {
            backgroundColor: themeMode === 'light' ? withAlpha(accentColor, '12') : withAlpha(accentColor, '2A'),
            borderColor: themeMode === 'light' ? withAlpha(accentColor, '26') : withAlpha(accentColor, '3D'),
          }
        : {
            backgroundColor: themeMode === 'light' ? 'rgba(255,255,255,0.76)' : 'rgba(8,15,28,0.72)',
            borderColor: themeMode === 'light' ? 'rgba(78,100,113,0.14)' : 'rgba(202,255,245,0.14)',
          },
    [accentColor, isUser, themeMode],
  );
  const bubbleTextColor = isUser
    ? themeMode === 'light'
      ? '#17323C'
      : '#F8FAFC'
    : themeMode === 'light'
      ? '#213C47'
      : '#E2E8F0';
  const metaTextColor = themeMode === 'light' ? '#5C7480' : '#9CC4BD';
  const usageTextColor = themeMode === 'light' ? '#45616E' : '#A9DDD1';
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const timelineSteps = props.message.toolTimeline ?? [];
  const hasTimeline = reasoningTimelineEnabled && props.message.role === 'assistant' && timelineSteps.length > 0;
  const usageSummary = useMemo(() => {
    const usage = props.message.usage;
    if (!usage) {
      return '';
    }

    const parts: string[] = [];
    if (usage.totalTokens > 0) {
      parts.push(`tok ${formatCompactTokenCount(usage.totalTokens)}`);
    }

    if (typeof usage.contextTokens === 'number' && usage.contextTokens > 0) {
      const contextPart =
        typeof usage.contextLimit === 'number' && usage.contextLimit > 0
          ? `ctx ${formatCompactTokenCount(usage.contextTokens)}/${formatCompactTokenCount(usage.contextLimit)}`
          : `ctx ${formatCompactTokenCount(usage.contextTokens)}`;
      parts.push(contextPart);
    }

    return parts.join(' · ');
  }, [props.message.usage]);
  const markdownStyles = useMemo(
    () =>
      ({
        body: {
          color: bubbleTextColor,
          fontSize: 16,
          lineHeight: 22,
        },
        code_block: {
          backgroundColor: mapColorForMode('#020617', themeMode),
          borderColor: mapColorForMode('#1E293B', themeMode),
          borderWidth: 1,
          borderRadius: 8,
          padding: 0,
          color: mapColorForMode('#93C5FD', themeMode),
        },
        fence: {
          backgroundColor: mapColorForMode('#020617', themeMode),
          borderColor: mapColorForMode('#1E293B', themeMode),
          borderWidth: 1,
          borderRadius: 8,
          padding: 0,
          color: mapColorForMode('#93C5FD', themeMode),
        },
      }) as const,
    [bubbleTextColor, themeMode],
  );
  const renderCodeBlock = useCallback(
    (node: ASTNode & { sourceInfo?: string }): JSX.Element => {
      const rawContent =
        (typeof node.content === 'string' && node.content) ||
        (Array.isArray(node.children)
          ? node.children
              .map((child) => (typeof child === 'object' && child && 'content' in child
                ? String((child as { content?: unknown }).content ?? '')
                : ''))
              .join('')
          : '');
      const sourceInfo = typeof node.sourceInfo === 'string' ? node.sourceInfo : '';
      const language = resolveLanguageFromFence(sourceInfo);
      const lines = rawContent.replace(/\n$/, '').split('\n');

      return (
        <View style={styles.syntaxBlock}>
          {!!sourceInfo && <Text style={styles.syntaxLanguage}>{language}</Text>}
          {lines.map((line, lineIndex) => (
            <Text key={`${props.message.id}:code:${lineIndex}`} style={styles.syntaxLine}>
              {tokenizeCodeLine(line, language).map((token, tokenIndex) => (
                <Text
                  key={`${props.message.id}:code:${lineIndex}:${tokenIndex}`}
                  style={
                    token.type === 'comment'
                      ? styles.syntaxComment
                      : token.type === 'string'
                        ? styles.syntaxString
                        : token.type === 'number'
                          ? styles.syntaxNumber
                          : token.type === 'keyword'
                            ? styles.syntaxKeyword
                            : styles.syntaxPlain
                  }
                >
                  {token.text}
                </Text>
              ))}
            </Text>
          ))}
        </View>
      );
    },
    [props.message.id],
  );
  const markdownRules = useMemo<RenderRules>(
    () => ({
      fence: (node) => renderCodeBlock(node),
      code_block: (node) => renderCodeBlock(node),
    }),
    [renderCodeBlock],
  );
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideIn = useRef(new Animated.Value(6)).current;
  const syncStatusLabel = props.message.syncStatus === 'synced' ? null : formatSyncStatusLabel(props.message.syncStatus, t);
  const timeLabel = new Date(props.message.timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(slideIn, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeIn, slideIn]);

  return (
    <Animated.View
      style={{
        opacity: fadeIn,
        transform: [{ translateY: slideIn }],
      }}
    >
      <View style={[styles.messageGroup, isUser ? styles.messageGroupUser : styles.messageGroupAssistant]}>
        <LiquidGlassPanel
          style={[
            styles.messageBubble,
            isUser ? styles.messageBubbleUser : styles.messageBubbleAssistant,
            bubbleSurfaceStyle,
            props.highlighted && styles.messageBubbleHighlighted,
          ]}
        >
          {usePlainText ? (
            <Text style={[styles.messagePlainText, { color: bubbleTextColor }]}>{props.message.content || '...'}</Text>
          ) : (
            <Markdown style={markdownStyles} rules={markdownRules}>
              {props.message.content || '...'}
            </Markdown>
          )}

      {hasTimeline && (
        <View style={styles.timelinePanel}>
          <Pressable
            style={styles.timelineHeader}
                onPress={() => {
                  setTimelineExpanded((current) => !current);
                }}
          >
            <View style={styles.timelineHeaderCopy}>
              <Text style={styles.timelineTitle}>
                {timelineExpanded ? '▾' : '▸'} Reasoning & Tools ({timelineSteps.length})
              </Text>
              {!!usageSummary && <Text style={styles.timelineUsage}>{usageSummary}</Text>}
            </View>
          </Pressable>

          {timelineExpanded && (
            <View style={styles.timelineList}>
              {timelineSteps.map((step, index) => (
                <View key={step.id} style={styles.timelineItem}>
                  <Text style={styles.timelineLine}>
                    {index === timelineSteps.length - 1 ? '└' : '├'} {timelineIconByKind(step.kind)} {step.label}{' '}
                    {(Math.max(step.durationMs, 0) / 1000).toFixed(1)}s
                  </Text>
                  {!!step.details && <Text style={styles.timelineDetails}>{step.details}</Text>}
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {!!props.message.attachments?.length && (
        <MessageAttachmentGallery messageId={props.message.id} attachments={props.message.attachments} />
      )}
        </LiquidGlassPanel>

        <View style={[styles.messageMetaRow, isUser ? styles.messageMetaRowUser : styles.messageMetaRowAssistant]}>
          {!!usageSummary && !isUser && <Text style={[styles.messageUsageMeta, { color: usageTextColor }]}>{usageSummary}</Text>}
          <Text style={[styles.messageMetaText, { color: metaTextColor }]}>
            {syncStatusLabel ? `${timeLabel} · ${syncStatusLabel}` : timeLabel}
          </Text>

          {props.message.syncStatus === 'failed' && props.message.role === 'user' && (
            <Pressable
              style={styles.retryButton}
              onPress={() => {
                props.onRetry(props.message.id, props.message.sessionId);
              }}
            >
              <Text style={styles.retryText}>{t('chat_retry')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Animated.View>
  );
});

const ChatHeader = memo(function ChatHeader(props: {
  pendingQueueLength: number;
  isStreaming: boolean;
  tokenCount: number;
  estimatedCostLabel: string;
  contextTokens: number;
  contextLimit: number;
  agentsLoading: boolean;
  agents: AgentOption[];
  activeAgentId: string | null;
  modelOptions: ModelOption[];
  selectedModel: string | null;
  selectedReasoningEffort: ReasoningEffort;
  onSelectAgent: (agentId: string) => void;
  onSelectDirectSessionMode: () => void;
  onSelectModel: (model: string | null) => void;
  onSelectReasoningEffort: (value: ReasoningEffort) => void;
  onCreateSession: () => void;
  onOpenSearch: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const themeMode = useThemeMode();
  const accentColor = useAccentColor();
  const searchIconColor = mapColorForMode('#E2E8F0', themeMode);
  const currentModeLabel = props.activeAgentId
    ? props.agents.find((item) => item.id === props.activeAgentId)?.name ?? props.activeAgentId
    : t('chat_mode_session_direct');
  const selectedModelMeta = props.selectedModel
    ? props.modelOptions.find((item) => item.id === props.selectedModel)
    : null;
  const contextPercent = Math.max(0, Math.min(100, Math.round((props.contextTokens / Math.max(props.contextLimit, 1)) * 100)));
  const contextWarning = contextPercent >= 85;
  const headerSurfaceStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? 'rgba(255,255,255,0.84)' : 'rgba(8,15,28,0.78)',
      borderColor: themeMode === 'light' ? 'rgba(78,100,113,0.14)' : 'rgba(202,255,245,0.14)',
    }),
    [themeMode],
  );
  const railSurfaceStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? 'rgba(255,255,255,0.7)' : 'rgba(8,15,28,0.64)',
      borderColor: themeMode === 'light' ? 'rgba(78,100,113,0.12)' : 'rgba(202,255,245,0.12)',
    }),
    [themeMode],
  );
  const chipStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? 'rgba(255,255,255,0.68)' : 'rgba(255,255,255,0.06)',
      borderColor: themeMode === 'light' ? 'rgba(78,100,113,0.14)' : 'rgba(202,255,245,0.12)',
    }),
    [themeMode],
  );
  const chipSelectedStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? withAlpha(accentColor, '14') : withAlpha(accentColor, '2B'),
      borderColor: themeMode === 'light' ? withAlpha(accentColor, '2B') : withAlpha(accentColor, '42'),
    }),
    [accentColor, themeMode],
  );
  const chipTextStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? '#264653' : '#E2E8F0',
    }),
    [themeMode],
  );
  const chipTextSelectedStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? accentColor : '#F8FAFC',
    }),
    [accentColor, themeMode],
  );
  const statusPillStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.06)',
      borderColor: themeMode === 'light' ? 'rgba(78,100,113,0.12)' : 'rgba(202,255,245,0.1)',
    }),
    [themeMode],
  );
  const statusWarningStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? 'rgba(194,62,87,0.08)' : 'rgba(255,142,162,0.12)',
      borderColor: themeMode === 'light' ? 'rgba(194,62,87,0.18)' : 'rgba(255,142,162,0.18)',
    }),
    [themeMode],
  );
  const statusTextStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? '#45616E' : '#A9DDD1',
    }),
    [themeMode],
  );
  const statusWarningTextStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? '#B23A48' : '#FF8EA2',
    }),
    [themeMode],
  );

  return (
    <View style={styles.headerStack}>
      <LiquidGlassPanel style={[styles.headerCard, headerSurfaceStyle]}>
        <View style={styles.headerTopRow}>
          <Text style={styles.title}>{t('chat_title')}</Text>
          <Pressable
            style={[styles.iconGlassButton, chipStyle]}
            onPress={props.onOpenSearch}
            accessibilityLabel={t('chat_search_open')}
          >
            <Ionicons name="search-outline" size={16} color={searchIconColor} />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusRail}>
          <View style={[styles.statusPill, statusPillStyle]}>
            <Text style={[styles.statusPillText, statusTextStyle]}>
              {props.isStreaming
                ? `${t('chat_pending_queue')}: ${props.pendingQueueLength} · ${t('chat_streaming')}`
                : `${t('chat_pending_queue')}: ${props.pendingQueueLength}`}
            </Text>
          </View>
          <View style={[styles.statusPill, statusPillStyle]}>
            <Text style={[styles.statusPillText, statusTextStyle]}>
              {`${formatCompactTokenCount(props.tokenCount)} ${t('chat_tokens_label')} · ${props.estimatedCostLabel}`}
            </Text>
          </View>
          <View style={[styles.statusPill, contextWarning ? statusWarningStyle : statusPillStyle]}>
            <Text style={[styles.statusPillText, contextWarning ? statusWarningTextStyle : statusTextStyle]}>
              {`ctx ${formatCompactTokenCount(props.contextTokens)}/${formatCompactTokenCount(props.contextLimit)} (${contextPercent}%)`}
            </Text>
          </View>
          <View style={[styles.statusPill, statusPillStyle]}>
            <Text style={[styles.statusPillText, statusTextStyle]}>
              {`${t('chat_mode')}: ${currentModeLabel}`}
            </Text>
          </View>
        </ScrollView>
      </LiquidGlassPanel>

      <LiquidGlassPanel style={[styles.controlRailShell, railSurfaceStyle]}>
        {props.agentsLoading ? (
          <View style={styles.controlRailLoading}>
            <ActivityIndicator color={adaptiveColor('#38BDF8')} />
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.controlRailContent}>
            <Pressable
              style={[styles.controlChip, chipStyle, !props.activeAgentId && chipSelectedStyle]}
              onPress={props.onSelectDirectSessionMode}
            >
              <Text style={[styles.controlChipText, chipTextStyle, !props.activeAgentId && chipTextSelectedStyle]}>
                {t('chat_session_chip')}
              </Text>
            </Pressable>

            {props.agents.map((item) => {
              const selected = item.id === props.activeAgentId;
              return (
                <Pressable
                  key={item.id}
                  style={[styles.controlChip, chipStyle, selected && chipSelectedStyle]}
                  onPress={() => {
                    props.onSelectAgent(item.id);
                  }}
                >
                  <Text style={[styles.controlChipText, chipTextStyle, selected && chipTextSelectedStyle]}>
                    {item.name}
                  </Text>
                </Pressable>
              );
            })}

            <Pressable style={[styles.controlChip, styles.newSessionChip, chipStyle]} onPress={props.onCreateSession}>
              <Text style={[styles.controlChipText, chipTextStyle]}>{t('chat_new_session')}</Text>
            </Pressable>
          </ScrollView>
        )}
      </LiquidGlassPanel>

      <LiquidGlassPanel style={[styles.controlRailShell, railSurfaceStyle]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.controlRailContent}>
          <Text style={styles.controlRailLabel}>{t('chat_model_label')}</Text>
          <Pressable
            style={[styles.controlChip, chipStyle, !props.selectedModel && chipSelectedStyle]}
            onPress={() => {
              props.onSelectModel(null);
            }}
          >
            <Text style={[styles.controlChipText, chipTextStyle, !props.selectedModel && chipTextSelectedStyle]}>
              {t('chat_gateway_default')}
            </Text>
          </Pressable>

          {props.modelOptions.map((item) => {
            const selected = item.id === props.selectedModel;
            return (
              <Pressable
                key={item.id}
                style={[styles.controlChip, chipStyle, selected && chipSelectedStyle]}
                onPress={() => {
                  props.onSelectModel(item.id);
                }}
              >
                <Text style={[styles.controlChipText, chipTextStyle, selected && chipTextSelectedStyle]}>{item.label}</Text>
              </Pressable>
            );
          })}

          {(selectedModelMeta?.supportsReasoning ?? false) &&
            (['minimal', 'low', 'medium', 'high'] as ReasoningEffort[]).map((effort) => {
              const selected = effort === props.selectedReasoningEffort;
              return (
                <Pressable
                  key={effort}
                  style={[styles.controlChip, chipStyle, selected && chipSelectedStyle]}
                  onPress={() => {
                    props.onSelectReasoningEffort(effort);
                  }}
                >
                  <Text style={[styles.controlChipText, chipTextStyle, selected && chipTextSelectedStyle]}>
                    {t('chat_reasoning_prefix')} {effort}
                  </Text>
                </Pressable>
              );
            })}
        </ScrollView>
      </LiquidGlassPanel>
    </View>
  );
});

const ChatSessionPanel = memo(function ChatSessionPanel(props: {
  mode?: 'sidebar' | 'modal';
  sessionCount: number;
  sessionSections: SessionSection[];
  currentSessionId: string | null;
  sessionStats: Record<string, SessionStats>;
  activeAgentId: string | null;
  onSelectSession: (sessionId: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const isModal = props.mode === 'modal';

  return (
    <View style={[styles.sessionPanel, !isModal && styles.sessionPanelTablet, isModal && styles.sessionPanelModal]}>
      <View style={styles.sessionPanelHeader}>
        <Text style={styles.sessionPanelTitle}>
          {t('chat_conversations')} ({props.sessionCount})
        </Text>
      </View>

      <SectionList
        sections={props.sessionSections}
        keyExtractor={(item) => item.id}
        style={[styles.sessionSectionList, isModal && styles.sessionSectionListModal]}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sessionSectionHeader}>
            {sectionTitleByKey(section.key, section.title, t)} ({section.data.length})
          </Text>
        )}
        renderItem={({ item }) => {
          const selected = item.id === props.currentSessionId;
          const stats = props.sessionStats[item.id];
          const messageCount = stats?.messageCount ?? 0;
          const imageCount = stats?.imageCount ?? 0;
          return (
            <Pressable
              style={[styles.sessionItem, selected && styles.sessionItemSelected]}
              onPress={() => {
                props.onSelectSession(item.id);
              }}
            >
              <Text style={[styles.sessionItemText, selected && styles.sessionItemTextSelected]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.sessionItemMeta} numberOfLines={1}>
                {new Date(item.updatedAt).toLocaleTimeString()} · {messageCount} {t('chat_messages_short')}
                {imageCount > 0 ? ` · ${imageCount} ${t('chat_images_short')}` : ''}
              </Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.sessionEmpty}>
            {props.activeAgentId ? t('chat_no_sessions_for_agent') : t('chat_no_sessions_yet')}
          </Text>
        }
      />
    </View>
  );
});

const ChatMessageList = memo(function ChatMessageList(props: {
  sessionId: string | null;
  messages: LocalChatMessage[];
  onRetryMessage: (messageId: string, sessionId: string) => void;
  highlightedMessageId: string | null;
}): JSX.Element {
  const { t } = useI18n();
  const listRef = useRef<FlatList<LocalChatMessage>>(null);
  const shouldStickToBottomRef = useRef(true);
  const didInitialScrollRef = useRef(false);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    didInitialScrollRef.current = false;
  }, [props.sessionId]);

  useEffect(() => {
    if (!props.messages.length) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: false });
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [props.sessionId, props.messages.length]);

  const renderMessageItem = useCallback(
    ({ item }: { item: LocalChatMessage }) => (
      <MessageBubble
        message={item}
        onRetry={props.onRetryMessage}
        highlighted={props.highlightedMessageId === item.id}
      />
    ),
    [props.highlightedMessageId, props.onRetryMessage],
  );

  useEffect(() => {
    if (!props.highlightedMessageId) {
      return;
    }

    const index = props.messages.findIndex((item) => item.id === props.highlightedMessageId);
    if (index < 0) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        animated: true,
        index,
      });
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [props.highlightedMessageId, props.messages]);

  return (
    <FlatList
      ref={listRef}
      data={props.messages}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.messagesList}
      removeClippedSubviews
      initialNumToRender={20}
      maxToRenderPerBatch={20}
      windowSize={7}
      showsVerticalScrollIndicator={false}
      onLayout={() => {
        if (didInitialScrollRef.current) {
          return;
        }
        didInitialScrollRef.current = true;
        requestAnimationFrame(() => {
          listRef.current?.scrollToEnd({ animated: false });
        });
      }}
      onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        const distanceToBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
        shouldStickToBottomRef.current = distanceToBottom < 56;
      }}
      scrollEventThrottle={16}
      onContentSizeChange={() => {
        if (shouldStickToBottomRef.current) {
          listRef.current?.scrollToEnd({ animated: false });
        }
      }}
      renderItem={renderMessageItem}
      onScrollToIndexFailed={(event) => {
        const targetOffset = Math.max(event.averageItemLength * event.index - 40, 0);
        listRef.current?.scrollToOffset({
          offset: targetOffset,
          animated: true,
        });
      }}
      ListEmptyComponent={
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>{t('chat_start_message_hint')}</Text>
        </View>
      }
    />
  );
});

const ChatComposer = memo(function ChatComposer(props: {
  currentSessionId: string | null;
  onClearContext: (sessionId: string) => void;
  onExportMarkdown: () => void;
  onExportJson: () => void;
  onOpenQuickTemplates: () => void;
  runbooks: ChatRunbook[];
  onApplyRunbook: (runbook: ChatRunbook) => void;
  exportBusy: boolean;
  composerAttachments: ComposerAttachment[];
  onRemoveAttachment: (index: number) => void;
  voiceStatusText: string | null;
  onPickImage: () => void;
  isRecording: boolean;
  voiceBusy: boolean;
  recordingSeconds: number;
  onVoice: () => void;
  draft: string;
  onChangeDraft: (text: string) => void;
  sendDisabled: boolean;
  isStreaming: boolean;
  onSend: () => void;
  bottomInset: number;
}): JSX.Element {
  const { t } = useI18n();
  const themeMode = useThemeMode();
  const accentColor = useAccentColor();
  const iconColor = mapColorForMode('#CBD5E1', themeMode);
  const recordingColor = mapColorForMode('#FCA5A5', themeMode);
  const composerSurfaceStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? 'rgba(255,255,255,0.84)' : 'rgba(8,15,28,0.78)',
      borderColor: themeMode === 'light' ? 'rgba(78,100,113,0.14)' : 'rgba(202,255,245,0.14)',
    }),
    [themeMode],
  );
  const controlSurfaceStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? 'rgba(255,255,255,0.68)' : 'rgba(255,255,255,0.06)',
      borderColor: themeMode === 'light' ? 'rgba(78,100,113,0.14)' : 'rgba(202,255,245,0.12)',
    }),
    [themeMode],
  );
  const sendSurfaceStyle = useMemo(
    () => ({
      backgroundColor: themeMode === 'light' ? withAlpha(accentColor, '16') : withAlpha(accentColor, '30'),
      borderColor: themeMode === 'light' ? withAlpha(accentColor, '2D') : withAlpha(accentColor, '44'),
    }),
    [accentColor, themeMode],
  );
  const controlTextStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? '#264653' : '#E2E8F0',
    }),
    [themeMode],
  );
  const sendTextStyle = useMemo(
    () => ({
      color: themeMode === 'light' ? accentColor : '#F8FAFC',
    }),
    [accentColor, themeMode],
  );
  const quickTemplatePressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRunbooks = props.runbooks.slice(0, 4);

  const clearQuickTemplatePressTimer = useCallback((): void => {
    if (quickTemplatePressTimerRef.current) {
      clearTimeout(quickTemplatePressTimerRef.current);
      quickTemplatePressTimerRef.current = null;
    }
  }, []);

  const handleInputPressIn = useCallback((): void => {
    clearQuickTemplatePressTimer();
    quickTemplatePressTimerRef.current = setTimeout(() => {
      quickTemplatePressTimerRef.current = null;
      props.onOpenQuickTemplates();
    }, 420);
  }, [clearQuickTemplatePressTimer, props.onOpenQuickTemplates]);

  useEffect(() => clearQuickTemplatePressTimer, [clearQuickTemplatePressTimer]);

  const renderComposerAttachment = useCallback(
    ({ item, index }: { item: ComposerAttachment; index: number }) => (
      <View style={styles.attachmentItem}>
        {!!item.preview.previewUri && (
          <Image source={{ uri: item.preview.previewUri }} style={styles.attachmentImage} resizeMode="cover" />
        )}
        <Pressable
          style={styles.attachmentRemove}
          onPress={() => {
            props.onRemoveAttachment(index);
          }}
        >
          <Text style={styles.attachmentRemoveText}>X</Text>
        </Pressable>
      </View>
    ),
    [props.onRemoveAttachment],
  );

  return (
    <View style={[styles.footer, { paddingBottom: props.bottomInset }]}>
      <LiquidGlassPanel style={[styles.composerShell, composerSurfaceStyle]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.composerActionRow}>
          <Pressable
            style={[styles.contextButton, controlSurfaceStyle]}
            onPress={props.onOpenQuickTemplates}
            accessibilityRole="button"
            accessibilityLabel={t('chat_templates_title')}
          >
            <Text style={[styles.contextButtonText, controlTextStyle]}>{t('chat_templates_title')}</Text>
          </Pressable>
          <Pressable
            style={[
              styles.contextButton,
              controlSurfaceStyle,
              !props.currentSessionId && styles.contextButtonDisabled,
            ]}
            disabled={!props.currentSessionId}
            onPress={() => {
              if (props.currentSessionId) {
                props.onClearContext(props.currentSessionId);
              }
            }}
          >
            <Text style={[styles.contextButtonText, controlTextStyle]}>{t('chat_clear_context')}</Text>
          </Pressable>
          <Pressable
            style={[
              styles.contextButton,
              controlSurfaceStyle,
              (!props.currentSessionId || props.exportBusy) && styles.contextButtonDisabled,
            ]}
            onPress={props.onExportMarkdown}
            disabled={!props.currentSessionId || props.exportBusy}
          >
            <Text style={[styles.contextButtonText, controlTextStyle]}>{t('chat_export_markdown')}</Text>
          </Pressable>
          <Pressable
            style={[
              styles.contextButton,
              controlSurfaceStyle,
              (!props.currentSessionId || props.exportBusy) && styles.contextButtonDisabled,
            ]}
            onPress={props.onExportJson}
            disabled={!props.currentSessionId || props.exportBusy}
          >
            <Text style={[styles.contextButtonText, controlTextStyle]}>{t('chat_export_json')}</Text>
          </Pressable>
        </ScrollView>

        {visibleRunbooks.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.composerRunbookRow}>
            {visibleRunbooks.map((runbook) => (
              <Pressable
                key={runbook.id}
                style={[styles.runbookChip, controlSurfaceStyle]}
                onPress={() => {
                  props.onApplyRunbook(runbook);
                }}
                accessibilityRole="button"
                accessibilityLabel={runbook.label}
              >
                <Text style={[styles.runbookChipText, controlTextStyle]} numberOfLines={1}>
                  {runbook.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.runbookChip, controlSurfaceStyle]}
              onPress={props.onOpenQuickTemplates}
              accessibilityRole="button"
              accessibilityLabel={t('common_show')}
            >
              <Text style={[styles.runbookChipText, controlTextStyle]}>{t('common_show')}</Text>
            </Pressable>
          </ScrollView>
        )}

        {props.composerAttachments.length > 0 && (
          <FlatList
            horizontal
            data={props.composerAttachments}
            keyExtractor={(_, index) => `composer:${index}`}
            style={styles.attachmentList}
            contentContainerStyle={styles.attachmentListContent}
            showsHorizontalScrollIndicator={false}
            renderItem={renderComposerAttachment}
          />
        )}

        {!!props.voiceStatusText && <Text style={[styles.voiceStatusText, controlTextStyle]}>{props.voiceStatusText}</Text>}

        <View style={styles.inputRow}>
          <Pressable
            style={[styles.sideButton, controlSurfaceStyle]}
            onPress={props.onPickImage}
            accessibilityLabel={t('chat_add_image_title')}
          >
            <Ionicons name="image-outline" size={18} color={iconColor} />
          </Pressable>

          <Pressable
            style={[
              styles.sideButton,
              controlSurfaceStyle,
              props.isRecording && styles.sideButtonRecording,
              props.voiceBusy && styles.sideButtonDisabled,
            ]}
            disabled={props.voiceBusy}
            onPress={props.onVoice}
            accessibilityLabel={t('chat_voice_setup_title')}
          >
            <Ionicons
              name={props.isRecording ? 'stop-circle-outline' : props.voiceBusy ? 'hourglass-outline' : 'mic-outline'}
              size={18}
              color={props.isRecording ? recordingColor : iconColor}
            />
          </Pressable>

          <TextInput
            value={props.draft}
            onChangeText={props.onChangeDraft}
            placeholder={t('chat_type_message')}
            placeholderTextColor={themeMode === 'light' ? '#607781' : '#64748B'}
            style={[styles.input, controlSurfaceStyle]}
            multiline
            maxLength={8000}
            onPressIn={handleInputPressIn}
            onPressOut={clearQuickTemplatePressTimer}
            onResponderRelease={clearQuickTemplatePressTimer}
            onResponderTerminate={clearQuickTemplatePressTimer}
            accessibilityLabel={t('chat_type_message')}
          />
          <Pressable
            style={[styles.sendButton, sendSurfaceStyle, props.sendDisabled && styles.sendButtonDisabled]}
            onPress={props.onSend}
            disabled={props.sendDisabled}
          >
            <Text style={[styles.sendButtonText, sendTextStyle]}>{props.isStreaming ? '...' : t('chat_send')}</Text>
          </Pressable>
        </View>
      </LiquidGlassPanel>
    </View>
  );
});

export function ChatScreen(): JSX.Element {
  const { t, language } = useI18n();
  const themeMode = useThemeMode();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isTabletLayout = width >= 900;
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [gatewayModels, setGatewayModels] = useState<ModelOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sessionPickerVisible, setSessionPickerVisible] = useState(false);
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceHintShown, setVoiceHintShown] = useState(false);
  const [inlineNotice, setInlineNotice] = useState<InlineNotice | null>(null);
  const [imagePickerSheetVisible, setImagePickerSheetVisible] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedReasoningEffort, setSelectedReasoningEffort] =
    useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<'current' | 'all'>('current');
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [quickTemplateVisible, setQuickTemplateVisible] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connectionStatus = useConnectionStore((state) => state.connectionStatus);
  const activeProfileId = useConnectionStore((state) => state.activeProfileId);
  const customRunbooks = useChatRunbookStore((state) => state.customRunbooks);
  const saveRunbook = useChatRunbookStore((state) => state.saveRunbook);
  const removeRunbook = useChatRunbookStore((state) => state.removeRunbook);

  const {
    activeAgentId,
    activeSessionId,
    sessions,
    messagesBySession,
    pendingQueue,
    isStreaming,
    lastError,
    setActiveAgent,
    setActiveSession,
    ensureSessionMessagesLoaded,
    createSession,
    mergeGatewaySessions,
    sendMessage,
    retryFailedMessage,
    syncSession,
    flushPendingQueue,
    clearContext,
  } = useChatStore(
    useShallow((state) => ({
      activeAgentId: state.activeAgentId,
      activeSessionId: state.activeSessionId,
      sessions: state.sessions,
      messagesBySession: state.messagesBySession,
      pendingQueue: state.pendingQueue,
      isStreaming: state.isStreaming,
      lastError: state.lastError,
      setActiveAgent: state.setActiveAgent,
      setActiveSession: state.setActiveSession,
      ensureSessionMessagesLoaded: state.ensureSessionMessagesLoaded,
      createSession: state.createSession,
      mergeGatewaySessions: state.mergeGatewaySessions,
      sendMessage: state.sendMessage,
      retryFailedMessage: state.retryFailedMessage,
      syncSession: state.syncSession,
      flushPendingQueue: state.flushPendingQueue,
      clearContext: state.clearContext,
    })),
  );

  const sessionList = useMemo(() => {
    return Object.values(sessions)
      .filter((session) => !activeAgentId || session.agentId === activeAgentId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [activeAgentId, sessions]);

  const modelOptions = useMemo<ModelOption[]>(() => {
    const map = new Map<string, ModelOption>();

    for (const model of gatewayModels) {
      if (isLegacyAliasModel(model.label)) {
        continue;
      }
      map.set(model.id, model);
    }

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [gatewayModels]);

  const sessionSections = useMemo(() => groupSessionsByRecency(sessionList, t), [sessionList, t]);

  const sessionStats = useMemo<Record<string, SessionStats>>(() => {
    if (sessionList.length === 0) {
      return {};
    }

    return Object.fromEntries(
      sessionList.map((session) => {
        const messages = messagesBySession[session.id] ?? [];
        let imageCount = 0;

        for (const message of messages) {
          if (!message.attachments?.length) {
            continue;
          }

          for (const item of message.attachments) {
            if (item.type === 'image') {
              imageCount += 1;
            }
          }
        }

        return [
          session.id,
          {
            messageCount: messages.length,
            imageCount,
          },
        ];
      }),
    ) as Record<string, SessionStats>;
  }, [messagesBySession, sessionList]);

  const currentSessionId = useMemo(() => {
    if (activeSessionId && sessionList.some((session) => session.id === activeSessionId)) {
      return activeSessionId;
    }
    return sessionList[0]?.id ?? null;
  }, [activeSessionId, sessionList]);

  const messages = useMemo(() => {
    if (!currentSessionId) {
      return [];
    }

    return messagesBySession[currentSessionId] ?? [];
  }, [currentSessionId, messagesBySession]);

  const currentSession = useMemo(
    () => (currentSessionId ? sessions[currentSessionId] ?? null : null),
    [currentSessionId, sessions],
  );
  const pricingCurrency = usePricingStore((state) => state.currency);

  const currentSessionTokens = currentSession?.totalTokens ?? 0;
  const currentSessionCost = currentSession?.estimatedCost ?? 0;
  const currentSessionCostLabel = useMemo(
    () => formatCurrencyAmount(currentSessionCost, pricingCurrency, language),
    [currentSessionCost, language, pricingCurrency],
  );
  const currentSessionContextTokens = currentSession?.contextCount ?? currentSessionTokens;
  const currentContextLimit = useMemo(() => {
    const modelLimit = selectedModel
      ? modelOptions.find((item) => item.id === selectedModel)?.contextWindow
      : undefined;
    const fallbackModel = currentSession?.model;
    return modelLimit ?? estimateContextLimit(fallbackModel ?? selectedModel);
  }, [currentSession?.model, modelOptions, selectedModel]);
  const defaultRunbooks = useMemo<ChatRunbook[]>(
    () => [
      {
        id: 'system-check-logs',
        label: t('chat_runbook_default_check_logs_label'),
        text: t('chat_runbook_default_check_logs_body'),
        agentId: null,
        system: true,
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'system-restart-service',
        label: t('chat_runbook_default_restart_label'),
        text: t('chat_runbook_default_restart_body'),
        agentId: null,
        system: true,
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'system-analyze-cost',
        label: t('chat_runbook_default_cost_label'),
        text: t('chat_runbook_default_cost_body'),
        agentId: null,
        system: true,
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'system-queue-status',
        label: t('chat_runbook_default_queue_label'),
        text: t('chat_runbook_default_queue_body'),
        agentId: null,
        system: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    [t],
  );
  const visibleRunbooks = useMemo(
    () => [...resolveRunbooksForAgent(customRunbooks, activeAgentId), ...defaultRunbooks],
    [activeAgentId, customRunbooks, defaultRunbooks],
  );

  const searchResults = useMemo<MessageSearchResult[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return [];
    }

    const sessionIds = searchScope === 'current' && currentSessionId ? [currentSessionId] : Object.keys(messagesBySession);
    const results: MessageSearchResult[] = [];

    for (const sessionId of sessionIds) {
      const source = messagesBySession[sessionId] ?? [];
      for (const message of source) {
        const content = message.content.trim();
        if (!content || !content.toLowerCase().includes(query)) {
          continue;
        }

        results.push({
          messageId: message.id,
          sessionId,
          sessionTitle: sessions[sessionId]?.title ?? sessionId,
          content: message.content,
          timestamp: message.timestamp,
        });
      }
    }

    return results;
  }, [currentSessionId, messagesBySession, searchQuery, searchScope, sessions]);

  useEffect(() => {
    if (!highlightedMessageId) {
      return;
    }

    const timer = setTimeout(() => {
      setHighlightedMessageId(null);
    }, 2800);

    return () => {
      clearTimeout(timer);
    };
  }, [highlightedMessageId]);

  const loadAgents = useCallback(async () => {
    if (!activeProfileId) {
      setAgents([]);
      setGatewayModels([]);
      return;
    }

    setAgentsLoading(true);
    try {
      const [agentsResult, modelsResult, sessionsResult] = await Promise.allSettled([
        getAgents(),
        getModels(),
        getSessionsSummary(),
      ]);

      if (agentsResult.status === 'fulfilled') {
        useAgentsRuntimeStore.getState().hydrateAgents(agentsResult.value.agents);
        setAgents(
          agentsResult.value.agents.map((item) => ({
            id: item.id,
            name: item.name,
            model: item.model,
          })),
        );
      } else {
        setAgents([]);
      }

      if (modelsResult.status === 'fulfilled') {
        setGatewayModels(
          modelsResult.value.models.map((item) => ({
            id: item.id,
            label: item.name ?? item.id,
            supportsReasoning: item.supportsReasoning ?? supportsReasoningByModel(item.id),
            contextWindow:
              typeof item.contextWindow === 'number' && Number.isFinite(item.contextWindow)
                ? item.contextWindow
                : typeof item.maxContextTokens === 'number' && Number.isFinite(item.maxContextTokens)
                  ? item.maxContextTokens
                  : undefined,
          })),
        );
      } else {
        setGatewayModels([]);
      }

      if (sessionsResult.status === 'fulfilled') {
        mergeGatewaySessions(
          sessionsResult.value.sessions.map((item) => {
            const parsedUpdatedAt = item.updatedAt ? Date.parse(item.updatedAt) : Number.NaN;
            return {
              id: item.id,
              title: item.title,
              agentId: item.agentId,
              model: item.model,
              updatedAt: Number.isNaN(parsedUpdatedAt) ? undefined : parsedUpdatedAt,
              messageCount: item.messageCount,
              contextCount: item.contextCount,
            };
          }),
        );
      }
    } catch {
      setAgents([]);
      setGatewayModels([]);
    } finally {
      setAgentsLoading(false);
    }
  }, [activeProfileId, mergeGatewaySessions]);

  useEffect(() => {
    void loadAgents();
  }, [activeProfileId, loadAgents]);

  useEffect(() => {
    if (!activeProfileId) {
      return;
    }

    void flushPendingQueue();

    if (currentSessionId) {
      void syncSession(currentSessionId);
    }
  }, [activeProfileId, connectionStatus, currentSessionId, flushPendingQueue, syncSession]);

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    setActiveSession(currentSessionId);
    ensureSessionMessagesLoaded(currentSessionId);
  }, [currentSessionId, ensureSessionMessagesLoaded, setActiveSession]);

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    const session = sessions[currentSessionId];
    if (!session) {
      return;
    }
    const modelFromSession = session.model ?? null;
    const modelValid = modelFromSession
      ? modelOptions.some((item) => item.id === modelFromSession)
      : true;
    const resolvedModel = modelValid ? modelFromSession : null;

    setSelectedModel(resolvedModel);
    setSelectedReasoningEffort(session.reasoningEffort ?? DEFAULT_REASONING_EFFORT);
  }, [currentSessionId, modelOptions, sessions]);

  useEffect(() => {
    if (!isTabletLayout && !sessionPickerVisible) {
      return;
    }

    for (const session of sessionList) {
      ensureSessionMessagesLoaded(session.id);
    }
  }, [ensureSessionMessagesLoaded, isTabletLayout, sessionList, sessionPickerVisible]);

  useEffect(() => {
    if (!isRecording) {
      setRecordingSeconds(0);
      return;
    }

    const startedAt = Date.now();
    const timer = setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [isRecording]);

  useEffect(() => {
    return () => {
      if (recorder.isRecording) {
        void recorder.stop().catch(() => undefined);
      }
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    };
  }, [recorder]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const showInlineNotice = useCallback((title: string, body: string, tone: InlineNotice['tone'] = 'info') => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }
    setInlineNotice({ title, body, tone });
    noticeTimerRef.current = setTimeout(() => {
      setInlineNotice(null);
      noticeTimerRef.current = null;
    }, 3400);
  }, []);

  const appendImageAssets = useCallback(async (assets: ImagePicker.ImagePickerAsset[]) => {
    const remainingSlots = MAX_ATTACHMENTS - composerAttachments.length;
    if (remainingSlots <= 0) {
      showInlineNotice(t('chat_error_attachment_limit_title'), t('chat_error_attachment_limit_body'), 'error');
      return;
    }

    const validItems: ComposerAttachment[] = [];
    let skippedLarge = 0;
    let skippedInvalid = 0;

    for (const asset of assets.slice(0, remainingSlots)) {
      let base64 = asset.base64;

      if (!base64 && asset.uri) {
        try {
          base64 = await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
        } catch {
          base64 = undefined;
        }
      }

      if (!base64 && asset.uri) {
        base64 = await uriToBase64ViaFileReader(asset.uri);
      }

      if (!base64) {
        skippedInvalid += 1;
        continue;
      }

      if (base64.length > MAX_IMAGE_BASE64_LENGTH) {
        skippedLarge += 1;
        continue;
      }

      const mimeType = asset.mimeType || 'image/jpeg';
      validItems.push({
        payload: {
          type: 'image',
          mimeType,
          base64,
          width: asset.width,
          height: asset.height,
          fileName: asset.fileName ?? undefined,
        },
        preview: {
          type: 'image',
          mimeType,
          previewUri: asset.uri,
          width: asset.width,
          height: asset.height,
        },
      });
    }

    if (!validItems.length) {
      showInlineNotice(t('chat_error_no_image_title'), t('chat_error_no_image_body'), 'error');
      return;
    }

    setComposerAttachments((prev) => [...prev, ...validItems].slice(0, MAX_ATTACHMENTS));

    if (skippedLarge > 0) {
      showInlineNotice(
        t('chat_error_no_image_title'),
        `${skippedLarge} · ${t('chat_error_image_skipped_large')}`,
        'info',
      );
    }
    if (skippedInvalid > 0) {
      showInlineNotice(
        t('chat_error_no_image_title'),
        `${skippedInvalid} · ${t('chat_error_image_skipped_unreadable')}`,
        'info',
      );
    }
  }, [composerAttachments.length, showInlineNotice, t]);

  const pickImagesFromLibrary = useCallback(async () => {
    const remainingSlots = MAX_ATTACHMENTS - composerAttachments.length;
    if (remainingSlots <= 0) {
      showInlineNotice(t('chat_error_attachment_limit_title'), t('chat_error_attachment_limit_body'), 'error');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showInlineNotice(t('chat_error_need_photos_title'), t('chat_error_need_photos_body'), 'error');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: remainingSlots,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      base64: true,
      quality: 0.35,
    });

    if (result.canceled) {
      return;
    }

    if (!result.assets.length) {
      showInlineNotice(t('chat_error_empty_library_title'), t('chat_error_empty_library_body'), 'error');
      return;
    }

    await appendImageAssets(result.assets);
  }, [appendImageAssets, composerAttachments.length, showInlineNotice, t]);

  const captureImage = useCallback(async () => {
    const remainingSlots = MAX_ATTACHMENTS - composerAttachments.length;
    if (remainingSlots <= 0) {
      showInlineNotice(t('chat_error_attachment_limit_title'), t('chat_error_attachment_limit_body'), 'error');
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      showInlineNotice(t('chat_error_need_camera_title'), t('chat_error_need_camera_body'), 'error');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      base64: true,
      quality: 0.35,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });

    if (result.canceled) {
      return;
    }

    await appendImageAssets(result.assets);
  }, [appendImageAssets, composerAttachments.length, showInlineNotice, t]);

  const handlePickImage = useCallback(() => {
    if (composerAttachments.length >= MAX_ATTACHMENTS) {
      showInlineNotice(t('chat_error_attachment_limit_title'), t('chat_error_attachment_limit_body'), 'error');
      return;
    }
    setImagePickerSheetVisible(true);
  }, [composerAttachments.length, showInlineNotice, t]);
  const handlePickImageFromCamera = useCallback(() => {
    setImagePickerSheetVisible(false);
    void captureImage();
  }, [captureImage]);
  const handlePickImageFromLibrary = useCallback(() => {
    setImagePickerSheetVisible(false);
    void pickImagesFromLibrary();
  }, [pickImagesFromLibrary]);

  const startRecording = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      showInlineNotice(t('chat_error_need_microphone_title'), t('chat_error_need_microphone_body'), 'error');
      return;
    }

    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      recorder.record();
      setRecordingSeconds(0);
      setIsRecording(true);
    } catch (error: unknown) {
      void setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
      showInlineNotice(
        t('chat_error_voice_title'),
        error instanceof Error ? error.message : t('chat_error_voice_unavailable'),
        'error',
      );
    }
  }, [recorder, showInlineNotice, t]);

  const stopRecording = useCallback(async () => {
    if (!recorder.isRecording) {
      return;
    }

    setVoiceBusy(true);

    try {
      await recorder.stop();
      const uri = recorder.uri;
      setIsRecording(false);

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      if (!uri) {
        return;
      }

      const transcript = await transcribeAudioUri(uri);
      setDraft((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('chat_error_voice_unavailable');
      const normalized = message.toLowerCase();
      const resolvedMessage =
        normalized.includes('http 404') || normalized.includes('not found')
          ? t('chat_error_voice_unavailable')
          : message;
      showInlineNotice(t('chat_error_voice_title'), resolvedMessage, 'error');
    } finally {
      void setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
      setVoiceBusy(false);
      setIsRecording(false);
      setRecordingSeconds(0);
    }
  }, [recorder, showInlineNotice, t]);

  const handleVoice = useCallback(async () => {
    if (voiceBusy) {
      return;
    }

    if (isRecording) {
      await stopRecording();
      return;
    }

    await startRecording();
  }, [isRecording, startRecording, stopRecording, voiceBusy]);

  const handleSend = useCallback(async () => {
    const rawContent = draft.trim();
    const mentionedAgent = parseMentionedAgent(rawContent, agents);
    const content = mentionedAgent
      ? rawContent.replace(/@[^\s]+\s*/, '').trim()
      : rawContent;
    if (!content && composerAttachments.length === 0) {
      return;
    }

    const effectiveAgentId =
      mentionedAgent?.id ??
      (currentSessionId ? sessions[currentSessionId]?.agentId : undefined) ??
      activeAgentId ??
      undefined;
    const resolvedAgentId = effectiveAgentId ?? undefined;
    const fallbackModel = resolvedAgentId ? agents.find((item) => item.id === resolvedAgentId)?.model : undefined;
    const gatewayModelIds = new Set(modelOptions.map((item) => item.id));
    const selectedModelResolved = selectedModel && gatewayModelIds.has(selectedModel) ? selectedModel : undefined;
    const fallbackModelResolved = fallbackModel && gatewayModelIds.has(fallbackModel) ? fallbackModel : undefined;
    const sessionModel = selectedModelResolved ?? fallbackModelResolved;
    const reasoningEffort = sessionModel && supportsReasoningByModel(sessionModel) ? selectedReasoningEffort : undefined;
    const targetSession =
      currentSessionId ??
      createSession(resolvedAgentId, content.slice(0, 30) || t('chat_new_session'), sessionModel, reasoningEffort);

    const attachments = composerAttachments.map((item) => item.payload);
    const previews = composerAttachments.map((item) => item.preview);

    setDraft('');
    setComposerAttachments([]);
    if (mentionedAgent?.id) {
      setActiveAgent(mentionedAgent.id);
    }

    await sendMessage({
      agentId: resolvedAgentId,
      sessionId: targetSession,
      content,
      model: sessionModel,
      reasoningEffort,
      attachments,
      attachmentPreviews: previews,
    });
  }, [
    activeAgentId,
    agents,
    composerAttachments,
    createSession,
    currentSessionId,
    draft,
    sendMessage,
    selectedModel,
    selectedReasoningEffort,
    modelOptions,
    sessions,
    setActiveAgent,
    t,
  ]);

  const sendDisabled = (!draft.trim() && composerAttachments.length === 0) || isStreaming || voiceBusy;
  const composerBottomInset = keyboardVisible
    ? Math.max(insets.bottom, 8)
    : Math.max(insets.bottom, 12);
  const handleSelectAgent = useCallback(
    (agentId: string) => {
      setActiveAgent(agentId);
      const agentModel = agents.find((item) => item.id === agentId)?.model ?? null;
      const modelValid = agentModel ? modelOptions.some((item) => item.id === agentModel) : false;
      setSelectedModel(modelValid ? agentModel : null);
      if (!agentModel || !supportsReasoningByModel(agentModel)) {
        setSelectedReasoningEffort(DEFAULT_REASONING_EFFORT);
      }
    },
    [agents, modelOptions, setActiveAgent],
  );
  const handleSelectDirectSessionMode = useCallback(() => {
    setActiveAgent(null);
  }, [setActiveAgent]);
  const handleSelectModel = useCallback((model: string | null) => {
    setSelectedModel(model);
    if (!model || !supportsReasoningByModel(model)) {
      setSelectedReasoningEffort(DEFAULT_REASONING_EFFORT);
    }
  }, []);
  const handleSelectReasoningEffort = useCallback((value: ReasoningEffort) => {
    setSelectedReasoningEffort(value);
  }, []);
  const handleCreateSession = useCallback(() => {
    const sessionId = createSession(
      activeAgentId ?? undefined,
      t('chat_new_session').replace('+ ', ''),
      selectedModel ?? undefined,
      selectedReasoningEffort,
    );
    setActiveSession(sessionId);
    ensureSessionMessagesLoaded(sessionId);
  }, [
    activeAgentId,
    createSession,
    ensureSessionMessagesLoaded,
    selectedModel,
    selectedReasoningEffort,
    setActiveSession,
    t,
  ]);
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId);
      ensureSessionMessagesLoaded(sessionId);
      if (!isTabletLayout) {
        setSessionPickerVisible(false);
      }
    },
    [ensureSessionMessagesLoaded, isTabletLayout, setActiveSession],
  );
  const handleClearContext = useCallback(
    (sessionId: string) => {
      clearContext(sessionId);
    },
    [clearContext],
  );
  const handleRemoveComposerAttachment = useCallback((index: number) => {
    setComposerAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }, []);
  const handleRetryMessage = useCallback(
    (messageId: string, sessionId: string) => {
      void retryFailedMessage(messageId, sessionId);
    },
    [retryFailedMessage],
  );
  const handlePickImagePress = useCallback(() => {
    handlePickImage();
  }, [handlePickImage]);
  const handleVoicePress = useCallback(() => {
    if (!voiceHintShown) {
      setVoiceHintShown(true);
      showInlineNotice(t('chat_voice_setup_title'), t('chat_voice_setup_body'), 'info');
    }
    void handleVoice();
  }, [handleVoice, showInlineNotice, t, voiceHintShown]);
  const handleSendPress = useCallback(() => {
    void handleSend();
  }, [handleSend]);
  const handleExportSession = useCallback(
    async (format: 'markdown' | 'json') => {
      if (!currentSessionId || !currentSession) {
        showInlineNotice(t('chat_export_title'), t('chat_export_empty'), 'error');
        return;
      }

      setExportBusy(true);
      try {
        const uri = await exportSessionToFile(
          {
            session: currentSession,
            messages,
          },
          format,
        );
        await shareExportedSession(uri);
        showInlineNotice(
          t('chat_export_title'),
          format === 'markdown' ? t('chat_export_markdown_done') : t('chat_export_json_done'),
          'success',
        );
      } catch (error: unknown) {
        showInlineNotice(
          t('chat_export_failed_title'),
          error instanceof Error ? error.message : t('chat_export_failed_body'),
          'error',
        );
      } finally {
        setExportBusy(false);
      }
    },
    [currentSession, currentSessionId, messages, showInlineNotice, t],
  );
  const handleOpenQuickTemplates = useCallback(() => {
    setQuickTemplateVisible(true);
  }, []);
  const handleApplyQuickTemplate = useCallback((template: ChatRunbook) => {
    setQuickTemplateVisible(false);
    setDraft((prev) => (prev.trim() ? `${prev.trim()} ${template.text}` : template.text));
  }, []);
  const handleSaveCurrentRunbook = useCallback(() => {
    const normalizedDraft = draft.trim();
    if (!normalizedDraft) {
      showInlineNotice(t('chat_runbook_save_title'), t('chat_runbook_save_empty'), 'error');
      return;
    }

    const fallbackLabel = normalizedDraft
      .split(/\s+/)
      .slice(0, 3)
      .join(' ')
      .slice(0, 24);
    const created = saveRunbook({
      label: fallbackLabel || t('chat_runbook_label_fallback'),
      text: normalizedDraft,
      agentId: activeAgentId,
    });

    showInlineNotice(
      t('chat_runbook_save_title'),
      `${created.label} · ${activeAgentId ? t('chat_runbook_scope_agent') : t('chat_runbook_scope_global')}`,
      'success',
    );
  }, [activeAgentId, draft, saveRunbook, showInlineNotice, t]);
  const handleRemoveRunbook = useCallback(
    (runbookId: string) => {
      removeRunbook(runbookId);
      showInlineNotice(t('chat_runbook_remove_title'), t('chat_runbook_remove_body'), 'info');
    },
    [removeRunbook, showInlineNotice, t],
  );
  const voiceStatusText = isRecording
    ? `${t('chat_recording')} ${formatDuration(recordingSeconds)}`
    : voiceBusy
      ? t('chat_transcribing')
      : null;
  const currentSessionTitle = currentSessionId ? sessions[currentSessionId]?.title ?? null : null;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.select({ ios: 'padding', android: 'height' })}
      keyboardVerticalOffset={0}
    >
      <ChatHeader
        pendingQueueLength={pendingQueue.length}
        isStreaming={isStreaming}
        tokenCount={currentSessionTokens}
        estimatedCostLabel={currentSessionCostLabel}
        contextTokens={currentSessionContextTokens}
        contextLimit={currentContextLimit}
        agentsLoading={agentsLoading}
        agents={agents}
        activeAgentId={activeAgentId}
        modelOptions={modelOptions}
        selectedModel={selectedModel}
        selectedReasoningEffort={selectedReasoningEffort}
        onSelectAgent={handleSelectAgent}
        onSelectDirectSessionMode={handleSelectDirectSessionMode}
        onSelectModel={handleSelectModel}
        onSelectReasoningEffort={handleSelectReasoningEffort}
        onCreateSession={handleCreateSession}
        onOpenSearch={() => {
          setSearchVisible(true);
        }}
      />

      {!!lastError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText} numberOfLines={2}>
            {lastError}
          </Text>
        </View>
      )}

      {!!inlineNotice && (
        <View
          style={[
            styles.inlineNotice,
            inlineNotice.tone === 'error'
              ? styles.inlineNoticeError
              : inlineNotice.tone === 'success'
                ? styles.inlineNoticeSuccess
                : styles.inlineNoticeInfo,
          ]}
        >
          <View style={styles.inlineNoticeBody}>
            <Text style={styles.inlineNoticeTitle}>{inlineNotice.title}</Text>
            <Text style={styles.inlineNoticeText}>{inlineNotice.body}</Text>
          </View>
          <Pressable
            style={styles.inlineNoticeClose}
            onPress={() => {
              setInlineNotice(null);
              if (noticeTimerRef.current) {
                clearTimeout(noticeTimerRef.current);
                noticeTimerRef.current = null;
              }
            }}
          >
            <Ionicons name="close" size={14} color={mapColorForMode('#E2E8F0', themeMode)} />
          </Pressable>
        </View>
      )}

      {!isTabletLayout && (
        <View style={styles.mobileSessionBar}>
          <LiquidGlassPanel style={styles.mobileSessionShell}>
            <Pressable
              style={styles.mobileSessionButton}
              onPress={() => {
                setSessionPickerVisible(true);
              }}
            >
              <Text style={styles.mobileSessionButtonLabel}>
                {t('chat_conversations')} ({sessionList.length})
              </Text>
              <Text style={styles.mobileSessionButtonMeta} numberOfLines={1}>
                {currentSessionTitle ?? t('chat_no_sessions_yet')}
              </Text>
            </Pressable>
          </LiquidGlassPanel>
        </View>
      )}

      <View style={[styles.body, isTabletLayout && styles.bodyTablet]}>
        {isTabletLayout && (
          <ChatSessionPanel
            mode="sidebar"
            sessionCount={sessionList.length}
            sessionSections={sessionSections}
            currentSessionId={currentSessionId}
            sessionStats={sessionStats}
            activeAgentId={activeAgentId}
            onSelectSession={handleSelectSession}
          />
        )}

        <View style={styles.messagesPane}>
          <ChatMessageList
            sessionId={currentSessionId}
            messages={messages}
            onRetryMessage={handleRetryMessage}
            highlightedMessageId={highlightedMessageId}
          />
        </View>
      </View>

      <MessageSearch
        visible={searchVisible}
        query={searchQuery}
        scope={searchScope}
        results={searchResults}
        onClose={() => {
          setSearchVisible(false);
        }}
        onChangeQuery={setSearchQuery}
        onChangeScope={setSearchScope}
        onSelectResult={(result) => {
          setSearchVisible(false);
          setActiveSession(result.sessionId);
          ensureSessionMessagesLoaded(result.sessionId);
          setActiveAgent(sessions[result.sessionId]?.agentId ?? null);
          setHighlightedMessageId(result.messageId);
        }}
      />

      <Modal
        visible={quickTemplateVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setQuickTemplateVisible(false);
        }}
      >
        <View style={styles.templateOverlay}>
          <Pressable
            style={styles.templateBackdrop}
            onPress={() => {
              setQuickTemplateVisible(false);
            }}
          />
          <View style={styles.templateCard}>
            <Text style={styles.templateTitle}>{t('chat_templates_title')}</Text>
            <Text style={styles.templateHint}>{t('chat_templates_hint')}</Text>
            <View style={styles.templateActions}>
              <Pressable
                style={[
                  styles.templateActionButton,
                  !draft.trim() && styles.templateActionButtonDisabled,
                ]}
                disabled={!draft.trim()}
                onPress={handleSaveCurrentRunbook}
              >
                <Text style={styles.templateActionButtonText}>{t('chat_runbook_save_action')}</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.templateList} contentContainerStyle={styles.templateListContent}>
              {visibleRunbooks.map((template) => (
                <View key={template.id} style={styles.templateItem}>
                  <Pressable
                    style={styles.templateItemBody}
                    onPress={() => {
                      handleApplyQuickTemplate(template);
                    }}
                  >
                    <Text style={styles.templateItemTitle}>{template.label}</Text>
                    <Text style={styles.templateItemText}>{template.text}</Text>
                    <Text style={styles.templateItemMeta}>
                      {template.agentId ? t('chat_runbook_scope_agent') : t('chat_runbook_scope_global')}
                    </Text>
                  </Pressable>
                  {!template.system && (
                    <Pressable
                      style={styles.templateDeleteButton}
                      onPress={() => {
                        handleRemoveRunbook(template.id);
                      }}
                    >
                      <Ionicons name="trash-outline" size={16} color={mapColorForMode('#FCA5A5', themeMode)} />
                    </Pressable>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!isTabletLayout && sessionPickerVisible}
        animationType="slide"
        onRequestClose={() => {
          setSessionPickerVisible(false);
        }}
      >
        <View style={styles.sessionModalScreen}>
          <View style={styles.sessionModalHeader}>
            <Text style={styles.sessionModalTitle}>
              {t('chat_conversations')} ({sessionList.length})
            </Text>
            <Pressable
              style={styles.sessionModalCloseButton}
              onPress={() => {
                setSessionPickerVisible(false);
              }}
            >
              <Text style={styles.sessionModalCloseText}>{t('common_close')}</Text>
            </Pressable>
          </View>

          <ChatSessionPanel
            mode="modal"
            sessionCount={sessionList.length}
            sessionSections={sessionSections}
            currentSessionId={currentSessionId}
            sessionStats={sessionStats}
            activeAgentId={activeAgentId}
            onSelectSession={handleSelectSession}
          />
        </View>
      </Modal>

      <Modal
        visible={imagePickerSheetVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setImagePickerSheetVisible(false);
        }}
      >
        <View style={styles.imageSheetOverlay}>
          <Pressable
            style={styles.imageSheetBackdrop}
            onPress={() => {
              setImagePickerSheetVisible(false);
            }}
          />
          <View
            style={[
              styles.imageSheetCard,
              {
                marginBottom: Platform.OS === 'ios' ? Math.max(insets.bottom + 78, 98) : 14,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}
          >
            <Text style={styles.imageSheetTitle}>{t('chat_add_image_title')}</Text>
            <Text style={styles.imageSheetHint}>{t('chat_add_image_body')}</Text>

            <Pressable style={styles.imageSheetAction} onPress={handlePickImageFromCamera}>
              <Ionicons name="camera-outline" size={18} color={mapColorForMode('#E2E8F0', themeMode)} />
              <Text style={styles.imageSheetActionText}>{t('chat_add_image_camera')}</Text>
            </Pressable>

            <Pressable style={styles.imageSheetAction} onPress={handlePickImageFromLibrary}>
              <Ionicons name="images-outline" size={18} color={mapColorForMode('#E2E8F0', themeMode)} />
              <Text style={styles.imageSheetActionText}>{t('chat_add_image_library')}</Text>
            </Pressable>

            <Pressable
              style={styles.imageSheetCancel}
              onPress={() => {
                setImagePickerSheetVisible(false);
              }}
            >
              <Text style={styles.imageSheetCancelText}>{t('common_cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ChatComposer
        currentSessionId={currentSessionId}
        onClearContext={handleClearContext}
        onExportMarkdown={() => {
          void handleExportSession('markdown');
        }}
        onExportJson={() => {
          void handleExportSession('json');
        }}
        onOpenQuickTemplates={handleOpenQuickTemplates}
        runbooks={visibleRunbooks}
        onApplyRunbook={handleApplyQuickTemplate}
        exportBusy={exportBusy}
        composerAttachments={composerAttachments}
        onRemoveAttachment={handleRemoveComposerAttachment}
        voiceStatusText={voiceStatusText}
        onPickImage={handlePickImagePress}
        isRecording={isRecording}
        voiceBusy={voiceBusy}
        recordingSeconds={recordingSeconds}
        onVoice={handleVoicePress}
        draft={draft}
        onChangeDraft={setDraft}
        sendDisabled={sendDisabled}
        isStreaming={isStreaming}
        onSend={handleSendPress}
        bottomInset={composerBottomInset}
      />
    </KeyboardAvoidingView>
  );
}

const styles = createAdaptiveStyles({
  screen: {
    flex: 1,
    backgroundColor: '#020617',
    paddingTop: 10,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  bodyTablet: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    paddingHorizontal: 12,
  },
  headerStack: {
    paddingHorizontal: 14,
    gap: 8,
    marginBottom: 6,
  },
  headerCard: {
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  iconGlassButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '700',
  },
  statusRail: {
    gap: 8,
    alignItems: 'center',
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    minHeight: 30,
    justifyContent: 'center',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  controlRailShell: {
    borderRadius: 20,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: 'center',
  },
  controlRailLoading: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlRailContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  controlRailLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    marginRight: 2,
  },
  controlChip: {
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 34,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  newSessionChip: {
    paddingHorizontal: 14,
  },
  mobileSessionBar: {
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  mobileSessionShell: {
    borderRadius: 18,
    borderWidth: 1,
  },
  mobileSessionButton: {
    minHeight: 44,
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mobileSessionButtonLabel: {
    color: '#DBEAFE',
    fontSize: 12,
    fontWeight: '700',
  },
  mobileSessionButtonMeta: {
    color: '#94A3B8',
    fontSize: 11,
  },
  sessionPanel: {
    marginHorizontal: 0,
    marginTop: 0,
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    backgroundColor: '#0B1220',
    overflow: 'hidden',
  },
  sessionPanelTablet: {
    marginTop: 6,
    width: 340,
    flexShrink: 0,
  },
  sessionPanelModal: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 20,
  },
  sessionPanelHeader: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  sessionPanelTitle: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '700',
  },
  sessionSectionList: {
    maxHeight: 260,
  },
  sessionSectionListModal: {
    flex: 1,
    maxHeight: 9999,
  },
  messagesPane: {
    flex: 1,
    minHeight: 0,
  },
  sessionSectionHeader: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 4,
  },
  sessionItem: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    marginHorizontal: 10,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 56,
    backgroundColor: '#0F172A',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  sessionItemSelected: {
    borderColor: '#264653',
    backgroundColor: '#264653',
  },
  sessionItemText: {
    color: '#94A3B8',
    fontSize: 14,
    flex: 1,
  },
  sessionItemTextSelected: {
    color: '#FFFFFF',
  },
  sessionItemMeta: {
    color: '#64748B',
    fontSize: 12,
    maxWidth: 170,
    textAlign: 'right',
  },
  sessionEmpty: {
    color: '#64748B',
    fontSize: 13,
    padding: 10,
  },
  messagesList: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 20,
    gap: 12,
    flexGrow: 1,
  },
  messagesListHidden: {
    opacity: 0,
  },
  messageGroup: {
    width: '100%',
    gap: 6,
  },
  messageGroupUser: {
    alignItems: 'flex-end',
  },
  messageGroupAssistant: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    maxWidth: '88%',
  },
  messageBubbleUser: {
    borderBottomRightRadius: 10,
  },
  messageBubbleAssistant: {
    borderBottomLeftRadius: 10,
  },
  messageBubbleHighlighted: {
    borderColor: '#FACC15',
    shadowColor: '#FACC15',
    shadowOpacity: 0.35,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  messagePlainText: {
    color: '#E2E8F0',
    fontSize: 16,
    lineHeight: 22,
  },
  syntaxBlock: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#020617',
    padding: 8,
    gap: 2,
  },
  syntaxLanguage: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 3,
  },
  syntaxLine: {
    fontSize: 12,
    lineHeight: 17,
    color: '#CBD5E1',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  syntaxPlain: {
    color: '#CBD5E1',
  },
  syntaxKeyword: {
    color: '#7DD3FC',
    fontWeight: '700',
  },
  syntaxString: {
    color: '#FCA5A5',
  },
  syntaxNumber: {
    color: '#FDE68A',
  },
  syntaxComment: {
    color: '#64748B',
    fontStyle: 'italic',
  },
  timelinePanel: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 14,
    backgroundColor: '#020617CC',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timelineHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  timelineTitle: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '700',
  },
  timelineUsage: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '600',
  },
  timelineList: {
    gap: 3,
  },
  timelineItem: {
    gap: 2,
  },
  timelineLine: {
    color: '#CBD5E1',
    fontSize: 11,
    lineHeight: 15,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  timelineDetails: {
    color: '#94A3B8',
    fontSize: 10,
    lineHeight: 14,
    paddingLeft: 14,
  },
  userMessagePlainText: {
    color: '#F8FAFC',
  },
  messageMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  messageMetaRowUser: {
    justifyContent: 'flex-end',
  },
  messageMetaRowAssistant: {
    justifyContent: 'flex-start',
  },
  messageMetaText: {
    fontSize: 11,
    fontWeight: '600',
  },
  messageUsageMeta: {
    fontSize: 10,
    fontWeight: '600',
  },
  retryButton: {
    borderWidth: 1,
    borderColor: '#7F1D1D',
    borderRadius: 8,
    minHeight: 30,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  retryText: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '700',
  },
  messageAttachmentRow: {
    flexDirection: 'row',
    gap: 6,
  },
  messageCarouselWrap: {
    gap: 6,
  },
  messageCarouselContent: {
    alignItems: 'center',
  },
  messageCarouselPage: {
    paddingRight: 6,
  },
  messageCarouselImage: {
    height: 180,
    borderRadius: 10,
    borderWidth: 1,
  },
  messageCarouselDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  messageCarouselDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: '#334155',
  },
  messageCarouselDotActive: {
    width: 18,
    backgroundColor: '#93C5FD',
  },
  messageImage: {
    width: 90,
    height: 90,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  messageImagePlaceholder: {
    width: 90,
    height: 90,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageImagePlaceholderText: {
    color: '#94A3B8',
    fontSize: 11,
  },
  emptyWrap: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    backgroundColor: '#0B1220',
    padding: 16,
    alignItems: 'center',
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  footer: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
  },
  composerShell: {
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  composerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  composerRunbookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contextButton: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contextButtonDisabled: {
    opacity: 0.55,
  },
  contextButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  runbookChip: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  runbookChipText: {
    fontSize: 12,
    fontWeight: '600',
    maxWidth: 180,
  },
  attachmentList: {
    maxHeight: 76,
  },
  attachmentListContent: {
    gap: 8,
  },
  voiceStatusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  attachmentItem: {
    width: 66,
    height: 66,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  attachmentImage: {
    width: '100%',
    height: '100%',
  },
  attachmentRemove: {
    position: 'absolute',
    right: 2,
    top: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
  },
  attachmentRemoveText: {
    color: '#FCA5A5',
    fontSize: 10,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-end',
  },
  sideButton: {
    height: 40,
    width: 40,
    borderWidth: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideButtonRecording: {
    borderColor: '#7F1D1D',
    backgroundColor: '#1F1111',
  },
  sideButtonDisabled: {
    opacity: 0.5,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 20,
    color: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  sendButton: {
    minWidth: 68,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  inlineNotice: {
    marginHorizontal: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  inlineNoticeInfo: {
    borderColor: '#315564',
    backgroundColor: '#EEF8FB',
  },
  inlineNoticeError: {
    borderColor: '#B23A48',
    backgroundColor: '#FFF2F5',
  },
  inlineNoticeSuccess: {
    borderColor: '#2A9D8F',
    backgroundColor: '#ECFCF7',
  },
  inlineNoticeBody: {
    flex: 1,
    gap: 2,
  },
  inlineNoticeTitle: {
    color: '#264653',
    fontSize: 13,
    fontWeight: '700',
  },
  inlineNoticeText: {
    color: '#4E6471',
    fontSize: 12,
    lineHeight: 16,
  },
  inlineNoticeClose: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
  },
  imageSheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: '#02061788',
  },
  imageSheetBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  imageSheetCard: {
    margin: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 14,
    backgroundColor: '#0B1220',
    padding: 12,
    gap: 8,
  },
  imageSheetTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  imageSheetHint: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 2,
  },
  imageSheetAction: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  imageSheetActionText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
  },
  imageSheetCancel: {
    marginTop: 4,
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#5E7582',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#264653',
  },
  imageSheetCancelText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  templateOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: '#02061788',
  },
  templateBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  templateCard: {
    marginHorizontal: 12,
    marginBottom: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0B1220',
    padding: 12,
    gap: 8,
  },
  templateTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  templateHint: {
    color: '#94A3B8',
    fontSize: 12,
  },
  templateActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  templateActionButton: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#264653',
    backgroundColor: '#16313A',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateActionButtonDisabled: {
    opacity: 0.45,
  },
  templateActionButtonText: {
    color: '#CAFFF5',
    fontSize: 12,
    fontWeight: '700',
  },
  templateList: {
    maxHeight: 360,
  },
  templateListContent: {
    gap: 8,
  },
  templateItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    padding: 10,
    gap: 10,
  },
  templateItemBody: {
    flex: 1,
    gap: 3,
  },
  templateItemTitle: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
  },
  templateItemText: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16,
  },
  templateItemMeta: {
    color: '#5EEAD4',
    fontSize: 11,
    fontWeight: '600',
  },
  templateDeleteButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F1111',
    borderWidth: 1,
    borderColor: '#7F1D1D',
  },
  errorBanner: {
    marginHorizontal: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#7F1D1D',
    backgroundColor: '#1F1111',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  errorBannerText: {
    color: '#FCA5A5',
    fontSize: 13,
    fontWeight: '600',
  },
  sessionModalScreen: {
    flex: 1,
    backgroundColor: '#020617',
    paddingTop: 52,
  },
  sessionModalHeader: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sessionModalTitle: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '700',
  },
  sessionModalCloseButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    justifyContent: 'center',
  },
  sessionModalCloseText: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '700',
  },
});
