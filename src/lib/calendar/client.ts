import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { getValidAccessToken } from '../gmail/auth';
import { getDiningCalendarConfig } from './config';

/**
 * Returns an authenticated Google Calendar API client.
 * Prioritizes Service Account (server-to-server zero prompt) if `service-account.json` exists.
 * Falls back seamlessly to OAuth2 access token if configured.
 */
export async function getGoogleCalendarClient() {
  const config = getDiningCalendarConfig();
  const rootDir = process.cwd();
  
  // 1. Try Service Account key file if provided
  const saPath = path.join(process.cwd(), 'service-account.json');

  if (fs.existsSync(saPath)) {
    try {
      const saKey = JSON.parse(fs.readFileSync(saPath, 'utf8'));
      if (saKey.client_email && saKey.private_key) {
        const auth = new google.auth.JWT({
          email: saKey.client_email,
          key: saKey.private_key,
          scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'],
        });
        await auth.authorize();
        return {
          calendar: google.calendar({ version: 'v3', auth }),
          authType: 'service_account' as const,
          email: saKey.client_email,
        };
      }
    } catch (err) {
      console.warn('[Calendar Auth] Service Account auth failed, trying OAuth fallback:', err);
    }
  }

  // 2. Fallback to existing OAuth access token
  const oauthToken = await getValidAccessToken();
  if (oauthToken) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: oauthToken });
    return {
      calendar: google.calendar({ version: 'v3', auth: oauth2Client }),
      authType: 'oauth' as const,
      email: 'oauth_user',
    };
  }

  return null;
}
