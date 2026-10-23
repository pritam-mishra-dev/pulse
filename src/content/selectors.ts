// Every YouTube / YouTube Music selector lives here. Lists are tried in
// order, and an invalid or stale entry is skipped rather than thrown.

export const SEL = {
  youtube: {
    watchPlayer: '#movie_player',
    shortsPlayer: '#shorts-player',
    video: 'video.html5-main-video',
    miniplayerHost: 'ytd-miniplayer',
  },
  music: {
    player: ['ytmusic-player #movie_player', 'ytmusic-player'],
    video: 'video',
  },
  adShowingClass: 'ad-showing',
} as const;

export function queryFirst<T extends Element = Element>(selectors: string | readonly string[], root: ParentNode = document): T | null {
  for (const s of typeof selectors === 'string' ? [selectors] : selectors) {
    try {
      const el = root.querySelector<T>(s);
      if (el) return el;
    } catch {
      // invalid selector — skip
    }
  }
  return null;
}
