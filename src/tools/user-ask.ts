import type { ExtToWebviewMessage } from '../shared/message-types';
import type { UserPromptBridge } from '../agent/user-prompt-bridge';

export interface AskDeps {
  bridge: UserPromptBridge;
  post: (msg: ExtToWebviewMessage) => void;
  createEvent: (event: {
    id: string;
    promptId: string;
    question: string;
    choices: string[];
    defaultChoice?: number;
  }) => void;
  resolveEvent: (promptId: string, result: {
    status: 'answered' | 'cancelled';
    answerIndex?: number;
    answerText?: string;
  }) => void;
}

export function createAskHandler(deps: AskDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const question = String(kwargs.question || '').trim();
    if (!question) return '[ERROR] Missing required argument: question';

    const rawChoices = kwargs.choices;
    let choices: string[] = [];
    if (Array.isArray(rawChoices)) {
      choices = rawChoices.map((c) => String(c));
    } else if (typeof rawChoices === 'string') {
      try {
        const parsed = JSON.parse(rawChoices);
        if (Array.isArray(parsed)) choices = parsed.map((c) => String(c));
      } catch {
        return '[ERROR] Argument "choices" must be a JSON array of strings';
      }
    }
    if (choices.length < 2) {
      return '[ERROR] Argument "choices" must contain at least 2 options';
    }

    const defaultChoice =
      typeof kwargs.default === 'number' && kwargs.default >= 0 && kwargs.default < choices.length
        ? kwargs.default
        : undefined;

    const promptId = deps.bridge.nextId('q');
    const eventId = `question-${promptId}`;

    deps.createEvent({ id: eventId, promptId, question, choices, defaultChoice });
    deps.post({ type: 'ask_question', promptId, question, choices, defaultChoice });

    const result = await deps.bridge.registerQuestion(promptId);

    if (result.cancelled) {
      deps.resolveEvent(promptId, { status: 'cancelled' });
      deps.post({ type: 'ask_question_resolved', promptId, status: 'cancelled' });
      return '[USER CANCELLED] The user dismissed the question without answering.';
    }

    const idx = result.index ?? -1;
    const text = result.text ?? (idx >= 0 ? choices[idx] : '');
    deps.resolveEvent(promptId, { status: 'answered', answerIndex: idx, answerText: text });
    deps.post({
      type: 'ask_question_resolved',
      promptId,
      status: 'answered',
      answerIndex: idx,
      answerText: text,
    });

    if (idx >= 0) {
      return `User chose option ${idx}: "${text}"`;
    }
    return `User answered: "${text}"`;
  };
}
