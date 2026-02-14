<!-- e259174a-c329-4f9c-8c48-f69ddbade9b5 8b97e367-d5a7-4e9d-b398-cc4933490d71 -->
# Fix Edge Function Authentication Flow

## Problem

The edge function duplicates authentication logic that the bot already handles, creating a mismatch with the local agent flow. The bot checks authentication before calling the agent, so the edge function should do the same.

## Solution

Simplify the edge function to match the local `SimpleAgentService` - assume authentication is already validated by the bot and focus only on AI processing with calendar tools.

## Implementation Steps

### 1. Update Bot Index (src/index.ts)

**File**: `/Users/rpate/Desktop/caleoBot/src/index.ts`

**Keep the existing authentication check (lines 158-176) for BOTH local and remote agents.**

No changes needed - the bot already:

- Detects calendar context with `needsCalendarContext()`
- Checks authentication with `teamsSSO.getAuthStatus()`
- Sends formatted auth URL via `context.sendActivity()` if not authenticated
- Only calls agent (local or remote) if authenticated

This ensures consistent authentication flow regardless of agent type.

### 2. Simplify Edge Function (supabase/functions/caleo-agent/index.ts)

**File**: `/Users/rpate/Desktop/caleoBot/supabase/functions/caleo-agent/index.ts`

**Remove duplicate authentication logic from the edge function.**

Current problematic flow:

```typescript
async function getAIResponseWithTools(userMessage: string, userContext: any): Promise<string> {
  const needsCalendarAccess = userMessage.toLowerCase().includes('calendar') ...
  
  if (needsCalendarAccess) {
    const todayEvents = await getTodayEvents(userContext);
    
    if (todayEvents.needsReauth) {
      return `I'd love to help you with your calendar, but I need your permission first...`;
    }
    
    // Add calendar context to AI
  }
}
```

**New simplified flow:**

```typescript
async function getAIResponseWithTools(userMessage: string, userContext: any): Promise<string> {
  // Assume bot has already validated authentication
  // Just gather calendar context if needed
  
  const needsCalendarAccess = userMessage.toLowerCase().includes('calendar') ...
  
  let calendarContext = '';
  if (needsCalendarAccess) {
    const currentTime = await getCurrentTime();
    const todayEvents = await getTodayEvents(userContext);
    
    // If we get here, user should be authenticated (bot validated)
    // But if token fails, tools will return empty results, AI will handle gracefully
    if (todayEvents.count > 0) {
      calendarContext = `\n\nCALENDAR CONTEXT:\n...`;
    }
  }
  
  // Call OpenAI API with context
}
```

**Key changes:**

- Remove auth URL generation from edge function
- Remove `needsReauth` checks in `getAIResponseWithTools()`
- Keep token refresh logic in `EdgeTeamsSSOService` (still needed for expired tokens)
- Let calendar tools return empty results if token fails, AI will handle naturally
- Trust that bot has already validated authentication before calling edge function

### 3. Update Edge Function Tool Functions

**File**: `/Users/rpate/Desktop/caleoBot/supabase/functions/caleo-agent/index.ts`

Simplify `getTodayEvents()`, `getWeekEvents()`, etc. to not return auth URLs:

```typescript
async function getTodayEvents(userContext: any) {
  const today = new Date();
  const startOfDay = new Date(...);
  const endOfDay = new Date(...);
  
  const result = await graphService.getCalendarEvents(userContext, startTime, endTime);
  
  if (!result.success || !result.data) {
    // Return empty results instead of auth prompts
    return {
      events: [],
      count: 0
    };
  }

  const events = result.data.map(event => formatEventForDisplay(event));
  return {
    events,
    count: events.length
  };
}
```

### 4. Keep Token Management in Edge Function

**File**: `/Users/rpate/Desktop/caleoBot/supabase/functions/caleo-agent/index.ts`

**Keep these services as-is:**

- `EdgeDatabaseService` - for database operations
- `EdgeTeamsSSOService.getAccessToken()` - for token retrieval and refresh
- `EdgeTeamsSSOService.validateTokenWithMicrosoft()` - for token validation
- `EdgeTeamsSSOService.refreshAccessToken()` - for automatic token refresh
- `EdgeGraphService` - for Graph API calls

These handle the scenario where a token expires between bot validation and edge function execution.

## Expected Flow After Fix

### Scenario 1: User asks about calendar (not authenticated)

```
User: "View my calendar"
  ↓
Bot: needsCalendarContext() → true
Bot: teamsSSO.getAuthStatus() → not authenticated
Bot: Sends formatted auth URL via context.sendActivity()
Bot: Returns (DOES NOT call edge function)
```

### Scenario 2: User asks about calendar (authenticated)

```
User: "View my calendar"
  ↓
Bot: needsCalendarContext() → true
Bot: teamsSSO.getAuthStatus() → authenticated
Bot: Calls edge function with userContext
  ↓
Edge Function: getTodayEvents(userContext)
Edge Function: EdgeTeamsSSOService.getAccessToken() → retrieves/refreshes token
Edge Function: EdgeGraphService.getCalendarEvents() → calls Graph API
Edge Function: Adds calendar data to AI context
Edge Function: Calls OpenAI API
Edge Function: Returns AI response with calendar info
  ↓
Bot: Sends AI response to user
```

### Scenario 3: Token expires between bot check and edge function

```
User: "View my calendar"
  ↓
Bot: Checks auth → valid (but token about to expire)
Bot: Calls edge function
  ↓
Edge Function: getAccessToken() detects expiration
Edge Function: Automatically refreshes token
Edge Function: Continues with updated token
Edge Function: Returns AI response
```

## Files to Modify

1. `/Users/rpate/Desktop/caleoBot/supabase/functions/caleo-agent/index.ts` - Remove duplicate auth checks, simplify tool functions
2. `/Users/rpate/Desktop/caleoBot/src/index.ts` - No changes needed (already correct)

## Benefits

- Matches local `SimpleAgentService` architecture
- No duplicate authentication logic
- Consistent auth URL format (always via bot's `context.sendActivity()`)
- Edge function focuses only on AI processing
- Token refresh still handled automatically in edge function
- Cleaner separation of concerns: Bot = auth gate, Edge = AI processing

### To-dos

- [ ] Update edge function decryptToken() to handle hex-encoded BYTEA format and match local encryption handling
- [ ] Port token refresh logic from teams-sso-service to edge function with automatic refresh on expiration
- [ ] Add missing Graph API methods (token validation, meeting invitations, error handling) to EdgeGraphService
- [ ] Implement environment-specific table naming (Dev/Prod) in edge function to match local database service
- [ ] Enhance formatEventForDisplay with HTML stripping, token estimation, and proper timezone handling
- [ ] Configure edge function secrets (ENCRYPTION_KEY, MICROSOFT_APP_ID, MICROSOFT_APP_PASSWORD, etc.)
- [ ] Deploy updated edge function to Supabase caleo-extension project via MCP tools
- [ ] Test edge function with USE_EDGE_AGENT=true to verify identical functionality to local agent
- [ ] Update documentation with edge function implementation details and Chrome extension integration notes