import { useEffect } from 'react';
import { Box, Container, Flex, Heading } from '@chakra-ui/react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthButton } from '@/components/Auth/AuthButton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { VideoSearchPage } from '@/routes/VideoSearchPage';
import { SearchPage } from '@/routes/SearchPage';
import { SelectVideoPage } from '@/routes/SelectVideoPage';
import { SetlistsPage } from '@/routes/SetlistsPage';
import { PlayPage } from '@/routes/PlayPage';
import { ResultsPage } from '@/routes/ResultsPage';
import { ProfilePage } from '@/routes/ProfilePage';
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
  const user = useAuthStore((s) => s.user);
  const clearAccount = useAccountStore((s) => s.clear);

  // Drop cached account data the moment the session ends, so signing in as someone else on a
  // shared machine can never briefly show the previous user's history.
  useEffect(() => {
    if (!user) clearAccount();
  }, [user, clearAccount]);

  return (
    <Flex direction="column" minH="100%">
      <Box as="header" borderBottom="1px solid var(--tt-border)" bg="var(--tt-surface)">
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
        <Container maxW="5xl" py={8}>
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
              <Route path="/play" element={<PlayPage />} />
              <Route path="/results" element={<ResultsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </Container>
      </Box>
    </Flex>
  );
}
