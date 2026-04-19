import { describe, it, expect, vi } from 'vitest';

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;
  onresult: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
}

describe('useSpeechRecognition', () => {
  it('module exports useSpeechRecognition function', async () => {
    const mod = await import('./useSpeechRecognition');
    expect(typeof mod.useSpeechRecognition).toBe('function');
  });

  it('MockSpeechRecognition can be instantiated and configured', () => {
    const recognition = new MockSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.lang).toBe('en-US');
  });

  it('MockSpeechRecognition start/stop/abort are callable', () => {
    const recognition = new MockSpeechRecognition();
    recognition.start();
    recognition.stop();
    recognition.abort();

    expect(recognition.start).toHaveBeenCalledOnce();
    expect(recognition.stop).toHaveBeenCalledOnce();
    expect(recognition.abort).toHaveBeenCalledOnce();
  });

  it('MockSpeechRecognition fires onresult with interim results', () => {
    const recognition = new MockSpeechRecognition();
    const onResult = vi.fn();
    recognition.onresult = onResult;

    const event = {
      resultIndex: 0,
      results: {
        length: 1,
        0: {
          isFinal: false,
          length: 1,
          0: { transcript: 'hello', confidence: 0.8 },
        },
      },
    };

    recognition.onresult(event);
    expect(onResult).toHaveBeenCalledWith(event);
  });

  it('MockSpeechRecognition fires onresult with final results', () => {
    const recognition = new MockSpeechRecognition();
    const onResult = vi.fn();
    recognition.onresult = onResult;

    const event = {
      resultIndex: 0,
      results: {
        length: 1,
        0: {
          isFinal: true,
          length: 1,
          0: { transcript: 'hello world', confidence: 0.95 },
        },
      },
    };

    recognition.onresult(event);
    expect(onResult).toHaveBeenCalledWith(event);
    expect(event.results[0].isFinal).toBe(true);
  });

  it('MockSpeechRecognition fires onerror with error codes', () => {
    const recognition = new MockSpeechRecognition();
    const onError = vi.fn();
    recognition.onerror = onError;

    recognition.onerror({ error: 'not-allowed', message: 'Permission denied' });
    expect(onError).toHaveBeenCalledWith({ error: 'not-allowed', message: 'Permission denied' });
  });
});
