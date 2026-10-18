import { getValidAccessToken } from './auth';

/**
 * Register Gmail Push Notifications (users.watch)
 * Instructs Gmail to publish an event to Google Cloud Pub/Sub whenever an email arrives or changes.
 *
 * @param topicName e.g. "projects/my-gcp-project/topics/gmail-notifications"
 */
export async function setupGmailWatch(topicName: string): Promise<{ success: boolean; historyId?: string; expiration?: string; error?: string }> {
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    return { success: false, error: 'No valid Gmail access token available.' };
  }

  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topicName,
        labelIds: ['INBOX'],
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { success: false, error: data.error?.message || 'Failed to register Gmail watch.' };
    }

    return {
      success: true,
      historyId: data.historyId,
      expiration: data.expiration,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Error executing Gmail watch request.' };
  }
}

/**
 * Stop Gmail Push Notifications (users.stop)
 */
export async function stopGmailWatch(): Promise<{ success: boolean; error?: string }> {
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    return { success: false, error: 'No valid Gmail access token available.' };
  }

  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/stop', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error?.message || 'Failed to stop Gmail watch.' };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Error executing Gmail stop request.' };
  }
}
