import { Box, Container, Flex, Link as ChakraLink, Text } from '@chakra-ui/react';
import { Link } from 'react-router-dom';

/**
 * The footer, on every page.
 *
 * Also the contact route. This is a personal project with no support address to publish, and the
 * repository's issue tracker is both a real inbox and one where the answer is visible to whoever
 * asks the same thing next.
 */

export const REPO_URL = 'https://github.com/bitit0/TuneType';

function FooterLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <ChakraLink asChild color="var(--tt-muted)" _hover={{ color: 'var(--tt-text)' }}>
      <Link to={to}>{children}</Link>
    </ChakraLink>
  );
}

export function SiteFooter() {
  return (
    <Box as="footer" borderTopWidth="1px" borderColor="var(--tt-border)" mt={12}>
      <Container maxW="5xl" py={6}>
        <Flex
          justify="space-between"
          align="center"
          gap={4}
          wrap="wrap"
          fontSize="sm"
          color="var(--tt-muted)"
        >
          <Flex gap={5} wrap="wrap">
            <FooterLink to="/privacy">Privacy</FooterLink>
            <FooterLink to="/terms">Terms</FooterLink>
            <ChakraLink
              href={`${REPO_URL}/issues`}
              target="_blank"
              rel="noreferrer"
              color="var(--tt-muted)"
              _hover={{ color: 'var(--tt-text)' }}
            >
              Contact
            </ChakraLink>
            <ChakraLink
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              color="var(--tt-muted)"
              _hover={{ color: 'var(--tt-text)' }}
            >
              Source
            </ChakraLink>
          </Flex>

          {/*
            Credit where the two things this app is made of actually come from. Neither is ours, and
            a visitor wondering where the words or the audio came from deserves the answer on the
            page rather than in a policy.
          */}
          <Text fontSize="xs">
            Lyrics from LRCLIB · Video from YouTube · Not affiliated with either
          </Text>
        </Flex>
      </Container>
    </Box>
  );
}
