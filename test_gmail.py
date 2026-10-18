import os
import sys
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Scopes needed for testing (read, send & modify access)
SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify'
]

def main():
    creds = None
    # token.json stores the user's access and refresh tokens
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    
    # If there are no (valid) credentials available, prompt user to log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists('credentials.json'):
                print("Error: credentials.json not found in the current directory.")
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            print("\nPlease open the authentication link in your browser to sign in:")
            creds = flow.run_local_server(port=8080, open_browser=True)
        
        # Save credentials for future runs
        with open('token.json', 'w') as token:
            token.write(creds.to_json())

    # Build Gmail service API
    service = build('gmail', 'v1', credentials=creds)

    print("\n--- Gmail API Connection Successful ---")
    
    # Fetch user profile
    profile = service.users().getProfile(userId='me').execute()
    print(f"Connected Account: {profile['emailAddress']}")
    print(f"Total Messages: {profile['messagesTotal']}")
    print(f"Total Threads: {profile['threadsTotal']}")

    # Fetch 5 most recent email subjects
    results = service.users().messages().list(userId='me', maxResults=5).execute()
    messages = results.get('messages', [])

    if not messages:
        print("No messages found.")
    else:
        print("\nRecent 5 Emails:")
        for msg in messages:
            msg_detail = service.users().messages().get(userId='me', id=msg['id'], format='full').execute()
            headers = msg_detail['payload']['headers']
            subject = next((h['value'] for h in headers if h['name'].lower() == 'subject'), '(No Subject)')
            sender = next((h['value'] for h in headers if h['name'].lower() == 'from'), '(Unknown Sender)')
            print(f"- [{sender}] {subject}")

if __name__ == '__main__':
    main()
