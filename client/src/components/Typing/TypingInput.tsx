import { memo } from 'react';
import { Box } from '@chakra-ui/react';

interface Props {
  target: string;
  typed: string;
}

/**
 * The active line, one span per character, coloured by what the player has typed so far.
 *
 * Comparison is positional: a dropped character shifts everything after it and the whole tail goes
 * red. That cascade is intentional — it is what a typing game is supposed to punish, and it
 * matches how the line is scored.
 */
export const TypingInput = memo(function TypingInput({ target, typed }: Props) {
  const chars = Array.from(target);

  return (
    <Box className="tt-line">
      {chars.map((char, i) => {
        let state = 'tt-char--pending';
        if (i < typed.length) {
          state = typed[i] === char ? 'tt-char--correct' : 'tt-char--wrong';
        }
        const isSpace = char === ' ';

        return (
          <span key={i}>
            {i === typed.length && <span className="tt-caret" />}
            <span className={`tt-char ${state}${isSpace ? ' tt-char--space' : ''}`}>{char}</span>
          </span>
        );
      })}
      {/* Caret sits after the final character once the line is complete. */}
      {typed.length >= chars.length && <span className="tt-caret" />}
    </Box>
  );
});
