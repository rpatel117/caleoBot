export interface PlanLimits {
  meetingsPerMonth: number;   // -1 = unlimited
  messagesPerMonth: number;   // -1 = unlimited
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free:       { meetingsPerMonth: 10,  messagesPerMonth: 50 },
  pro:        { meetingsPerMonth: -1,  messagesPerMonth: -1 },
  enterprise: { meetingsPerMonth: -1,  messagesPerMonth: -1 },
};

export interface MonthlyUsage {
  meetingsCreated: number;
  meetingsUpdated: number;
  meetingsDeleted: number;
  messagesSent: number;
}

export function checkLimit(
  usage: MonthlyUsage,
  limits: PlanLimits,
  action: 'message' | 'meeting'
): { allowed: boolean; message?: string } {
  if (action === 'message' && limits.messagesPerMonth !== -1) {
    if (usage.messagesSent >= limits.messagesPerMonth) {
      return {
        allowed: false,
        message: `You've reached your free plan limit of ${limits.messagesPerMonth} messages this month. Upgrade to Pro to continue. Use \`/caleo-upgrade\` to learn more.`,
      };
    }
  }
  if (action === 'meeting' && limits.meetingsPerMonth !== -1) {
    const totalMeetings = usage.meetingsCreated;
    if (totalMeetings >= limits.meetingsPerMonth) {
      return {
        allowed: false,
        message: `You've reached your free plan limit of ${limits.meetingsPerMonth} meetings this month. Upgrade to Pro to continue. Use \`/caleo-upgrade\` to learn more.`,
      };
    }
  }
  return { allowed: true };
}
