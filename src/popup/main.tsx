// Phase-1 placeholder popup: master switch + debug graph toggle. The full UI lands in phase 4.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { loadSettings, onSettingsChanged, updateSettings, type Settings } from '../shared/settings';

function App() {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    void loadSettings().then(setS);
    return onSettingsChanged(setS);
  }, []);
  if (!s) return null;
  const row = (label: string, on: boolean, patch: Partial<Settings>) => (
    <label style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
      {label}
      <input type="checkbox" checked={on} onChange={() => void updateSettings(patch)} />
    </label>
  );
  return (
    <div style={{ padding: '14px 16px' }}>
      <strong style={{ fontSize: '15px' }}>Pulse</strong> <small style={{ opacity: 0.6 }}>phase 1 · audio pipeline</small>
      {row('Enabled', s.enabled, { enabled: !s.enabled })}
      {row('Debug graph', s.debugGraph, { debugGraph: !s.debugGraph })}
    </div>
  );
}
render(<App />, document.getElementById('app')!);
