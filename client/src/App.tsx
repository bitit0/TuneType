import { useEffect } from 'react';
import { Box, Container, Flex, Heading } from '@chakra-ui/react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthButton } from '@/components/Auth/AuthButton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SiteFooter } from '@/components/SiteFooter';
import { VideoSearchPage } from '@/routes/VideoSearchPage';
import { SearchPage } from '@/routes/SearchPage';
import { SelectVideoPage } from '@/routes/SelectVideoPage';
import { SetlistsPage } from '@/routes/SetlistsPage';
import { SetlistTierPage } from '@/routes/SetlistTierPage';
import { PlayPage } from '@/routes/PlayPage';
import { ResultsPage } from '@/routes/ResultsPage';
import { ProfilePage } from '@/routes/ProfilePage';
import { PrivacyPage } from '@/routes/PrivacyPage';
import { TermsPage } from '@/routes/TermsPage';
import { useAuthStore } from '@/store/authStore';
import { useAccountStore } from '@/store/accountStore';

/** A header link that shows where you are. The root tab matches exactly, so it is not active everywhere. */
function NavTab({ to, children }: { to: string; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const active = to === '/' ? pathname === '/' : pathname.startsWith(to);

  return (
    <Link to={to}>
      <Box
        color={active ? 'var(--tt-text)' : 'var(--tt-muted)'}
        fontWeight={active ? 'semibold' : 'normal'}
        borderBottomWidth="2px"
        borderColor={active ? 'var(--tt-accent)' : 'transparent'}
        pb={1}
        _hover={{ color: 'var(--tt-text)' }}
      >
        {children}
      </Box>
    </Link>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const clearAccount = useAccountStore((s) => s.clear);

  // Drop cached account data the moment the session ends, so signing in as someone else on a
  // shared machine can never briefly show the previous user's history.
  useEffect(() => {
    if (!user) clearAccount();
  }, [user, clearAccount]);

  return (
    <Flex direction="column" minH="100%">
      {/*
        Three layers, and the header has to be the top one.

        The home page paints a fixed aurora at z-index 0, and its content sits at z-index 1 to stay
        above it. Both are positioned, and positioned elements paint above in-flow static content
        however early that content appears — which is why a static header was covered by the aurora
        entirely, at full opacity, looking like it had failed to render.

        Ten rather than one, because `position` here also opens a stacking context: the account
        dropdown's own z-index is scoped inside it, so the header competes with page content as a
        single unit. At equal z-index the later element in the document wins, and the dropdown was
        rendering under the page and swallowing its own clicks.

        Negative z-index on the aurora solves neither and breaks a third thing: html carries a
        background, so body's background no longer propagates to the canvas and would paint over
        anything sitting behind it.
      */}
      <Box
        as="header"
        position="relative"
        zIndex={10}
        borderBottom="1px solid var(--tt-border)"
        bg="var(--tt-surface)"
      >
        <Container maxW="5xl" py={3}>
          <Flex align="center" justify="space-between" gap={4}>
            <Flex align="center" gap={6} minW={0}>
              <Link to="/">
                <Heading size="md" letterSpacing="tight">
                  Tune<Box as="span" color="var(--tt-accent)">Type</Box>
                </Heading>
              </Link>
              <Flex as="nav" gap={4} fontSize="sm">
                <NavTab to="/">Find a song</NavTab>
                <NavTab to="/setlists">Setlists</NavTab>
              </Flex>
            </Flex>
            <AuthButton />
          </Flex>
        </Container>
      </Box>

      <Box as="main" flex="1">
        {/*
          Setlists get more room than the rest. Every other screen is a single column of prose or
          one table, and reading those is easier narrow; setlists are five parallel lists that want
          to sit side by side. 5xl fits two tiers across, 7xl fits three.
        */}
        <Container maxW={pathname.startsWith('/setlists') ? '7xl' : '5xl'} py={8}>
          {/*
            Inside the layout rather than around the whole app, so a route that throws leaves the
            header and its navigation working. Every risky thing — the player, the clock, the
            network calls, the run state — lives below this line.
          */}
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<VideoSearchPage />} />
              {/* The lyrics-first flow: the fallback when a video cannot be matched, and the
                  only way in on a server with no YouTube API key. */}
              <Route path="/songs" element={<SearchPage />} />
              <Route path="/video" element={<SelectVideoPage />} />
              <Route path="/setlists" element={<SetlistsPage />} />
              {/* One tier's full list. An unknown tier redirects back to the index. */}
              <Route path="/setlists/:tier" element={<SetlistTierPage />} />
              <Route path="/play" element={<PlayPage />} />
              <Route path="/results" element={<ResultsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </Container>
      </Box>

      {/* Outside <main>, so it is not part of the page's content for a screen reader. */}
      <SiteFooter />
    </Flex>
  );
}
