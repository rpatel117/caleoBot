# Caleo Bot - Current State

**Last Updated:** September 30, 2025  
**Status:** 🟡 PARTIALLY WORKING - Authentication Issues Persist

## 🎯 **Current Functionality**

### ✅ **Working Features**
- **Bot Framework Integration**: Successfully connects to Microsoft Teams
- **AI Service**: OpenAI integration working with `gpt-4o-mini` model
- **Basic Message Processing**: Handles general conversations via AI
- **Teams SSO Authentication**: OAuth flow completes successfully
- **Calendar Data Retrieval**: Can fetch calendar events when authenticated
- **Smart Message Routing**: Distinguishes between direct calendar commands and conversational queries

### ❌ **Critical Issues**

#### 1. **Token Persistence Problem** 
- **Issue**: Authentication tokens are stored but immediately lost between requests
- **Symptoms**: 
  - User authenticates successfully
  - Next calendar request requires re-authentication
  - Tokens stored in one request, empty in the next
- **Root Cause**: Multiple `TeamsSSOService` instances being created
- **Impact**: Users must re-authenticate for every calendar request

#### 2. **Calendar Detection Still Too Broad**
- **Issue**: Some conversational queries still trigger calendar detection
- **Examples**: "Look at my calendar, there is a meeting tomorrow and I want to see who is invited to it"
- **Impact**: Users get authentication prompts instead of AI responses with calendar context

## 🔧 **Technical Architecture**

### **Core Services**
- **AIService** (`ai-service.ts`): OpenAI integration with `gpt-4o-mini`
- **TeamsSSOService** (`teams-sso-service.ts`): OAuth authentication management
- **GraphService** (`graph-service-teams-sso.ts`): Microsoft Graph API integration
- **Main Bot** (`index.ts`): Message routing and orchestration

### **Message Flow**
1. **Message Received** → Teams Bot Framework
2. **Calendar Detection** → Regex pattern matching
3. **Authentication Check** → TeamsSSOService
4. **Route Decision**:
   - **Direct Calendar Commands** → GraphService → Calendar Display
   - **Conversational Queries** → AIService with Calendar Context
   - **General Chat** → AIService

### **Authentication Flow**
1. User sends calendar request
2. Bot checks authentication status
3. If not authenticated → OAuth URL provided
4. User completes OAuth → Token stored
5. **PROBLEM**: Token lost between requests

## 🐛 **Known Bugs**

### **Bug #1: Token Storage Issue**
```typescript
// Problem: Multiple TeamsSSOService instances
const teamsSSO = new TeamsSSOService(); // In index.ts
this.teamsSSO = new TeamsSSOService(); // In GraphService constructor
```
**Status**: 🔴 Not Fixed - Still investigating root cause

### **Bug #2: Calendar Detection Regex**
```typescript
// Current regex still catches some conversational queries
const isCalendarRequest = /^(view|show|check|see|display|get).*calendar$|^calendar$|^(schedule|book|create|add).*(meeting|appointment|event)$|^(check|show).*availability$|^(what|when).*meetings.*do.*i.*have$|^upcoming.*(meeting|appointment|event)$|^(show|view|display).*more.*calendar.*details$/i.test(messageText);
```
**Status**: 🟡 Partially Fixed - Still needs refinement

## 📊 **Performance Metrics**

### **Authentication Success Rate**
- **OAuth Completion**: 100% (when user follows through)
- **Token Persistence**: 0% (tokens lost between requests)
- **Calendar Access**: 0% (due to token loss)

### **Message Processing**
- **AI Responses**: 100% working
- **Calendar Detection Accuracy**: ~80% (some false positives)
- **Calendar Context Integration**: 0% (due to authentication issues)

## 🎯 **Immediate Next Steps**

### **Priority 1: Fix Token Persistence**
1. **Investigate Service Instances**: Ensure single TeamsSSOService instance
2. **Debug Token Storage**: Add more detailed logging
3. **Test Token Retrieval**: Verify tokens persist across requests

### **Priority 2: Refine Calendar Detection**
1. **Test Edge Cases**: "Look at my calendar, there is a meeting tomorrow..."
2. **Improve Regex**: Make detection more specific
3. **Add Fallback Logic**: Better handling of ambiguous queries

### **Priority 3: Calendar Context Integration**
1. **Fix Authentication**: Must resolve token persistence first
2. **Test AI Context**: Verify calendar data reaches AI service
3. **Improve Responses**: Ensure AI can answer calendar questions intelligently

## 🔍 **Debugging Information**

### **Current Logs Show**
```
🔍 Stored user tokens: []  // Empty after authentication
🔍 User token found: NO    // Token lost
🔍 Is authenticated: false // Re-authentication required
```

### **Expected Behavior**
```
🔍 Stored user tokens: ['29:1q7njbwSo6zo1Exq2EjC7AnP_esKuGM3VJuEQMdPMyY-lSAqbMK7nEsWdouPFy_hmZH9ECQpNfbWu-Dn0jgLvsw']
🔍 User token found: YES
🔍 Is authenticated: true
```

## 📁 **File Organization**

### **Documentation Moved to `/notes/`**
- `AZURE_PERMISSIONS_CHECKLIST.md`
- `CALENDAR_INTEGRATION.md`
- `CALENDAR_PERMISSION_ANALYSIS.md`
- `PERMISSION_DEBUG.md`
- `PERMISSION_SOLUTION.md`
- `PERMISSIONS_TEST.md`
- `TEAMS_SSO_IMPLEMENTATION.md`
- `TROUBLESHOOTING_GUIDE.md`
- `TROUBLESHOOTING.md`

### **Core Files**
- `src/index.ts` - Main bot logic
- `src/ai-service.ts` - OpenAI integration
- `src/teams-sso-service.ts` - Authentication
- `src/graph-service-teams-sso.ts` - Calendar operations
- `README.md` - Project overview

## 🚀 **Success Criteria**

### **For Full Functionality**
1. ✅ User authenticates once
2. ✅ Tokens persist across requests
3. ✅ Calendar access works without re-authentication
4. ✅ AI can answer calendar questions with context
5. ✅ Smart routing between direct commands and conversational queries

### **Current Status**
- **Authentication**: 🔴 Broken (token persistence)
- **Calendar Access**: 🔴 Broken (due to auth)
- **AI Integration**: ✅ Working
- **Message Routing**: 🟡 Partially working
- **Documentation**: ✅ Complete

---

**Next Action**: Focus on debugging the token persistence issue by ensuring single service instance and adding comprehensive logging to track token lifecycle.
