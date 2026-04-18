import * as vscode from 'vscode';
import { COMMANDS } from '../shared/constants';
import type { PhaseState, CostState, ModelInfo, AgentPhase } from '../shared/message-types';

const PHASE_ICONS: Record<AgentPhase, string> = {
  idle: '',
  request: '$(loading~spin)',
  precheck: '$(beaker)',
  planning: '$(list-ordered)',
  thinking: '$(loading~spin)',
  tools: '$(wrench)',
  validation: '$(check)',
  memory: '$(database)',
  continuation: '$(sync~spin)',
  error: '$(error)',
  doom: '$(warning)',
  cancel: '$(close)',
  complete: '$(check-all)',
};

export class StatusBar {
  private modelItem: vscode.StatusBarItem;
  private phaseItem: vscode.StatusBarItem;
  private costItem: vscode.StatusBarItem;

  constructor() {
    this.modelItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.modelItem.command = COMMANDS.SWITCH_MODEL;
    this.modelItem.tooltip = 'Click to switch LLM model';

    this.phaseItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.phaseItem.tooltip = 'Agent phase';

    this.costItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.costItem.tooltip = 'Session token usage and cost';

    this.updateModel({ provider: 'anthropic', model: 'claude-sonnet-4-20250514', isLocal: false });
    this.modelItem.show();
  }

  updateModel(model: ModelInfo): void {
    this.modelItem.text = `$(hubot) ${model.model}`;
  }

  updatePhase(phase: PhaseState): void {
    if (phase.phase === 'idle' || phase.phase === 'complete') {
      this.phaseItem.hide();
      return;
    }

    const icon = PHASE_ICONS[phase.phase] || '$(loading~spin)';
    this.phaseItem.text = `${icon} ${phase.message}`;
    this.phaseItem.show();
  }

  updateCost(cost: CostState): void {
    if (cost.totalTokens === 0) {
      this.costItem.hide();
      return;
    }

    const costStr = cost.totalCost < 0.01 ? `$${cost.totalCost.toFixed(4)}` : `$${cost.totalCost.toFixed(2)}`;
    const tokenStr = cost.totalTokens >= 1000 ? `${(cost.totalTokens / 1000).toFixed(1)}K` : String(cost.totalTokens);
    this.costItem.text = `$(pulse) ${costStr} | ${tokenStr} tokens`;
    this.costItem.show();
  }

  dispose(): void {
    this.modelItem.dispose();
    this.phaseItem.dispose();
    this.costItem.dispose();
  }
}
