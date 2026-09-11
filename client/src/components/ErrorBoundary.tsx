import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Box, Button, Flex, Heading, Stack, Text } from '@chakra-ui/react';

/**
 * The last line between a thrown render error and a white page.
 *
 * A class component because there is still no hook equivalent — `componentDidCatch` is the only
 * way to catch an error thrown during render, and React has no functional counterpart for it.
 *
 * What it deliberately does not do is try to keep going. A run whose state has already thrown is
 * not a run worth resuming, and the honest offer is to start again rather than to hand back a
 * screen whose numbers may now be wrong.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // No reporting service is wired up, so the console is where this goes. Logged rather than
    // swallowed: the component stack is the only thing that says which screen threw.
    console.error('[tunetype] Unhandled render error:', error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <Flex minH="60vh" align="center" justify="center" p={6}>
        <Stack
          gap={4}
          maxW="lg"
          borderWidth="1px"
          borderColor="var(--tt-border)"
          borderRadius="lg"
          bg="var(--tt-surface)"
          p={6}
        >
          <Heading size="md">Something broke</Heading>

          <Text color="var(--tt-muted)">
            The page hit an error it could not recover from. Nothing you typed was sent anywhere —
            a run lives in memory and goes no further — so starting again loses only this attempt.
          </Text>

          {/*
            The message, not the stack. It is occasionally the one clue that explains the failure
            (a blocked request, a missing key), and it costs nothing to show someone who can then
            repeat it back. The stack is in the console for whoever wants it.
          */}
          <Box
            borderWidth="1px"
            borderColor="var(--tt-border)"
            borderRadius="md"
            p={3}
            fontSize="xs"
            fontFamily="'Cascadia Mono', Consolas, monospace"
            color="var(--tt-muted)"
            overflowX="auto"
          >
            {error.message || String(error)}
          </Box>

          <Flex gap={3}>
            {/*
              A full reload rather than a router navigation. Whatever threw is still in the store,
              and sending a broken session to a different route would only move the crash.
            */}
            <Button colorPalette="blue" onClick={() => window.location.assign('/')}>
              Start over
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </Flex>
        </Stack>
      </Flex>
    );
  }
}
