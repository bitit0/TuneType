import { Box, Container, Flex, Link as ChakraLink, Text } from '@chakra-ui/react';
import { Link } from 'react-router-dom';

/**
 * Shows the legal pages and the contact route on every page.
 *
 * Contact points at the repository's issues because this is a personal project with no support
 * address to publish, and an issue is both a real inbox and a place where the answer stays visible
 * to whoever asks the same thing next.
 */

export const REPO_URL = 'https://github.com/bitit0/TuneType';

function FooterLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <ChakraLink asChild color="var(--tt-muted)" _hover={{ color: 'var(--tt-text)' }}>
      <Link to={to}>{children}</Link>
    </ChakraLink>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <ChakraLink
      href={href}
      target="_blank"
      rel="noreferrer"
      color="var(--tt-muted)"
      _hover={{ color: 'var(--tt-text)' }}
    >
      {children}
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
            <ExternalLink href={`${REPO_URL}/issues`}>Contact</ExternalLink>
            <ExternalLink href={REPO_URL}>Source</ExternalLink>
          </Flex>

          {/*
            The words and the audio both come from somewhere else, and a visitor wondering where
            deserves the answer on the page instead of buried in a policy.
          */}
          <Text fontSize="xs">
            Lyrics from LRCLIB · Video from YouTube · Not affiliated with either
          </Text>
        </Flex>
      </Container>
    </Box>
  );
}
