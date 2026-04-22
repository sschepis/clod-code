import React, { useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { ThoughtBlock } from './ThoughtBlock';
import { ToolBlock } from './ToolBlock';

import { PermissionPrompt } from './PermissionPrompt';
import { QuestionPrompt } from './QuestionPrompt';
import { SecretPrompt } from './SecretPrompt';
import { PeerDispatchPrompt } from './PeerDispatchPrompt';
import { PlanApprovalPrompt } from './PlanApprovalPrompt';
import { PhaseIndicator } from './PhaseIndicator';
import type { SessionEvent, PhaseState, PlanApprovalMode } from '../../../src/shared/message-types';

interface ChatPanelProps {
  events: SessionEvent[];
  phase: PhaseState;
  isProcessing: boolean;
  onRevert: (eventId: string) => void;
  onEdit: (eventId: string, content: string) => void;
  onDelete: (eventId: string) => void;
  onPermissionRespond: (eventId: string, allowed: boolean, remember: boolean) => void;
  onQuestionRespond: (promptId: string, response: { cancelled?: boolean; answerIndex?: number; answerText?: string }) => void;
  onSecretRespond: (promptId: string, response: { cancelled?: boolean; value?: string; saveToFile?: boolean }) => void;
  onPeerDispatchRespond: (promptId: string, approved: boolean) => void;
  onPlanApprovalRespond: (promptId: string, response: { denied?: boolean; approvalMode?: PlanApprovalMode }) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  events, phase, isProcessing, onRevert, onEdit, onDelete, onPermissionRespond, onQuestionRespond, onSecretRespond, onPeerDispatchRespond, onPlanApprovalRespond,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, isProcessing, phase]);

  const renderEvent = (event: SessionEvent, index: number) => {
    switch (event.role) {
      case 'user':
        return (
          <MessageBubble
            key={event.id || index}
            id={event.id}
            role="user"
            content={event.content}
            timestamp={event.timestamp}
            attachments={event.attachments}
            onRevert={onRevert}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        );
      case 'assistant':
        return (
          <MessageBubble
            key={event.id || index}
            id={event.id}
            role="assistant"
            content={event.content}
            timestamp={event.timestamp}
            model={event.model}
            onRevert={onRevert}
            onDelete={onDelete}
          />
        );
      case 'thought':
        return (
          <ThoughtBlock
            key={event.id || index}
            content={event.content}
            duration={event.duration}
          />
        );
      case 'tool':
        return (
          <ToolBlock
            key={event.id || index}
            id={event.id}
            toolName={event.toolName}
            command={event.command}
            status={event.status}
            output={event.output}
            duration={event.duration}
            kwargs={event.kwargs}
            onRevert={onRevert}
          />
        );
      case 'narrative':
        return (
          <div key={event.id || index} className="px-6 py-1.5 flex items-center gap-2 text-xs text-vscode-desc border-l-2 border-sky-500/30 my-1 fade-in font-mono">
            <span className="text-sky-400/60 shrink-0">&#x25B8;</span>
            <span className="break-words min-w-0">{event.content}</span>
            <span className="text-vscode-disabled ml-auto shrink-0 tabular-nums">
              {event.totalToolCalls} calls
            </span>
          </div>
        );
      case 'system':
        return (
          <div key={event.id || index} className="px-6 py-3 text-xs text-vscode-desc italic border-b border-vscode-panelBorder/30 fade-in">
            {event.content}
          </div>
        );
      case 'permission':
        return (
          <PermissionPrompt
            key={event.id || index}
            id={event.id}
            toolName={event.toolName}
            description={event.description}
            status={event.status}
            onRespond={onPermissionRespond}
          />
        );
      case 'question':
        return (
          <QuestionPrompt
            key={event.id || index}
            promptId={event.promptId}
            question={event.question}
            choices={event.choices}
            defaultChoice={event.defaultChoice}
            inputMode={event.inputMode}
            status={event.status}
            answerIndex={event.answerIndex}
            answerText={event.answerText}
            onRespond={onQuestionRespond}
          />
        );
      case 'secret_request':
        return (
          <SecretPrompt
            key={event.id || index}
            promptId={event.promptId}
            name={event.name}
            description={event.description}
            envPath={event.envPath}
            status={event.status}
            savedToFile={event.savedToFile}
            onRespond={onSecretRespond}
          />
        );
      case 'peer_dispatch_request':
        return (
          <PeerDispatchPrompt
            key={event.id || index}
            promptId={event.promptId}
            fromWindowId={event.fromWindowId}
            task={event.task}
            label={event.label}
            status={event.status}
            onRespond={onPeerDispatchRespond}
          />
        );
      case 'plan_approval':
        return (
          <PlanApprovalPrompt
            key={event.id || index}
            promptId={event.promptId}
            planSummary={event.planSummary}
            planFilePath={event.planFilePath}
            status={event.status}
            approvalMode={event.approvalMode}
            onRespond={onPlanApprovalRespond}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
      className="flex-1 overflow-y-auto scroll-smooth pb-6 relative"
      style={{ scrollbarWidth: 'thin', scrollbarColor: '#3f3f46 transparent' }}
    >
      {events.length === 0 && !isProcessing ? (
        <div className="flex h-full items-center justify-center text-vscode-disabled space-y-4 flex-col">
          <div className="text-center space-y-3">
            <div className="text-3xl">&#x2726;</div>
            <p className="text-sm font-medium text-vscode-desc">Oboto</p>
            <p className="text-xs text-vscode-disabled max-w-[280px]">
              Multi-LLM AI coding assistant. Type a message, paste code, or use /commands to get started.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col pb-4">
          {events.map(renderEvent)}

          {isProcessing && phase.phase !== 'idle' && phase.phase !== 'complete' && (
            <PhaseIndicator phase={phase.phase} message={phase.message} />
          )}

          {isProcessing && phase.phase === 'idle' && (
            <div className="px-6 py-4 ml-4 flex items-center gap-3 text-vscode-desc text-sm italic">
              <Loader2 size={14} className="animate-spin" />
              Agent is working...
            </div>
          )}
        </div>
      )}
    </div>
  );
};
