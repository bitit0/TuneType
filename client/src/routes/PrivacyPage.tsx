import { Box, Heading, Link as ChakraLink, Stack, Text } from '@chakra-ui/react';
import { REPO_URL } from '@/components/SiteFooter';

/**
 * The privacy policy.
 *
 * Written from what the code actually does rather than from a template, because the interesting
 * claims here are specific and checkable: lyrics never reach the server, a saved run is counts, and
 * key statistics are summed across every song before they are stored. Each of those is enforced at
 * a named place in the source, so the policy points at it.
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
          The short version. You can play without an account and nothing about you is stored. Sign
          in and your scores are kept, but never the words you typed.
        </Text>
      </Box>

      <Section title="If you don't sign in">
        <Text>
          Nothing is stored about you. No account, no history, no cookies set by this site. Your run
          exists in the browser tab and is gone when you close it.
        </Text>
      </Section>

      <Section title="If you do sign in">
        <Text>Signing in through Google or with an email creates an account holding:</Text>
        <Text>
          Your display name, email address and avatar. A record of each run — the track's title,
          artist and video, plus counts: score, characters typed and correct, lines attempted and
          finished, and time spent typing. Your lifetime totals, your best result per song, and your
          scores on curated setlists.
        </Text>
        <Text>
          You can delete all of it from your profile page. That removes the profile, every saved
          run, every best and the sign-in credential itself. There is no undo and no copy kept.
        </Text>
      </Section>

      <Section title="What is never stored">
        <Text>
          <strong>Lyrics.</strong> They are fetched by your browser directly from LRCLIB, held in
          memory for the length of one song, and never sent to this site's server. Nothing here
          caches them, and nothing in a saved run could reconstruct them.
        </Text>
        <Text>
          <strong>What you typed.</strong> A run reduces to numbers. The individual keystrokes and
          the text of each line stay in the browser.
        </Text>
        <Text>
          <strong>Which song taught us which keys you miss.</strong> Key accuracy is stored as one
          running tally across every song you have ever played, deliberately. Kept per song it would
          describe the song rather than your typing.
        </Text>
      </Section>

      <Section title="Other services involved">
        <Text>
          <strong>LRCLIB</strong> supplies the lyrics, and your browser requests them directly, so
          LRCLIB sees your IP address and what you searched for.
        </Text>
        <Text>
          <strong>YouTube</strong> plays the video in an embedded player. Google receives the
          request and may set cookies of its own, exactly as it would on youtube.com.
        </Text>
        <Text>
          <strong>Google Firebase</strong> handles sign-in and stores account data.
        </Text>
        <Text>
          Timing corrections you choose to submit are shared so other players inherit them. They are
          two numbers — a video, and a millisecond offset — attributed to your account if you are
          signed in and to nobody if you are not.
        </Text>
      </Section>

      <Section title="Profile pictures">
        <Text>
          A picture you upload is resized to a small square by your browser before it is sent, which
          also strips the EXIF metadata a phone photo carries — including where it was taken. The
          original file never leaves your machine.
        </Text>
      </Section>

      <Section title="Questions">
        <Text>
          This is a personal project, and its source is public. If something here does not match
          what the code does, that is a bug worth reporting —{' '}
          <ChakraLink href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" color="var(--tt-accent)">
            open an issue
          </ChakraLink>
          .
        </Text>
      </Section>
    </Stack>
  );
}
