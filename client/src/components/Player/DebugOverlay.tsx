import { useEffect, useState } from 'react';
import { Box } from '@chakra-ui/react';
import type { VirtualClock } from '@/lib/timing/VirtualClock';

interface Props {
  clockRef: React.RefObject<VirtualClock | null>;
  offsetMs: number;
}

const fmt = (ms: number) => (ms / 1000).toFixed(3).padStart(9);

/**
 * Live readout of the timing layer.
 *
 * This is not a developer nicety — it is how every claim about sync gets checked. "Drift stays
 * inside 50ms across a full song" is only verifiable if drift is on screen. Refreshes at 10Hz
 * rather than per frame, since the numbers are unreadable faster than that anyway.
 */
export function DebugOverlay({ clockRef, offsetMs }: Props) {
  const [info, setInfo] = useState<ReturnType<VirtualClock['getDebugInfo']> | null>(null);

  useEffect(() => {
    const id = setInterval(() => setInfo(clockRef.current?.getDebugInfo() ?? null), 100);
    return () => clearInterval(id);
  }, [clockRef]);

  if (!info) return null;

  const driftWarn = Math.abs(info.driftMs) > 100;

  return (
    <Box
      className="tt-debug"
      bg="rgba(0,0,0,0.6)"
      border="1px solid var(--tt-border)"
      borderRadius="md"
      px={3}
      py={2}
      color="var(--tt-muted)"
    >
      {`virtual  ${fmt(info.virtualMs)}s\n`}
      {`polled   ${fmt(info.polledMs)}s\n`}
      <Box as="span" color={driftWarn ? 'var(--tt-wrong)' : 'var(--tt-muted)'}>
        {`drift    ${info.driftMs.toFixed(1).padStart(9)}ms\n`}
      </Box>
      {`rate     ${info.rate.toFixed(4).padStart(9)}\n`}
      {`offset   ${offsetMs.toString().padStart(9)}ms\n`}
      {`anchors  ${info.anchorCount.toString().padStart(9)}  snaps ${info.snapCount}\n`}
      {`state    ${info.running ? 'playing' : 'frozen'}`}
    </Box>
  );
}
