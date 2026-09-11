import { Box, Heading, Link as ChakraLink, Stack, Text } from '@chakra-ui/react';
import { REPO_URL } from '@/components/SiteFooter';

/**
 * Sets out the terms, and states the copyright position.
 *
 * The copyright section is why this page exists. Lyrics belong to their publishers, LRCLIB being
 * free to query grants no licence over them, and the whole architecture is bent around that fact.
 * Saying so plainly beats a page of boilerplate that pretends the question never came up.
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

export function TermsPage() {
  return (
    <Stack gap={7} maxW="3xl">
      <Box>
        <Heading size="lg" mb={2}>
          Terms
        </Heading>
        <Text color="var(--tt-muted)">
          This is a personal project offered as is, so there is not much to say.
        </Text>
      </Box>

      <Section title="Using it">
        <Text>
          Play as much as you like. Do not attack it — no scraping the search endpoints, no
          automating runs to inflate a leaderboard, and nothing that spends the shared daily search
          budget on anything other than finding a song.
        </Text>
        <Text>
          Nobody promises uptime here, and your saved runs may not outlive the project. Keep nothing
          here that you would miss.
        </Text>
      </Section>

      <Section title="Lyrics and copyright">
        <Text>
          Song lyrics belong to their publishers, and LRCLIB being free to query grants no licence
          over them. This site never stores, caches, proxies or redistributes them. Your browser
          fetches them from LRCLIB directly and discards them when the song ends.
        </Text>
        <Text>
          Videos play through YouTube's own embedded player, which is how they are licensed to be
          played. Nothing here downloads or re-hosts them.
        </Text>
        <Text>
          If you hold rights to something reachable here and want it gone, say so and it will be
          removed.
        </Text>
      </Section>

      <Section title="Your account">
        <Text>
          You can delete it whenever you want from your profile page, and deleting removes
          everything tied to it. An account used to attack the service may be removed.
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
