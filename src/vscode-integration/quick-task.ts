import * as vscode from 'vscode';
import type { Orchestrator } from '../agent/orchestrator';

interface QuickAction {
  label: string;
  description: string;
  icon: string;
  action: 'explain' | 'refactor' | 'tests' | 'fix' | 'custom';
  prompt?: string;
}

const COMMON_ACTIONS: QuickAction[] = [
  { label: '$(lightbulb) Explain', description: 'Explain the selected code', icon: 'lightbulb', action: 'explain', prompt: 'Please explain the following code:' },
  { label: '$(tools) Refactor', description: 'Refactor for readability and performance', icon: 'tools', action: 'refactor', prompt: 'Please refactor the following code to improve readability and performance:' },
  { label: '$(beaker) Write Tests', description: 'Generate unit tests', icon: 'beaker', action: 'tests', prompt: 'Please write unit tests for the following code:' },
  { label: '$(bug) Fix', description: 'Find and fix bugs', icon: 'bug', action: 'fix', prompt: 'Please find and fix any bugs in the following code:' },
  { label: '$(comment-discussion) Ask...', description: 'Ask a custom question about selected code', icon: 'comment', action: 'custom' },
];

export function registerQuickTask(
  context: vscode.ExtensionContext,
  orchestrator: Orchestrator | undefined,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('obotovs.quickTask', async () => {
      const items: (vscode.QuickPickItem & { _action?: QuickAction; _agentId?: string })[] = [];

      // Running agents section
      if (orchestrator) {
        const agents = orchestrator.getAgentSummaries().filter(a => a.status === 'running');
        if (agents.length > 0) {
          items.push({ label: 'Running Agents', kind: vscode.QuickPickItemKind.Separator });
          for (const a of agents) {
            items.push({
              label: `$(debug-stop) ${a.label || a.id}`,
              description: `running — $${a.cost.totalCost.toFixed(4)}`,
              _agentId: a.id,
            });
          }
        }
      }

      // Common actions section
      items.push({ label: 'Actions', kind: vscode.QuickPickItemKind.Separator });
      for (const action of COMMON_ACTIONS) {
        items.push({
          label: action.label,
          description: action.description,
          _action: action,
        });
      }

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an Oboto action or cancel a running agent',
        title: 'Oboto: Quick Task',
      });

      if (!pick) return;

      // Cancel agent
      if (pick._agentId) {
        await orchestrator?.cancelAgent(pick._agentId);
        vscode.window.showInformationMessage(`Cancelled agent: ${pick._agentId}`);
        return;
      }

      // Run action
      const action = pick._action;
      if (!action || !orchestrator) return;

      const editor = vscode.window.activeTextEditor;
      const hasSelection = editor && !editor.selection.isEmpty;

      if (action.action === 'custom') {
        const question = await vscode.window.showInputBox({
          prompt: 'What would you like to ask?',
          placeHolder: hasSelection
            ? 'Ask about the selected code...'
            : 'Ask anything...',
        });
        if (!question) return;

        let prompt = question;
        if (hasSelection && editor) {
          const text = editor.document.getText(editor.selection);
          const fileName = editor.document.fileName.split(/[\\/]/).pop();
          prompt = `${question}\n\n\`\`\`${editor.document.languageId}\n// ${fileName}\n${text}\n\`\`\``;
        }

        await vscode.commands.executeCommand('obotovs.chatPanel.focus');
        await orchestrator.submitToAgent('foreground', prompt);
        return;
      }

      if (hasSelection && editor && action.prompt) {
        const text = editor.document.getText(editor.selection);
        const fileName = editor.document.fileName.split(/[\\/]/).pop();
        const prompt = `${action.prompt}\n\n\`\`\`${editor.document.languageId}\n// ${fileName}\n${text}\n\`\`\``;
        await vscode.commands.executeCommand('obotovs.chatPanel.focus');
        await orchestrator.submitToAgent('foreground', prompt);
      } else {
        vscode.window.showInformationMessage('Select some code first, then try again.');
      }
    }),
  );
}
