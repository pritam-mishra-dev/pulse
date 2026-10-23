// Toggle shortcut, settings migration on install/update, and the "off" badge.
import { SETTINGS_KEY, loadSettings, migrate, onSettingsChanged, updateSettings, type Settings } from '../shared/settings';

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-pulse') return;
  const s = await loadSettings();
  await updateSettings({ enabled: !s.enabled });
});

chrome.runtime.onInstalled.addListener(async () => {
  // Bring whatever an older version stored up to the current schema (or write defaults).
  const next = migrate((await chrome.storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY]);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  await badge(next);
});
chrome.runtime.onStartup.addListener(async () => badge(await loadSettings()));
onSettingsChanged((s) => void badge(s));

async function badge(s: Settings) {
  await chrome.action.setBadgeText({ text: s.enabled ? '' : 'off' });
  await chrome.action.setBadgeBackgroundColor({ color: '#3a3a3a' });
}
