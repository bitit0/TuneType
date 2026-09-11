import { Box, Heading, Link as ChakraLink, List, Stack, Text } from '@chakra-ui/react';
import { REPO_URL } from '@/components/SiteFooter';

/**
 * States what the app stores, in the terms the code actually enforces.
 *
 * Every claim below is checkable against a named place in the source. Lyrics never reach the
 * server, a saved run carries counts, and key accuracy is summed across every song before anything
 * is written. A template could not say any of that, which is why this page does not read like one.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Heading size="sm" mb={2}>
        {title}
      </Heading>
      <Stack gap={3} color="var(--tt-muted)" fontSize="sm" lineHeight="1.7">
        {children}
      </Stack>
    </Box>
  );
}

export function PrivacyPage() {
  return (
    <Stack gap={7} maxW="3xl">
      <Box>
        <Heading size="lg" mb={2}>
          Privacy
        </Heading>
        <Text color="var(--tt-muted)">
          You can play without an account, and then nothing about you is stored. Sign in and your
          scores are kept, but never the words you typed.
        </Text>
      </Box>

      <Section title="If you don't sign in">
        <Text>
          Nothing about you is stored. There is no account, no history, and no cookie set by this
          site. Your run lives in the browser tab and is gone when you close it.
        </Text>
      </Section>

      <Section title="If you do sign in">
        <Text>Signing in through Google or with an email creates an account that holds:</Text>

        <List.Root ps={5} gap={2}>
          <List.Item>Your display name, email address and avatar.</List.Item>
          <List.Item>
            A record of each run — the track's title, artist and video, plus your score, how many
            characters you typed and got right, how many lines you attempted and finished, and how
            long you spent typing.
          </List.Item>
          <List.Item>
            Your lifetime totals, your best result on each song, and your scores on curated
            setlists.
          </List.Item>
        </List.Root>

        <Text>
          You can delete all of it from your profile page. Deleting removes the profile, every saved
          run, every best and the sign-in credential itself. Nothing is kept and there is no undo.
        </Text>
      </Section>

      <Section title="What is never stored">
        <Text>
          <strong>Lyrics reach your browser and stop there.</strong> They come straight from LRCLIB,
          stay in memory for the length of one song, and never touch this site's server. Nothing
          here caches them, and nothing in a saved run could reconstruct them.
        </Text>
        <Text>
          <strong>The words you type are never sent anywhere.</strong> A finished run reduces to
          numbers. Your keystrokes and the text of each line stay in the browser.
        </Text>
        <Text>
          <strong>Key accuracy is one running tally across every song you have played.</strong> It
          is stored that way deliberately. Split per song, it would describe the song instead of
          your typing.
        </Text>
      </Section>

      <Section title="Other services involved">
        <Text>
          <strong>LRCLIB</strong> supplies the lyrics, and your browser asks it directly, so LRCLIB
          sees your IP address and what you searched for.
        </Text>
        <Text>
          <strong>YouTube</strong> plays the video in an embedded player. Google receives that
          request and may set cookies of its own, exactly as it would on youtube.com.
        </Text>
        <Text>
          <strong>Google Firebase</strong> handles sign-in and stores the account data listed above.
        </Text>
        <Text>
          Timing corrections you choose to submit are shared, so the next player inherits them. Each
          one is two numbers, a video and a millisecond offset, attributed to your account if you
          are signed in and to nobody if you are not.
        </Text>
      </Section>

      <Section title="Profile pictures">
        <Text>
          Your browser shrinks a picture to a small square before sending it, and re-encoding it
          that way also strips the EXIF metadata a phone photo carries, including where it was
          taken. The original file never leaves your machine.
        </Text>
      </Section>

      <Section title="Questions">
        <Text>
          This is a personal project and its source is public. If anything here disagrees with what
          the code does, that is a bug worth reporting —{' '}
          <ChakraLink href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" color="var(--tt-accent)">
            open an issue
          </ChakraLink>
          .
        </Text>
      </Section>
    </Stack>
  );
}
