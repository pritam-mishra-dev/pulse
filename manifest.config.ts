import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

const icons = { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' };

export default defineManifest({
  manifest_version: 3,
  name: 'Pulse — Audio Visualizer for YouTube',
  short_name: 'Pulse',
  version: pkg.version,
  description: 'Glowing RGB spikes that pulse to the music around the YouTube player.',
  minimum_chrome_version: '121',
  icons,
  action: { default_popup: 'src/popup/index.html', default_title: 'Pulse', default_icon: icons },
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  content_scripts: [
    {
      // Covers www. and music.; embeds on other sites are out of scope (top frame only).
      matches: ['*://*.youtube.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  permissions: ['storage'],
  host_permissions: ['*://*.youtube.com/*'],
  commands: {
    'toggle-pulse': {
      // MacCtrl = the physical Control key; Cmd+Shift+P is taken by Chrome on macOS.
      suggested_key: { default: 'Alt+Shift+P', mac: 'MacCtrl+Shift+P' },
      description: 'Toggle Pulse on/off',
    },
  },
});
