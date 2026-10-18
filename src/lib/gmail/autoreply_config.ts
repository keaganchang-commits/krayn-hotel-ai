import fs from 'fs';
import path from 'path';

const CONFIG_FILE = path.join(process.cwd(), '.autoreply_config.json');

export interface AutoReplyConfig {
  enabled: boolean;
  enabledAt: number | null; // Unix timestamp in seconds when toggled ON
  turboModeUntil?: number | null; // Unix timestamp in ms when 3-sec demo turbo mode expires
}

/**
 * Get the current Auto-Reply configuration
 */
export function getAutoReplyConfig(): AutoReplyConfig {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return {
        enabled: !!data.enabled,
        enabledAt: data.enabledAt ?? null,
        turboModeUntil: data.turboModeUntil ?? null,
      };
    } catch (e) {
      // ignore JSON parse error
    }
  }

  // Default state: ON (enabled) with enabledAt set to current time
  const defaultConfig: AutoReplyConfig = {
    enabled: true,
    enabledAt: Math.floor(Date.now() / 1000),
  };
  saveAutoReplyConfig(defaultConfig);
  return defaultConfig;
}

/**
 * Save Auto-Reply configuration
 */
export function saveAutoReplyConfig(config: AutoReplyConfig) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Toggle Auto-Reply state ON or OFF.
 * When toggled ON, enabledAt is updated to NOW so old emails are NEVER auto-replied to!
 */
export function setAutoReplyState(enabled: boolean): AutoReplyConfig {
  const current = getAutoReplyConfig();
  const nowInSeconds = Math.floor(Date.now() / 1000);

  const updated: AutoReplyConfig = {
    enabled,
    // When turning ON, update enabledAt to current time so old emails are ignored!
    enabledAt: enabled ? nowInSeconds : current.enabledAt,
  };

  saveAutoReplyConfig(updated);
  return updated;
}

/**
 * Enable or disable 30-minute Demo Turbo Mode (scans every 3s).
 */
export function setTurboMode(enable: boolean, durationMinutes: number = 30): AutoReplyConfig {
  const current = getAutoReplyConfig();
  const now = Date.now();

  const updated: AutoReplyConfig = {
    ...current,
    turboModeUntil: enable ? now + durationMinutes * 60 * 1000 : null,
  };

  saveAutoReplyConfig(updated);
  return updated;
}
