import { useEffect, useRef, useState } from 'react';
import { Box, Button, Flex, Stack, Text } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useAccountStore } from '@/store/accountStore';
import { avatarSrc } from '@/lib/avatar';
import { Avatar } from './Avatar';

/**
 * The signed-in control in the header: avatar, and a dropdown to reach the account.
 *
 * Hand-rolled rather than a component-library menu, for the same reason `SignInDialog` is: it's a
 * handful of elements, and keeping it dependency-free means the account entry point can't break
 * when the UI library revises its compound-component API.
 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const user = useAuthStore((s) => s.user);
  const logOut = useAuthStore((s) => s.logOut);
  const profile = useAccountStore((s) => s.overview?.profile);
  const loadIfNeeded = useAccountStore((s) => s.loadIfNeeded);

  // The header shows the account's name and picture, so it needs the profile — on every page, not
  // just /profile. Loading it here means the avatar is correct from the first render after sign-in.
  useEffect(() => {
    if (user) void loadIfNeeded();
  }, [user, loadIfNeeded]);

  // Close on outside click and on Escape. Both are expected of a dropdown, and their absence is
  // the kind of thing that reads as broken rather than as missing.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const name = profile?.displayName ?? user.displayName ?? user.email ?? 'Account';
  const src = avatarSrc(profile ?? null, user.photoURL);

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  return (
    <Box position="relative" ref={containerRef}>
      <Flex
        as="button"
        align="center"
        gap={2}
        px={2}
        py={1}
        borderWidth="1px"
        borderColor={open ? 'var(--tt-accent)' : 'transparent'}
        _hover={{ borderColor: 'var(--tt-border)' }}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={name} color={profile?.avatarColor ?? 'slate'} src={src} size={28} />
        <Text
          fontSize="sm"
          color="var(--tt-muted)"
          maxW="140px"
          truncate
          display={{ base: 'none', sm: 'block' }}
        >
          {name}
        </Text>
      </Flex>

      {open && (
        <Box
          position="absolute"
          right={0}
          mt={2}
          minW="240px"
          bg="var(--tt-surface)"
          borderWidth="1px"
          borderColor="var(--tt-border)"
          borderRadius="lg"
          boxShadow="0 12px 32px rgba(0,0,0,0.45)"
          zIndex={900}
          overflow="hidden"
          role="menu"
        >
          <Flex align="center" gap={3} p={4}>
            <Avatar name={name} color={profile?.avatarColor ?? 'slate'} src={src} size={40} />
            <Box minW={0}>
              <Text fontWeight="semibold" truncate>
                {name}
              </Text>
              <Text fontSize="xs" color="var(--tt-muted)" truncate>
                {user.email}
              </Text>
            </Box>
          </Flex>

          <Box h="1px" bg="var(--tt-border)" />

          <Stack gap={0} p={2}>
            <MenuItem onClick={() => go('/profile')}>Profile and stats</MenuItem>
            <MenuItem onClick={() => go('/profile#account')}>Account settings</MenuItem>
          </Stack>

          <Box h="1px" bg="var(--tt-border)" />

          <Box p={2}>
            <MenuItem
              onClick={() => {
                setOpen(false);
                void logOut();
              }}
            >
              Sign out
            </MenuItem>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <Button
      variant="plain"
      size="sm"
      justifyContent="flex-start"
      w="100%"
      px={3}
      fontWeight="normal"
      color="var(--tt-text)"
      _hover={{ bg: 'var(--tt-bg)' }}
      borderRadius="md"
      onClick={onClick}
      role="menuitem"
    >
      {children}
    </Button>
  );
}
