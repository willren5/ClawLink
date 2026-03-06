import { Platform, Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import type { LocalChatMessage, LocalChatSession } from '../types';

export type SessionExportFormat = 'markdown' | 'json';

interface SessionExportPayload {
  session: LocalChatSession;
  messages: LocalChatMessage[];
}

function sanitizeFileName(input: string): string {
  const normalized = input.trim().replace(/[^\w\-]+/g, '-').replace(/-+/g, '-');
  return normalized.replace(/^-|-$/g, '').slice(0, 56) || 'session';
}

function resolveWritableDirectory(): string {
  const directory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!directory) {
    throw new Error('No writable app directory available.');
  }
  return directory;
}

function buildMarkdown(payload: SessionExportPayload): string {
  const lines: string[] = [];
  lines.push(`# ${payload.session.title}`);
  lines.push('');
  lines.push(`- Session ID: ${payload.session.id}`);
  lines.push(`- Agent: ${payload.session.agentId ?? 'direct'}`);
  lines.push(`- Model: ${payload.session.model ?? 'gateway-default'}`);
  lines.push(`- Updated: ${new Date(payload.session.updatedAt).toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const message of payload.messages) {
    lines.push(`## ${message.role.toUpperCase()} · ${new Date(message.timestamp).toISOString()}`);
    lines.push('');

    if (message.usage) {
      const usageParts = [
        `tokens ${message.usage.totalTokens}`,
        typeof message.usage.contextTokens === 'number' ? `context ${message.usage.contextTokens}` : '',
        typeof message.usage.contextLimit === 'number' ? `limit ${message.usage.contextLimit}` : '',
      ].filter(Boolean);
      if (usageParts.length > 0) {
        lines.push(`_Usage: ${usageParts.join(' · ')}_`);
        lines.push('');
      }
    }

    lines.push(message.content || '...');

    if (message.attachments?.length) {
      lines.push('');
      lines.push('### Attachments');
      for (const attachment of message.attachments) {
        const attachmentBits = [
          attachment.type,
          attachment.mimeType,
          attachment.width && attachment.height ? `${attachment.width}x${attachment.height}` : '',
          attachment.previewUri ?? '',
        ].filter(Boolean);
        lines.push(`- ${attachmentBits.join(' · ')}`);
      }
    }

    if (message.toolTimeline?.length) {
      lines.push('');
      lines.push('### Tool Timeline');
      for (const step of message.toolTimeline) {
        lines.push(`- ${step.label} · ${(Math.max(0, step.durationMs) / 1000).toFixed(1)}s`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

function buildJson(payload: SessionExportPayload): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      session: payload.session,
      messages: payload.messages,
    },
    null,
    2,
  );
}

export async function exportSessionToFile(
  payload: SessionExportPayload,
  format: SessionExportFormat,
): Promise<string> {
  const basename = sanitizeFileName(payload.session.title);
  const extension = format === 'markdown' ? 'md' : 'json';
  const directory = resolveWritableDirectory();
  const uri = `${directory}clawlink-${basename}-${Date.now()}.${extension}`;
  const body = format === 'markdown' ? buildMarkdown(payload) : buildJson(payload);

  await FileSystem.writeAsStringAsync(uri, body, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return uri;
}

export async function shareExportedSession(uri: string): Promise<void> {
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      dialogTitle: 'Share session export',
      UTI: Platform.OS === 'ios' ? 'public.data' : undefined,
      mimeType: uri.endsWith('.md') ? 'text/markdown' : 'application/json',
    });
    return;
  }

  await Share.share({
    url: uri,
    message: uri,
  });
}
