import { createSystem, defaultConfig } from '@chakra-ui/react';

/**
 * The app's Chakra system. Its only job is to square every corner.
 *
 * Done by zeroing the radius scale rather than by deleting `borderRadius` props one file at a time,
 * because most of the rounding was never written here. Chakra's own recipes round buttons, inputs,
 * badges and dialogs from these tokens, and a prop-by-prop edit would leave all of that untouched
 * while quietly reintroducing curves in every component added later.
 *
 * `full` is deliberately left alone. It is what makes a circle, and the one thing still meant to be
 * round is a profile picture — so `borderRadius="full"` keeps working for avatars and means nothing
 * anywhere else.
 */
export const system = createSystem(defaultConfig, {
  theme: {
    tokens: {
      radii: {
        none: { value: '0' },
        '2xs': { value: '0' },
        xs: { value: '0' },
        sm: { value: '0' },
        md: { value: '0' },
        lg: { value: '0' },
        xl: { value: '0' },
        '2xl': { value: '0' },
        '3xl': { value: '0' },
        '4xl': { value: '0' },
      },
    },
    semanticTokens: {
      radii: {
        // Chakra's recipes reach for these rather than the raw scale, so zeroing the scale alone
        // leaves component corners rounded.
        l1: { value: '0' },
        l2: { value: '0' },
        l3: { value: '0' },
      },
    },
  },
});
