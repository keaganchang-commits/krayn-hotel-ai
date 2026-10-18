import fs from 'fs';
import path from 'path';

export interface OAuthCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

/**
 * Reads local credentials.json and token.json to get active OAuth tokens
 */
export function getStoredOAuthTokens(): { credentials?: any; token?: any } {
  const rootDir = process.cwd();
  const credPath = path.join(rootDir, 'credentials.json');
  const tokenPath = path.join(rootDir, 'token.json');

  let credentials, token;

  if (fs.existsSync(credPath)) {
    try {
      credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    } catch (e) {
      console.error('Error reading credentials.json:', e);
    }
  }

  if (fs.existsSync(tokenPath)) {
    try {
      token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    } catch (e) {
      console.error('Error reading token.json:', e);
    }
  }

  return { credentials, token };
}

/**
 * Refresh OAuth access token using refresh_token if needed
 */
export async function getValidAccessToken(): Promise<string | null> {
  const { credentials, token } = getStoredOAuthTokens();

  if (!token || !token.token) {
    if (!token?.refresh_token) {
      console.warn('No active OAuth token found.');
      return null;
    }
  }

  // If token is valid, return it
  if (token.token && (!token.expiry || new Date(token.expiry) > new Date())) {
    return token.token;
  }

  // Refresh token using Google OAuth endpoint
  if (token.refresh_token && credentials?.installed) {
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: credentials.installed.client_id,
          client_secret: credentials.installed.client_secret,
          refresh_token: token.refresh_token,
          grant_type: 'refresh_token',
        }),
      });

      const data = await res.json();
      if (data.access_token) {
        // Update token.json
        const updatedToken = {
          ...token,
          token: data.access_token,
          expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
        };
        fs.writeFileSync(path.join(process.cwd(), 'token.json'), JSON.stringify(updatedToken, null, 2));
        return data.access_token;
      }
    } catch (err) {
      console.error('Failed to refresh access token:', err);
    }
  }

  return token.token || null;
}
