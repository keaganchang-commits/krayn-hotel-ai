import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';

const credPath = path.join(process.cwd(), 'credentials.json');
const tokenPath = path.join(process.cwd(), 'token.json');

const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const installed = credentials.installed;

const params = new URLSearchParams({
  client_id: installed.client_id,
  redirect_uri: 'http://localhost:8080',
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify',
  access_type: 'offline',
  prompt: 'consent'
});

const authUrl = `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;

console.log('\n================================================================');
console.log('CLICK THIS AUTHENTICATION LINK TO SIGN IN WITH YOUR NEW EMAIL:');
console.log(authUrl);
console.log('================================================================\n');

const server = http.createServer(async (req, res) => {
  const reqUrl = url.parse(req.url || '', true);
  if (reqUrl.query.code) {
    const code = reqUrl.query.code as string;
    
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: installed.client_id,
          client_secret: installed.client_secret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: 'http://localhost:8080',
        }),
      });

      const tokenData = await tokenRes.json();

      if (tokenData.access_token) {
        const tokenToSave = {
          token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_type: tokenData.token_type,
          scope: tokenData.scope,
          expiry: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
        };

        fs.writeFileSync(tokenPath, JSON.stringify(tokenToSave, null, 2));

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication Successful!</h1><p>Your new Gmail account is connected to Krayn AI. You can close this window now.</p>');
        console.log('\n[SUCCESS] New Gmail account tokens saved to token.json!');
        process.exit(0);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Authentication Failed</h1><pre>${JSON.stringify(tokenData, null, 2)}</pre>`);
      }
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h1>Server Error</h1><p>${err.message}</p>`);
    }
  }
});

server.listen(8080, () => {
  console.log('Waiting for authentication on http://localhost:8080...');
});
