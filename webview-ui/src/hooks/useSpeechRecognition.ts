import { useState, useRef, useCallback, useEffect } from 'react';

interface UseSpeechRecognitionOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

interface UseSpeechRecognitionReturn {
  isSupported: boolean;
  isListening: boolean;
  start: () => void;
  stop: () => void;
  error: string | null;
}

const SpeechRecognitionCtor =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : undefined;

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone permission denied',
  'no-speech': 'No speech detected',
  'audio-capture': 'No microphone found',
  'network': 'Network error — speech recognition unavailable',
  'aborted': 'Speech recognition aborted',
};

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {},
): UseSpeechRecognitionReturn {
  const {
    lang = 'en-US',
    continuous = true,
    interimResults = true,
    onResult,
    onError,
    onEnd,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const manualStopRef = useRef(false);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const onEndRef = useRef(onEnd);

  onResultRef.current = onResult;
  onErrorRef.current = onError;
  onEndRef.current = onEnd;

  const createRecognition = useCallback(() => {
    if (!SpeechRecognitionCtor) return null;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    recognition.lang = lang;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      if (finalTranscript) {
        onResultRef.current?.(finalTranscript, true);
      } else if (interimTranscript) {
        onResultRef.current?.(interimTranscript, false);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'aborted' && manualStopRef.current) return;

      const message = ERROR_MESSAGES[event.error] || `Speech error: ${event.error}`;
      setError(message);
      onErrorRef.current?.(message);

      if (event.error === 'not-allowed' || event.error === 'audio-capture') {
        setIsListening(false);
        manualStopRef.current = true;
      }
    };

    recognition.onend = () => {
      if (!manualStopRef.current && continuous) {
        // Chrome kills continuous sessions after silence — auto-restart
        try {
          recognition.start();
          return;
        } catch {
          // start() can throw if called too quickly
        }
      }
      setIsListening(false);
      onEndRef.current?.();
    };

    return recognition;
  }, [lang, continuous, interimResults]);

  const start = useCallback(() => {
    if (isListening) return;
    if (!SpeechRecognitionCtor) return;

    setError(null);
    manualStopRef.current = false;

    let recognition = recognitionRef.current;
    if (!recognition) {
      recognition = createRecognition();
      recognitionRef.current = recognition;
    }

    if (!recognition) return;

    try {
      recognition.start();
      setIsListening(true);
    } catch {
      // Already started or other error
    }
  }, [isListening, createRecognition]);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // Already stopped
      }
    }
    setIsListening(false);
  }, []);

  useEffect(() => {
    return () => {
      manualStopRef.current = true;
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.abort();
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, []);

  return {
    isSupported: !!SpeechRecognitionCtor,
    isListening,
    start,
    stop,
    error,
  };
}
