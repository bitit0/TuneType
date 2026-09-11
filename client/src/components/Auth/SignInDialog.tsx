import { useEffect, useState } from 'react';
import { Box, Button, Flex, Heading, Input, Stack, Text } from '@chakra-ui/react';
import { useAuthStore } from '@/store/authStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Hand-rolled overlay rather than a component-library dialog: it's a handful of elements, and
 * keeping it dependency-free means the sign-in path can't break when the UI library revises its
 * compound-component API.
 */
export function SignInDialog({ open, onClose }: Props) {
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const registerWithEmail = useAuthStore((s) => s.registerWithEmail);
  const user = useAuthStore((s) => s.user);

  // Close as soon as sign-in actually lands, whichever method got there.
  useEffect(() => {
    if (user && open) onClose();
  }, [user, open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    clearError();
    if (mode === 'signin') await signInWithEmail(email, password);
    else await registerWithEmail(email, password);
    setBusy(false);
  }

  return (
    <Flex
      position="fixed"
      inset={0}
      bg="rgba(0,0,0,0.6)"
      align="center"
      justify="center"
      zIndex={1000}
      onClick={onClose}
    >
      <Box
        bg="var(--tt-surface)"
        borderWidth="1px"
        borderColor="var(--tt-border)"
        borderRadius="lg"
        p={6}
        w="100%"
        maxW="380px"
        onClick={(e) => e.stopPropagation()}
      >
        <Heading size="md" mb={1}>
          {mode === 'signin' ? 'Sign in' : 'Create an account'}
        </Heading>
        <Text fontSize="sm" color="var(--tt-muted)" mb={4}>
          Optional — the game is fully playable signed out. Signing in saves your runs and tracks
          personal bests per song.
        </Text>

        {/*
          One error region for the whole dialog, above both methods.
          It used to live inside the form, below the password fields — which meant a Google popup
          failure printed its explanation several elements further down the dialog, well away from
          the button that caused it, and read as "nothing happened".
        */}
        {error && (
          <Box
            borderWidth="1px"
            borderColor="var(--tt-wrong)"
            borderRadius="md"
            px={3}
            py={2}
            mb={4}
          >
            <Text fontSize="sm" color="var(--tt-wrong)">
              {error}
            </Text>
          </Box>
        )}

        <Button w="100%" variant="outline" onClick={signInWithGoogle} mb={4}>
          Continue with Google
        </Button>

        <Flex align="center" gap={3} mb={4}>
          <Box flex="1" h="1px" bg="var(--tt-border)" />
          <Text fontSize="xs" color="var(--tt-muted)">
            OR
          </Text>
          <Box flex="1" h="1px" bg="var(--tt-border)" />
        </Flex>

        <form onSubmit={submit}>
          <Stack gap={3}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              borderColor="var(--tt-border)"
              required
            />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              borderColor="var(--tt-border)"
              required
            />
            <Button type="submit" colorPalette="blue" loading={busy}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </Stack>
        </form>

        <Flex justify="space-between" mt={4}>
          <Button
            variant="plain"
            size="sm"
            onClick={() => {
              clearError();
              setMode(mode === 'signin' ? 'register' : 'signin');
            }}
          >
            {mode === 'signin' ? 'Create an account' : 'I already have an account'}
          </Button>
          <Button variant="plain" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </Flex>
      </Box>
    </Flex>
  );
}
