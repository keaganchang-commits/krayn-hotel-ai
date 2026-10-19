import fs from 'fs';
import path from 'path';

const CONFIG_FILE = path.join(process.cwd(), '.autoreply_config.json');

export interface AutoReplyConfig {
  enabled: boolean;
  enabledAt: number | null; // Unix timestamp in seconds when toggled ON
  turboModeUntil?: number | null; // Unix timestamp in ms when 3-sec demo turbo mode expires
}

// In-memory fallback state for read-only serverless environments
let memoryConfig: AutoReplyConfig = {
  enabled: true,
  enabledAt: Math.floor(Date.now() / 1000),
  turboModeUntil: null,
};

/**
 * Get the current Auto-Reply configuration
 */
export function getAutoReplyConfig(): AutoReplyConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      memoryConfig = {
        enabled: !!data.enabled,
        enabledAt: data.enabledAt ?? memoryConfig.enabledAt,
        turboModeUntil: data.turboModeUntil ?? null,
      };
      return memoryConfig;
    }
  } catch (e) {
    // ignore read error
  }

  return memoryConfig;
}

/**
 * Save Auto-Reply configuration with graceful in-memory fallback on read-only systems
 */
export function saveAutoReplyConfig(config: AutoReplyConfig) {
  memoryConfig = { ...config };
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    // In serverless environments, file writing may fail silently; memoryConfig preserves the state
  }
}

/**
 * Toggle Auto-Reply state ON or OFF.
 * When toggled ON, enabledAt is updated to NOW so old emails are NEVER auto-replied to!
 */
export function setAutoReplyState(enabled: boolean): AutoReplyConfig {
  const current = getAutoReplyConfig();
  const nowInSeconds = Math.floor(Date.now() / 1000);

  const updated: AutoReplyConfig = {
    ...current,
    enabled,
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
