import * as dotenv from 'dotenv';
import TeamsSSOService from './teams-sso-service';

// Load environment variables
dotenv.config();

interface CalendarEvent {
    subject: string;
    start: {
        dateTime: string;
        timeZone: string;
    };
    end: {
        dateTime: string;
        timeZone: string;
    };
    attendees?: Array<{
        emailAddress: {
            address: string;
            name: string;
        };
        type: string;
        status?: {
            response: string;
        };
        optional?: boolean;
    }>;
    body?: {
        contentType: string;
        content: string;
    };
    location?: {
        displayName: string;
    };
}

interface GraphResponse<T> {
    data: T;
    success: boolean;
    error?: string;
    authUrl?: string;
}

class GraphService {
    private baseUrl: string = 'https://graph.microsoft.com/v1.0';
    private tenantId: string;
    private teamsSSO: TeamsSSOService;

    constructor(teamsSSO?: TeamsSSOService) {
        this.tenantId = process.env.MICROSOFT_TENANT_ID || '82ee4c80-a9cb-455b-95f4-d2168dfed70a';
        this.teamsSSO = teamsSSO || new TeamsSSOService();
    }

    /**
     * Get calendar events for a specific time range using Teams SSO
     */
    async getCalendarEvents(userContext: any, startTime: string, endTime: string): Promise<GraphResponse<CalendarEvent[]>> {
        try {
            console.log(`📅 Getting calendar events for user: ${userContext.name} (${userContext.email})`);
            
            // Check if user is authenticated with Teams SSO
            const authStatus = await this.teamsSSO.getAuthStatus(userContext);
            
            if (!authStatus.authenticated) {
                console.log('⚠️  User not authenticated with Teams SSO');
                return { 
                    data: [], 
                    success: false, 
                    error: 'User not authenticated. Please complete Teams SSO authentication.',
                    authUrl: authStatus.authUrl
                };
            }

            // Get access token from Teams SSO
            const accessToken = await this.teamsSSO.getAccessToken(userContext);
            if (!accessToken) {
                console.log('❌ Failed to get access token from Teams SSO');
                // Get authentication URL for re-authentication
                const authStatus = await this.teamsSSO.getAuthStatus(userContext);
                return { 
                    data: [], 
                    success: false, 
                    error: 'Failed to get access token from Teams SSO',
                    authUrl: authStatus.authUrl
                };
            }

            const startParam = encodeURIComponent(startTime);
            const endParam = encodeURIComponent(endTime);
            
            // Use /me endpoint for Teams SSO (user-specific access)
            const url = `${this.baseUrl}/me/calendar/events?startDateTime=${startParam}&endDateTime=${endParam}`;
            console.log(`📅 Accessing calendar with Teams SSO: ${url}`);

            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Calendar access failed: ${response.status} ${response.statusText}`);
                console.error(`Error details: ${errorText}`);
                
                return { 
                    data: [], 
                    success: false, 
                    error: `Graph API error: ${response.status} - ${response.statusText}` 
                };
            }

            const data = await response.json() as { value: CalendarEvent[] };
            console.log(`✅ Successfully retrieved ${data.value.length} calendar events using Teams SSO`);
            
            // Log raw data for debugging
            console.log('🔍 RAW GRAPH API RESPONSE:');
            console.log(JSON.stringify(data, null, 2));
            
            // Log detailed attendee information
            data.value.forEach((event, index) => {
                console.log(`📅 Event ${index + 1}: ${event.subject}`);
                // Convert UTC times to Central Time for display
                // Fix: Convert Graph API time format to proper UTC format
                const startTime = event.start?.dateTime ? 
                    new Date(event.start.dateTime.replace(/\.\d{7}/, '.000Z')).toLocaleString('en-US', { 
                        timeZone: 'America/Chicago',
                        weekday: 'short',
                        month: 'short', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZoneName: 'short'
                    }) : 'Unknown';
                const endTime = event.end?.dateTime ? 
                    new Date(event.end.dateTime.replace(/\.\d{7}/, '.000Z')).toLocaleString('en-US', { 
                        timeZone: 'America/Chicago',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZoneName: 'short'
                    }) : 'Unknown';
                console.log(`   Start: ${startTime}`);
                console.log(`   End: ${endTime}`);
                console.log(`   Attendees: ${event.attendees?.length || 0}`);
                if (event.attendees && event.attendees.length > 0) {
                    event.attendees.forEach((attendee, attendeeIndex) => {
                        console.log(`     Attendee ${attendeeIndex + 1}:`);
                        console.log(`       Name: ${attendee.emailAddress?.name || 'N/A'}`);
                        console.log(`       Email: ${attendee.emailAddress?.address || 'N/A'}`);
                        console.log(`       Type: ${attendee.type || 'N/A'}`);
                        console.log(`       Status: ${attendee.status?.response || 'N/A'}`);
                        console.log(`       Optional: ${attendee.optional || false}`);
                    });
                }
            });
            
            return { data: data.value, success: true };
        } catch (error) {
            console.error('Error getting calendar events:', error);
            return { 
                data: [], 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            };
        }
    }

    /**
     * Create a new calendar meeting
     */
    async createMeeting(userContext: any, meetingData: any): Promise<GraphResponse<any>> {
        try {
            console.log(`📅 Creating meeting: ${meetingData.subject}`);
            
            // Check if user is authenticated with Teams SSO
            const authStatus = await this.teamsSSO.getAuthStatus(userContext);
            
            if (!authStatus.authenticated) {
                console.log('⚠️  User not authenticated with Teams SSO');
                return { 
                    data: null, 
                    success: false, 
                    error: 'User not authenticated. Please complete Teams SSO authentication.',
                    authUrl: authStatus.authUrl
                };
            }

            // Get access token from Teams SSO
            const accessToken = await this.teamsSSO.getAccessToken(userContext);
            if (!accessToken) {
                console.log('❌ Failed to get access token from Teams SSO');
                return { 
                    data: null, 
                    success: false, 
                    error: 'Failed to get access token from Teams SSO' 
                };
            }

            const url = `${this.baseUrl}/me/calendar/events`;
            console.log(`📅 Creating meeting via Graph API: ${url}`);
            console.log(`📅 Meeting data being sent:`, JSON.stringify(meetingData, null, 2));

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(meetingData)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Meeting creation failed: ${response.status} ${response.statusText}`);
                console.error(`Error details: ${errorText}`);
                
                return { 
                    data: null, 
                    success: false, 
                    error: `Graph API error: ${response.status} - ${response.statusText}` 
                };
            }

