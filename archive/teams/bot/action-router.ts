import { TurnContext } from 'botbuilder';

export interface ActionHandler {
  (context: TurnContext, userContext: any, accessToken?: string): Promise<string>;
}

export class ActionRouter {
  private static handlers: Map<string, ActionHandler> = new Map();

  /**
   * Register an action handler
   */
  static register(action: string, handler: ActionHandler): void {
    this.handlers.set(action.toLowerCase(), handler);
  }

  /**
   * Route an action to the appropriate handler
   * Returns the message text to process if no direct handler exists
   */
  static async route(
    context: TurnContext,
    actionData: any,
    userContext: any,
    accessToken?: string
  ): Promise<{ handled: boolean; message?: string }> {
    const action = actionData?.action || actionData?.text;
    
    if (!action) {
      return { handled: false, message: actionData?.text || '' };
    }

    // Validate userContext
    if (!userContext || !userContext.userId) {
      console.error('❌ ActionRouter: Invalid userContext', userContext);
      return { handled: false, message: actionData?.text || action };
    }

    const handler = this.handlers.get(action.toLowerCase());
    
    if (handler) {
      try {
        // Note: Processing message is sent in main handler to avoid duplication
        // Don't send it here to prevent duplicate "processing" messages
        
        const response = await handler(context, userContext, accessToken);
        if (response && typeof response === 'string' && response.trim().length > 0) {
          await context.sendActivity(response);
          return { handled: true };
        } else {
          console.error('❌ ActionRouter: Handler returned empty or invalid response:', response);
          await context.sendActivity("I apologize, but I encountered an error processing that action. Please try again.");
          return { handled: true }; // Always mark as handled to prevent double processing
        }
      } catch (error) {
        console.error('❌ ActionRouter: Handler error:', error);
        await context.sendActivity({
          text: "I apologize, but I encountered an error while processing your request. Please try again.",
          type: 'message'
        });
        return { handled: true }; // Always mark as handled to prevent double processing
      }
    }

    // If no handler, treat as regular message
    return { handled: false, message: actionData?.text || action };
  }

  /**
   * Check if message text matches a known action pattern
   */
  static isActionMessage(message: string): { isAction: boolean; action?: string } {
    const actionPatterns: { [key: string]: string[] } = {
      'plan_my_day': ['plan my day', 'plan today', 'daily plan'],
      'show_calendar': ['show my calendar', 'show calendar', 'my calendar', 'view calendar'],
      'find_free_time': ['find free time', 'find time', 'when am i free'],
      'summarize_meetings': ['summarize meetings', 'meeting summary', 'summarize my meetings'],
      'help': ['what can you do', 'help', 'commands', 'menu']
    };

    const lowerMessage = message.toLowerCase().trim();

    for (const [action, patterns] of Object.entries(actionPatterns)) {
      if (patterns.some(pattern => lowerMessage.includes(pattern))) {
        return { isAction: true, action };
      }
    }

    return { isAction: false };
  }
}

