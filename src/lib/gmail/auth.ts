import fs from 'fs';
import path from 'path';

export interface OAuthCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

let inMemoryToken: any = null;

/**
 * Reads OAuth tokens from Environment Variables first (for Vercel deployment),
 * falling back to local credentials.json and token.json files.
 */
export function getStoredOAuthTokens(): { credentials?: any; token?: any } {
  // 1. Check environment variables (recommended for Vercel)
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
    const credentials = {
      installed: {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
      },
    };
    const token = inMemoryToken || {
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      token: process.env.GOOGLE_ACCESS_TOKEN || null,
      expiry: process.env.GOOGLE_TOKEN_EXPIRY || null,
    };
    return { credentials, token };
  }

  // 2. Check GMAIL_CREDENTIALS_JSON / GMAIL_TOKEN_JSON environment variables
  if (process.env.GMAIL_CREDENTIALS_JSON && process.env.GMAIL_TOKEN_JSON) {
    try {
      const credentials = JSON.parse(process.env.GMAIL_CREDENTIALS_JSON);
      const token = inMemoryToken || JSON.parse(process.env.GMAIL_TOKEN_JSON);
      return { credentials, token };
    } catch (e) {
      console.error('Error parsing GMAIL_CREDENTIALS_JSON or GMAIL_TOKEN_JSON env:', e);
    }
  }

  // 3. Fallback to local files on disk (for local development)
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
      token = inMemoryToken || JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
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

  if (!token || (!token.token && !token.refresh_token)) {
    console.warn('No active OAuth token found.');
    return null;
  }

  // If token is valid and not expired, return it
  if (token.token && (!token.expiry || new Date(token.expiry).getTime() > Date.now() + 60000)) {
    return token.token;
  }

  const clientId = credentials?.installed?.client_id || credentials?.web?.client_id || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = credentials?.installed?.client_secret || credentials?.web?.client_secret || process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = token?.refresh_token || process.env.GOOGLE_REFRESH_TOKEN;

  // Refresh token using Google OAuth endpoint
  if (refreshToken && clientId && clientSecret) {
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      const data = await res.json();
      if (data.access_token) {
        const updatedToken = {
          ...token,
          token: data.access_token,
          expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
        };
        inMemoryToken = updatedToken;
        try {
          fs.writeFileSync(path.join(process.cwd(), 'token.json'), JSON.stringify(updatedToken, null, 2));
        } catch {}
        return data.access_token;
      } else {
        console.error('Google token refresh returned error:', data);
      }
    } catch (err) {
      console.error('Failed to refresh access token:', err);
    }
  }

  return token.token || null;
}
