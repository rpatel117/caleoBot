import { CardAction, ActionTypes } from 'botbuilder';

export interface PromptContext {
  isFirstMessage: boolean;
  lastActionType?: 'calendar' | 'help' | 'general';
  messageLength: number;
  hasCalendarAccess: boolean;
}

export class PromptSuggestions {
  /**
   * Generate contextual prompt suggestions based on conversation state
   */
  static generateSuggestions(context: PromptContext): { actions: CardAction[] } {
    const actions: CardAction[] = [];

    if (context.isFirstMessage || context.lastActionType === 'help') {
      // Welcome/Help prompts
      actions.push(
        { type: ActionTypes.ImBack, title: 'Plan my day', value: 'Plan my day' },
        { type: ActionTypes.ImBack, title: 'Show my calendar', value: 'Show my calendar' },
        { type: ActionTypes.ImBack, title: 'What can you do?', value: 'What can you do?' }
      );
    } else if (context.lastActionType === 'calendar' && context.hasCalendarAccess) {
      // Post-calendar operation prompts
      actions.push(
        { type: ActionTypes.ImBack, title: 'Find free time', value: 'Find free time for a 1 hour meeting' },
        { type: ActionTypes.ImBack, title: 'Reschedule conflicts', value: 'Show me any scheduling conflicts' },
        { type: ActionTypes.ImBack, title: 'Plan my day', value: 'Plan my day' }
      );
    } else if (context.messageLength < 5) {
      // Vague query prompts
      actions.push(
        { type: ActionTypes.ImBack, title: 'Plan my day', value: 'Plan my day' },
        { type: ActionTypes.ImBack, title: 'Show calendar', value: 'Show my calendar' },
        { type: ActionTypes.ImBack, title: 'Help', value: 'What can you do?' }
      );
    }

    // Limit to 3 suggestions max
    return { actions: actions.slice(0, 3) };
  }

  /**
   * Check if suggestions should be shown (anti-spam logic)
   */
  static shouldShowSuggestions(
    context: PromptContext,
    suggestionCount: number
  ): boolean {
    if (suggestionCount >= 3) return false;
    if (context.isFirstMessage) return true;
    if (context.lastActionType === 'help') return true;
    if (context.lastActionType === 'calendar' && context.hasCalendarAccess) return true;
    if (context.messageLength < 5) return true;
    return false;
  }

  /**
   * Detect if message is a help request
   */
  static isHelpRequest(message: string): boolean {
    const helpKeywords = ['help', 'what can you do', 'how do i', 'commands', 'menu'];
    const lowerMessage = message.toLowerCase().trim();
    return helpKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  /**
   * Detect if message is a calendar-related operation
   */
  static isCalendarOperation(message: string): boolean {
    const calendarKeywords = [
      'calendar', 'schedule', 'meeting', 'event', 'appointment',
      'show', 'list', 'get', 'fetch', 'view'
    ];
    const lowerMessage = message.toLowerCase();
    return calendarKeywords.some(keyword => lowerMessage.includes(keyword));
  }
}

