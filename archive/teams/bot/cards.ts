import { Attachment, CardFactory } from 'botbuilder';

export class CaleoCards {
  /**
   * Create the main Caleo control panel Adaptive Card
   */
  static createControlPanelCard(): Attachment {
    return CardFactory.adaptiveCard({
      type: 'AdaptiveCard',
      version: '1.2',
      body: [
        {
          type: 'TextBlock',
          text: 'Caleo - Your Executive Admin',
          weight: 'Bolder',
          size: 'Large',
          wrap: true
        },
        {
          type: 'TextBlock',
          text: 'Quick actions to get started',
          size: 'Medium',
          wrap: true,
          spacing: 'Small'
        },
        {
          type: 'ActionSet',
          actions: [
            {
              type: 'Action.Submit',
              title: 'Plan my day',
              data: { action: 'plan_my_day', text: 'Plan my day' }
            },
            {
              type: 'Action.Submit',
              title: 'Show my calendar',
              data: { action: 'show_calendar', text: 'Show my calendar' }
            },
            {
              type: 'Action.Submit',
              title: 'Find free time',
              data: { action: 'find_free_time', text: 'Find free time for a 1 hour meeting' }
            },
            {
              type: 'Action.Submit',
              title: 'Summarize meetings',
              data: { action: 'summarize_meetings', text: 'Summarize my morning meetings' }
            }
          ],
          spacing: 'Medium'
        }
      ]
    });
  }

  /**
   * Create a welcome card with control panel
   */
  static createWelcomeCard(userName?: string): Attachment {
    return CardFactory.adaptiveCard({
      type: 'AdaptiveCard',
      version: '1.2',
      body: [
        {
          type: 'TextBlock',
          text: `Hi${userName ? ` ${userName}` : ''}! 👋`,
          weight: 'Bolder',
          size: 'Large',
          wrap: true
        },
        {
          type: 'TextBlock',
          text: "I'm Caleo, your AI executive admin. I can help you manage your calendar, schedule meetings, and plan your day.",
          wrap: true,
          spacing: 'Medium'
        },
        {
          type: 'TextBlock',
          text: 'Try one of these actions:',
          weight: 'Bolder',
          spacing: 'Medium'
        },
        {
          type: 'ActionSet',
          actions: [
            {
              type: 'Action.Submit',
              title: 'Plan my day',
              data: { action: 'plan_my_day', text: 'Plan my day' }
            },
            {
              type: 'Action.Submit',
              title: 'Show my calendar',
              data: { action: 'show_calendar', text: 'Show my calendar' }
            },
            {
              type: 'Action.Submit',
              title: 'What can you do?',
              data: { action: 'help', text: 'What can you do?' }
            }
          ],
          spacing: 'Medium'
        }
      ]
    });
  }
}

