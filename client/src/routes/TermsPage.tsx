import { Box, Heading, Link as ChakraLink, Stack, Text } from '@chakra-ui/react';
import { REPO_URL } from '@/components/SiteFooter';

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

/**
 * Terms, and the copyright position.
 *
 * The second section is the one that matters and is the reason this page exists at all: lyrics are
 * publisher-copyrighted, LRCLIB being free to query confers no licence, and the architecture is
 * bent around that fact. Saying so plainly is more honest than a page of boilerplate that pretends
 * the question never came up.
 */
export function TermsPage() {
  return (
    <Stack gap={7} maxW="3xl">
      <Box>
        <Heading size="lg" mb={2}>
          Terms
        </Heading>
        <Text color="var(--tt-muted)">
          A personal project, offered as is. Short, because there is not much to say.
        </Text>
      </Box>

      <Section title="Using it">
        <Text>
          Play as much as you like. Do not attack it — no scraping the search endpoints, no
          automating runs to inflate a leaderboard, nothing that spends the shared daily search
          budget on something other than finding a song.
        </Text>
        <Text>
          There is no uptime promise and no guarantee your saved runs will outlive the project. Back
          up nothing here that you would miss.
        </Text>
      </Section>

      <Section title="Lyrics and copyright">
        <Text>
          Song lyrics are copyrighted by their publishers, and LRCLIB being free to query confers no
          licence over them. This site does not store, cache, proxy or redistribute them: your
          browser fetches them from LRCLIB directly and discards them when the song ends.
        </Text>
        <Text>
          Videos are played through YouTube's own embedded player, which is how they are licensed to
          be played, and are never downloaded or re-hosted.
        </Text>
        <Text>
          If you hold rights to something reachable here and want it gone, say so and it will be
          removed.
        </Text>
      </Section>

      <Section title="Your account">
        <Text>
          You can delete it whenever you want, from your profile page, and that removes everything
          tied to it. An account may be removed if it is used to attack the service.
        </Text>
      </Section>

      <Section title="Contact">
        <Text>
          The source is public and issues are the fastest route —{' '}
          <ChakraLink href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" color="var(--tt-accent)">
            open one here
          </ChakraLink>
          .
        </Text>
      </Section>
    </Stack>
  );
}
