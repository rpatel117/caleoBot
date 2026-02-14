import { TurnContext } from 'botbuilder';

export class ActivityHelpers {
  /**
   * Check if this is likely the first message from a user
   * Note: This is a simplified check. In production, you'd check database for conversation history.
   * For now, we rely on the conversation state map to track if welcome was shown.
   */
  static async isFirstMessage(context: TurnContext): Promise<boolean> {
    // Always return true for personal conversations - the state map will track if welcome was shown
    const conversationType = context.activity.conversation?.conversationType;
    return conversationType === 'personal';
  }

  /**
   * Extract text from activity (handles both message and card actions)
   */
  static extractMessageText(context: TurnContext): string {
    // Handle Adaptive Card Action.Submit
    if (context.activity.value?.text) {
      return context.activity.value.text;
    }
    
    // Handle SuggestedActions (imBack/postBack)
    if (context.activity.text) {
      return context.activity.text;
    }

    return '';
  }

  /**
   * Check if activity is from a card action
   */
  static isCardAction(context: TurnContext): boolean {
    return !!context.activity.value;
  }

  /**
   * Get action data from card submission
   */
  static getCardActionData(context: TurnContext): any {
    return context.activity.value || null;
  }
}