            const data = await response.json() as any;
            console.log(`✅ Successfully created meeting: ${data.subject}`);
            console.log(`📅 Meeting creation response:`, JSON.stringify(data, null, 2));
            console.log(`📅 Attendees in response:`, data.attendees?.map((a: any) => ({
              email: a.emailAddress?.address,
              type: a.type,
              status: a.status?.response
            })));
            
            // Send invitations to attendees if there are any
            if (data.attendees && data.attendees.length > 0) {
                console.log(`📧 Sending invitations to ${data.attendees.length} attendees...`);
                await this.sendMeetingInvitations(userContext, data.id, accessToken);
            }
            
            return { data, success: true };
        } catch (error) {
            console.error('Error creating meeting:', error);
            return { 
                data: null, 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            };
        }
    }

    /**
     * Send meeting invitations to attendees
     */
    private async sendMeetingInvitations(userContext: any, meetingId: string, accessToken: string): Promise<void> {
        try {
            // Try the send action on the event
            const url = `${this.baseUrl}/me/calendar/events/${meetingId}/send`;
            console.log(`📧 Sending invitations via: ${url}`);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Failed to send invitations: ${response.status} ${response.statusText}`);
                console.error(`Error details: ${errorText}`);
                
                // Try alternative approach - update the event to trigger invitations
                console.log(`📧 Trying alternative approach - updating event to trigger invitations...`);
                await this.triggerInvitationsByUpdate(userContext, meetingId, accessToken);
            } else {
                console.log(`✅ Invitations sent successfully to all attendees`);
            }
        } catch (error) {
            console.error('❌ Error sending invitations:', error);
        }
    }

    private async triggerInvitationsByUpdate(userContext: any, meetingId: string, accessToken: string): Promise<void> {
        try {
            const url = `${this.baseUrl}/me/calendar/events/${meetingId}`;
            console.log(`📧 Triggering invitations via update: ${url}`);

            // Send a minimal update to trigger invitation sending
            const updateData = {
                responseRequested: true
            };

            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Failed to trigger invitations via update: ${response.status} ${response.statusText}`);
                console.error(`Error details: ${errorText}`);
            } else {
                console.log(`✅ Invitations triggered via update`);
            }
        } catch (error) {
            console.error('❌ Error triggering invitations via update:', error);
        }
    }

    /**
     * Update an existing calendar meeting
     */
    async updateMeeting(userContext: any, meetingId: string, updateData: any): Promise<GraphResponse<any>> {
        try {
            console.log(`📅 Updating meeting: ${meetingId}`);
            
            // Check if user is authenticated with Teams SSO
            const authStatus = await this.teamsSSO.getAuthStatus(userContext);
            
            if (!authStatus.authenticated) {
                console.log('⚠️  User not authenticated with Teams SSO');
                return { 
                    data: null, 
                    success: false, 
                    error: 'User not authenticated. Please complete Teams SSO authentication.',
                    authUrl: authStatus.authUrl
                };
            }

            // Get access token from Teams SSO
            const accessToken = await this.teamsSSO.getAccessToken(userContext);
            if (!accessToken) {
                console.log('❌ Failed to get access token from Teams SSO');
                return { 
                    data: null, 
                    success: false, 
                    error: 'Failed to get access token from Teams SSO' 
                };
            }

            const url = `${this.baseUrl}/me/calendar/events/${meetingId}`;
            console.log(`📅 Updating meeting via Graph API: ${url}`);

            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Meeting update failed: ${response.status} ${response.statusText}`);
                console.error(`Error details: ${errorText}`);
                
                return { 
                    data: null, 
                    success: false, 
                    error: `Graph API error: ${response.status} - ${response.statusText}` 
                };
            }

            const data = await response.json() as any;
            console.log(`✅ Successfully updated meeting: ${data.subject}`);
            
            return { data, success: true };
        } catch (error) {
            console.error('Error updating meeting:', error);
            return { 
                data: null, 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            };
        }
    }

    /**
     * Delete a calendar meeting
     */
    async deleteMeeting(userContext: any, meetingId: string): Promise<GraphResponse<boolean>> {
        try {
            console.log(`📅 Deleting meeting: ${meetingId}`);
            
            // Check if user is authenticated with Teams SSO
            const authStatus = await this.teamsSSO.getAuthStatus(userContext);
            
            if (!authStatus.authenticated) {
                console.log('⚠️  User not authenticated with Teams SSO');
                return { 
                    data: false, 
                    success: false, 
                    error: 'User not authenticated. Please complete Teams SSO authentication.',
                    authUrl: authStatus.authUrl
                };
            }

            // Get access token from Teams SSO
            const accessToken = await this.teamsSSO.getAccessToken(userContext);
            if (!accessToken) {
                console.log('❌ Failed to get access token from Teams SSO');
                return { 
                    data: false, 
                    success: false, 
                    error: 'Failed to get access token from Teams SSO' 
                };
            }

            const url = `${this.baseUrl}/me/calendar/events/${meetingId}`;
            console.log(`📅 Deleting meeting via Graph API: ${url}`);

            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Meeting deletion failed: ${response.status} ${response.statusText}`);
                console.error(`Error details: ${errorText}`);
                
                return { 
                    data: false, 
                    success: false, 
                    error: `Graph API error: ${response.status} - ${response.statusText}` 
                };
            }

            console.log(`✅ Successfully deleted meeting: ${meetingId}`);
            
            return { data: true, success: true };
        } catch (error) {
            console.error('Error deleting meeting:', error);
            return { 
                data: false, 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            };
        }
    }

    /**
     * Check availability for a specific time range
     */
    async checkAvailability(userContext: any, startTime: string, endTime: string, attendees?: string[]): Promise<GraphResponse<any>> {
        try {
            console.log(`📅 Checking availability from ${startTime} to ${endTime}`);
            
            // Check if user is authenticated with Teams SSO
            const authStatus = await this.teamsSSO.getAuthStatus(userContext);
            
            if (!authStatus.authenticated) {
                console.log('⚠️  User not authenticated with Teams SSO');
                return { 
                    data: null, 
                    success: false, 
                    error: 'User not authenticated. Please complete Teams SSO authentication.',
                    authUrl: authStatus.authUrl
                };
            }

            // Get access token from Teams SSO
            const accessToken = await this.teamsSSO.getAccessToken(userContext);
            if (!accessToken) {
                console.log('❌ Failed to get access token from Teams SSO');
                return { 
                    data: null, 
                    success: false, 
                    error: 'Failed to get access token from Teams SSO' 
                };
            }

            // For now, we'll do a simple check by getting events in the time range
            // In a real implementation, you'd use the findMeetingTimes API
            const result = await this.getCalendarEvents(userContext, startTime, endTime);
            
            if (!result.success) {
                return result;
            }

            const conflicts = result.data || [];
            const available = conflicts.length === 0;
            
            console.log(`✅ Availability check complete: ${available ? 'Available' : 'Conflicts found'}`);
            
            return { 
                data: { 
                    available, 
                    conflicts: conflicts.map(event => ({
                        subject: event.subject,
                        start: event.start,
                        end: event.end
                    }))
                }, 
                success: true 
            };
        } catch (error) {
            console.error('Error checking availability:', error);
            return { 
                data: null, 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            };
        }
    }

    /**
     * Test the Graph service connection with Teams SSO
     */
    async testConnection(): Promise<boolean> {
        try {
            console.log('🧪 Testing Teams SSO Graph service...');
            
            // Test Teams SSO service
            const ssoTest = await this.teamsSSO.testConnection();
            if (!ssoTest) {
                console.log('❌ Teams SSO service test failed');
                return false;
            }

            console.log('✅ Teams SSO service configured and ready');
            console.log('✅ Graph service ready for Teams SSO authentication');
            console.log('ℹ️  Note: Calendar access requires user authentication via Teams SSO');
            
            return true;
        } catch (error) {
            console.error('❌ Teams SSO Graph service test failed:', error);
            return false;
        }
    }
}

export default GraphService;
