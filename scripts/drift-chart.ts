import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlayerState, VirtualClock, type PlayerLike } from '../client/src/lib/timing/VirtualClock.js';

/**
 * Draws `docs/drift.svg` — the chart in the README's timing section.
 *
 * It measures the real `VirtualClock` rather than illustrating it. The class is instantiated
 * exactly as the app instantiates it, against a player that reproduces the one property that makes
 * this problem hard: `getCurrentTime()` only ever reports multiples of 250ms, so any single reading
 * lags true playback by an unknown fraction of a step.
 *
 * Regenerate with `npm run chart:drift` after touching the clock or its constants. A chart drawn
 * by hand would keep agreeing with the prose after the code stopped.
 */

const SOURCE_STEP_MS = 250;
const POLL_MS = 100;
const DURATION_MS = 30_000;

/** The ±50ms band the README claims the clock holds. Drawn so the claim can be checked by eye. */
const CLAIM_MS = 50;

let wallMs = 0;
let trueVideoMs = 0;

const player: PlayerLike = {
  getCurrentTime: () => (Math.floor(trueVideoMs / SOURCE_STEP_MS) * SOURCE_STEP_MS) / 1000,
  getPlayerState: () => PlayerState.PLAYING,
};

/*
 * The clock schedules its own polling with setInterval. Swapping the global for the length of the
 * constructor call hands that cadence to the loop below, which makes the run deterministic and
 * finishes in milliseconds instead of taking the full thirty seconds in real time.
 *
 * Nothing about the clock is stubbed — only who decides when it polls.
 */
let poll: (() => void) | null = null;
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = ((fn: () => void) => {
  poll = fn;
  return 0;
}) as typeof globalThis.setInterval;

const clock = new VirtualClock(player, { wallClock: () => wallMs });
clock.start();

globalThis.setInterval = realSetInterval;
if (!poll) throw new Error('VirtualClock did not schedule a poll; the capture above is stale.');

interface Sample {
  atMs: number;
  /** How far the virtual clock sits from true playback. */
  virtualErrMs: number;
  /** How far a naive reading of getCurrentTime() sits from it. The thing being improved on. */
  naiveErrMs: number;
}

const samples: Sample[] = [];

for (let elapsed = 0; elapsed < DURATION_MS; elapsed += POLL_MS) {
  wallMs += POLL_MS;
  trueVideoMs += POLL_MS;
  poll();

  samples.push({
    atMs: trueVideoMs,
    virtualErrMs: clock.now() - trueVideoMs,
    naiveErrMs: player.getCurrentTime() * 1000 - trueVideoMs,
  });
}

const peak = (pick: (s: Sample) => number) =>
  samples.reduce((worst, s) => Math.max(worst, Math.abs(pick(s))), 0);

const peakVirtual = peak((s) => s.virtualErrMs);
const peakNaive = peak((s) => s.naiveErrMs);

// --- Chart ------------------------------------------------------------------------------------

const W = 900;
const H = 340;
const PAD = { top: 28, right: 20, bottom: 40, left: 62 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

// Symmetric around zero and anchored to the naive peak, so both series share one scale and the
// comparison is honest. Rounded up to the next 50ms so the axis lands on readable numbers.
const yMax = Math.ceil(Math.max(peakNaive, CLAIM_MS) / 50) * 50;

const x = (atMs: number) => PAD.left + (atMs / DURATION_MS) * plotW;
const y = (errMs: number) => PAD.top + plotH / 2 - (errMs / yMax) * (plotH / 2);

const path = (pick: (s: Sample) => number) =>
  samples.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.atMs).toFixed(1)},${y(pick(s)).toFixed(1)}`).join('');

const ticks = [-yMax, -yMax / 2, 0, yMax / 2, yMax];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif">
  <rect width="${W}" height="${H}" fill="#0e0f13"/>

  <!-- The band the README claims the clock stays inside. -->
  <rect x="${PAD.left}" y="${y(CLAIM_MS).toFixed(1)}" width="${plotW}" height="${(y(-CLAIM_MS) - y(CLAIM_MS)).toFixed(1)}" fill="#4ade80" opacity="0.08"/>

  ${ticks
    .map(
      (t) =>
        `<line x1="${PAD.left}" y1="${y(t).toFixed(1)}" x2="${PAD.left + plotW}" y2="${y(t).toFixed(1)}" stroke="#2a2d3a" stroke-width="1"/>
  <text x="${PAD.left - 10}" y="${(y(t) + 4).toFixed(1)}" fill="#8b90a3" font-size="11" text-anchor="end">${t > 0 ? '+' : ''}${t}</text>`,
    )
    .join('\n  ')}

  <path d="${path((s) => s.naiveErrMs)}" fill="none" stroke="#f87171" stroke-width="1.5" opacity="0.85"/>
  <path d="${path((s) => s.virtualErrMs)}" fill="none" stroke="#4ade80" stroke-width="2"/>

  <text x="${PAD.left}" y="16" fill="#e8eaf0" font-size="13" font-weight="600">Error against true playback time (ms)</text>

  <g font-size="11">
    <line x1="${PAD.left + plotW - 250}" y1="${H - 14}" x2="${PAD.left + plotW - 232}" y2="${H - 14}" stroke="#f87171" stroke-width="1.5"/>
    <text x="${PAD.left + plotW - 226}" y="${H - 10}" fill="#8b90a3">getCurrentTime() directly — peak ${Math.round(peakNaive)}ms</text>
    <line x1="${PAD.left}" y1="${H - 14}" x2="${PAD.left + 18}" y2="${H - 14}" stroke="#4ade80" stroke-width="2"/>
    <text x="${PAD.left + 24}" y="${H - 10}" fill="#8b90a3">VirtualClock — peak ${Math.round(peakVirtual)}ms</text>
  </g>

  <text x="${PAD.left + plotW}" y="${H - 26}" fill="#5a5f73" font-size="10" text-anchor="end">${DURATION_MS / 1000}s of playback, polled every ${POLL_MS}ms</text>
</svg>
`;

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/drift.svg');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);

console.log(`Wrote ${out}`);
console.log(`  naive peak error:   ${peakNaive.toFixed(1)}ms`);
console.log(`  VirtualClock peak:  ${peakVirtual.toFixed(1)}ms`);
console.log(`  anchors: ${clock.getDebugInfo().anchorCount}, hard snaps: ${clock.getDebugInfo().snapCount}`);
