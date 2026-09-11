/**
 * Loader for the YouTube IFrame Player API.
 *
 * The API is used raw rather than through a React wrapper on purpose: VirtualClock depends on
 * `onStateChange` arriving with as little delay and indirection as possible, since buffering and
 * seek events are exactly what trigger a resync. An abstraction there costs precision for
 * convenience we don't need.
 */

export interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (element: HTMLElement | string, config: unknown) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loader: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (loader) return loader;

  loader = new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    // The API calls this global once it has finished initializing. Chain any existing handler so
    // we never clobber another consumer's callback.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube IFrame API loaded but exposed no Player.'));
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('Could not load the YouTube IFrame API.'));
    document.head.appendChild(script);
  });

  return loader;
}
