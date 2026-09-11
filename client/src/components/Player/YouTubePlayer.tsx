import { useEffect, useRef } from 'react';
import { Box } from '@chakra-ui/react';
import { loadYouTubeApi, type YTPlayer } from '@/lib/youtube/iframeApi';

interface Props {
  videoId: string;
  onReady?: (player: YTPlayer) => void;
  onStateChange?: (state: number) => void;
  onError?: (message: string) => void;
}

/**
 * Thin mount for the IFrame player. Owns creation and teardown; every timing decision is made by
 * VirtualClock, which this simply feeds.
 */
export function YouTubePlayer({ videoId, onReady, onStateChange, onError }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);

  // Callbacks live in refs so a re-render never tears down and rebuilds the player — remounting
  // the iframe mid-song would restart playback.
  const handlers = useRef({ onReady, onStateChange, onError });
  handlers.current = { onReady, onStateChange, onError };

  useEffect(() => {
    let cancelled = false;

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return;

        playerRef.current = new YT.Player(hostRef.current, {
          videoId,
          playerVars: {
            // Keep YouTube's own chrome out of the way; the game supplies its own controls.
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
          },
          events: {
            onReady: (event: { target: YTPlayer }) => handlers.current.onReady?.(event.target),
            onStateChange: (event: { data: number }) =>
              handlers.current.onStateChange?.(event.data),
            onError: () =>
              handlers.current.onError?.(
                'This video cannot be played here — embedding may be disabled by the uploader. Try another.',
              ),
          },
        });
      })
      .catch((error: Error) => {
        if (!cancelled) handlers.current.onError?.(error.message);
      });

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId]);

  return (
    <Box
      width="100%"
      aspectRatio={16 / 9}
      bg="black"
      borderRadius="md"
      overflow="hidden"
      css={{ '& iframe': { width: '100%', height: '100%', border: 0 } }}
    >
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
    </Box>
  );
}
