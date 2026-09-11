import { useEffect, useState } from 'react';
import { Button } from '@chakra-ui/react';
import { useAuthStore } from '@/store/authStore';
import { isAuthConfigured } from '@/lib/firebase';
import { SignInDialog } from './SignInDialog';
import { AccountMenu } from './AccountMenu';

/** The header's account control: a sign-in button, or the account menu once signed in. */
export function AuthButton() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  const init = useAuthStore((s) => s.init);

  useEffect(() => init(), [init]);

  // With no Firebase project configured the whole control hides itself, so the game stays fully
  // usable with zero cloud setup.
  if (!isAuthConfigured() || initializing) return null;

  if (user) return <AccountMenu />;

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setDialogOpen(true)}>
        Sign in
      </Button>
      <SignInDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
