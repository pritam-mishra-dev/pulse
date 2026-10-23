// Finds the player the user is watching on youtube.com or music.youtube.com.
// YouTube reuses, swaps and relocates its <video> during SPA navigation, so
// this is re-run on navigation events, on mutations, and on a slow poll.

import { SEL, queryFirst } from './selectors';

export type Site = 'youtube' | 'music';
export type PlayerKind = 'watch' | 'shorts' | 'miniplayer' | 'music';

export interface PlayerTarget {
  site: Site;
  kind: PlayerKind;
  /** The element the visualizer frames. */
  player: HTMLElement;
  video: HTMLVideoElement;
}

export function currentSite(): Site | null {
  const h = location.hostname;
  if (h === 'music.youtube.com') return 'music';
  if (h === 'www.youtube.com' || h === 'youtube.com' || h === 'm.youtube.com') return 'youtube';
  return null;
}

export function locatePlayer(site: Site): PlayerTarget | null {
  if (site === 'music') {
    const player = queryFirst<HTMLElement>(SEL.music.player);
    const video = player?.querySelector<HTMLVideoElement>(SEL.music.video);
    return player && video ? { site, kind: 'music', player, video } : null;
  }
  const path = location.pathname;
  if (path.startsWith('/shorts/')) {
    const player = queryFirst<HTMLElement>(SEL.youtube.shortsPlayer);
    const video = player?.querySelector<HTMLVideoElement>(SEL.youtube.video);
    return player && video ? { site, kind: 'shorts', player, video } : null;
  }
  const player = queryFirst<HTMLElement>(SEL.youtube.watchPlayer);
  const video = player?.querySelector<HTMLVideoElement>(SEL.youtube.video);
  if (!player || !video) return null;
  if (path === '/watch') return { site, kind: 'watch', player, video };
  // Off /watch, the old player stays in the DOM, hidden; only a visible miniplayer counts.
  const r = player.getBoundingClientRect();
  if (player.closest(SEL.youtube.miniplayerHost) && r.width > 0 && r.height > 0) {
    return { site, kind: 'miniplayer', player, video };
  }
  return null;
}
