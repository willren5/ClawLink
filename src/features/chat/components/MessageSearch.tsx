import { memo, useMemo } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useI18n } from '../../../lib/i18n';
import { createAdaptiveStyles, mapColorForMode, useThemeMode } from '../../../theme/adaptiveStyles';

export interface MessageSearchResult {
  messageId: string;
  sessionId: string;
  sessionTitle: string;
  content: string;
  timestamp: number;
}

interface MessageSearchProps {
  visible: boolean;
  query: string;
  scope: 'current' | 'all';
  results: MessageSearchResult[];
  onClose: () => void;
  onChangeQuery: (value: string) => void;
  onChangeScope: (scope: 'current' | 'all') => void;
  onSelectResult: (result: MessageSearchResult) => void;
}

function renderHighlightedText(content: string, query: string): Array<{ text: string; highlighted: boolean }> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [{ text: content, highlighted: false }];
  }

  const lowerContent = content.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  const segments: Array<{ text: string; highlighted: boolean }> = [];

  let cursor = 0;
  while (cursor < content.length) {
    const foundIndex = lowerContent.indexOf(lowerQuery, cursor);
    if (foundIndex === -1) {
      segments.push({ text: content.slice(cursor), highlighted: false });
      break;
    }

    if (foundIndex > cursor) {
      segments.push({ text: content.slice(cursor, foundIndex), highlighted: false });
    }

    segments.push({
      text: content.slice(foundIndex, foundIndex + normalizedQuery.length),
      highlighted: true,
    });

    cursor = foundIndex + normalizedQuery.length;
  }

  return segments;
}

export const MessageSearch = memo(function MessageSearch(props: MessageSearchProps): JSX.Element {
  const { t } = useI18n();
  const themeMode = useThemeMode();
  const iconColor = mapColorForMode('#94A3B8', themeMode);
  const hasQuery = props.query.trim().length > 0;

  const sortedResults = useMemo(
    () => [...props.results].sort((a, b) => b.timestamp - a.timestamp),
    [props.results],
  );

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{t('chat_search_title')}</Text>
            <Pressable style={styles.closeButton} onPress={props.onClose}>
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>

          <TextInput
            value={props.query}
            onChangeText={props.onChangeQuery}
            placeholder={t('chat_search_placeholder')}
            placeholderTextColor={iconColor}
            style={styles.input}
            autoFocus
          />

          <View style={styles.scopeRow}>
            <Pressable
              style={[styles.scopeChip, props.scope === 'current' && styles.scopeChipSelected]}
              onPress={() => {
                props.onChangeScope('current');
              }}
            >
              <Text style={[styles.scopeChipText, props.scope === 'current' && styles.scopeChipTextSelected]}>
                {t('chat_search_scope_current')}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.scopeChip, props.scope === 'all' && styles.scopeChipSelected]}
              onPress={() => {
                props.onChangeScope('all');
              }}
            >
              <Text style={[styles.scopeChipText, props.scope === 'all' && styles.scopeChipTextSelected]}>
                {t('chat_search_scope_all')}
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.resultsList} contentContainerStyle={styles.resultsContent}>
            {hasQuery && sortedResults.length === 0 && <Text style={styles.emptyText}>{t('chat_search_no_results')}</Text>}

            {sortedResults.map((result) => (
              <Pressable
                key={`${result.sessionId}:${result.messageId}`}
                style={styles.resultItem}
                onPress={() => {
                  props.onSelectResult(result);
                }}
              >
                <Text style={styles.resultSession} numberOfLines={1}>
                  {result.sessionTitle}
                </Text>
                <Text style={styles.resultText} numberOfLines={2}>
                  {renderHighlightedText(result.content, props.query).map((segment, index) => (
                    <Text
                      key={`${result.messageId}:segment:${index}`}
                      style={segment.highlighted ? styles.resultTextHighlighted : undefined}
                    >
                      {segment.text}
                    </Text>
                  ))}
                </Text>
                <Text style={styles.resultMeta}>{new Date(result.timestamp).toLocaleString()}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

const styles = createAdaptiveStyles({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.72)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0B1220',
    padding: 14,
    maxHeight: '76%',
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: '#E2E8F0',
    fontWeight: '700',
    fontSize: 16,
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#CBD5E1',
    fontSize: 18,
    lineHeight: 18,
    fontWeight: '700',
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#020617',
    color: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  scopeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  scopeChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scopeChipSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#1D4ED8',
  },
  scopeChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  scopeChipTextSelected: {
    color: '#E2E8F0',
  },
  resultsList: {
    maxHeight: 360,
  },
  resultsContent: {
    gap: 10,
    paddingBottom: 4,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  resultItem: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#111827',
    padding: 10,
    gap: 4,
  },
  resultSession: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  resultText: {
    color: '#E2E8F0',
    fontSize: 13,
    lineHeight: 18,
  },
  resultTextHighlighted: {
    color: '#FDE68A',
    fontWeight: '700',
  },
  resultMeta: {
    color: '#94A3B8',
    fontSize: 11,
  },
});
