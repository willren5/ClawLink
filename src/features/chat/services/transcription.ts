import { NativeModules, Platform } from 'react-native';

import { getGatewayAuthContext } from './gatewayContext';

interface TranscriptionResponse {
  text?: string;
  transcript?: string;
}

interface ReactNativeFileLike {
  uri: string;
  name: string;
  type: string;
}

interface ClawSurfaceBridgeModule {
  transcribeLocalAudio?: (uri: string) => Promise<string>;
}

function isRecordWithText(value: unknown): value is TranscriptionResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return 'text' in value || 'transcript' in value;
}

function shouldFallbackToLocal(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('http 404') ||
    message.includes('http 501') ||
    message.includes('http 503') ||
    message.includes('not found') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('transcription failed') ||
    message.includes('语音转写服务当前不可用') ||
    message.includes('网关未启用语音转写接口') ||
    message.includes('whisper') ||
    message.includes('stt')
  );
}

async function transcribeViaGateway(uri: string): Promise<string> {
  const { baseUrl, token } = await getGatewayAuthContext();
  const file: ReactNativeFileLike = {
    uri,
    name: 'recording.m4a',
    type: 'audio/m4a',
  };
  const paths = [
    '/api/chat/transcribe',
    '/api/audio/transcribe',
    '/api/transcribe',
    '/api/stt/transcribe',
    '/api/voice/transcribe',
    '/api/audio/transcriptions',
  ];
  let lastStatus = 0;
  let lastBody = '';

  for (const path of paths) {
    const body = new FormData();
    body.append('file', file as unknown as Blob);
    if (path.includes('/audio/transcriptions')) {
      body.append('model', 'whisper-1');
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      body,
    });

    if (!response.ok) {
      lastStatus = response.status;
      lastBody = await response.text();
      if ([404, 405, 415, 422].includes(response.status)) {
        continue;
      }
      if (response.status === 501 || response.status === 503) {
        throw new Error('语音转写服务当前不可用。请检查网关上的本地语音模型（Whisper/STT）是否已启动。');
      }
      throw new Error(`HTTP ${response.status}: ${lastBody || 'transcription failed'}`);
    }

    const json: unknown = await response.json();
    if (!isRecordWithText(json)) {
      throw new Error('Invalid transcription response');
    }

    const text = typeof json.text === 'string' ? json.text : typeof json.transcript === 'string' ? json.transcript : '';
    if (!text.trim()) {
      throw new Error('Empty transcription');
    }

    return text.trim();
  }

  if (lastStatus === 404) {
    throw new Error('网关未启用语音转写接口。请先在 OpenClaw Gateway 配置本地 Whisper 或等效 STT Skill。');
  }

  throw new Error(`HTTP ${lastStatus || 0}: ${lastBody || 'transcription failed'}`);
}

async function transcribeViaLocalRecognizer(uri: string): Promise<string> {
  if (Platform.OS !== 'ios') {
    throw new Error('Local fallback only supports iOS right now.');
  }

  const bridge = NativeModules.ClawSurfaceBridge as ClawSurfaceBridgeModule | undefined;
  if (!bridge?.transcribeLocalAudio) {
    throw new Error('Local speech recognizer bridge is unavailable.');
  }

  const transcript = await bridge.transcribeLocalAudio(uri);
  const resolved = typeof transcript === 'string' ? transcript.trim() : '';
  if (!resolved) {
    throw new Error('Local speech recognizer returned empty transcript.');
  }
  return resolved;
}

export async function transcribeAudioUri(uri: string): Promise<string> {
  try {
    return await transcribeViaGateway(uri);
  } catch (gatewayError: unknown) {
    if (!shouldFallbackToLocal(gatewayError)) {
      throw gatewayError;
    }

    try {
      return await transcribeViaLocalRecognizer(uri);
    } catch {
      throw gatewayError;
    }
  }
}
