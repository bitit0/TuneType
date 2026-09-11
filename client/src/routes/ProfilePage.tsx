import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Input,
  Spinner,
  Stack,
  Text,
} from '@chakra-ui/react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { SavedRun, TrackBest } from '@shared/types';
import { useAccountStore } from '@/store/accountStore';
import { useAuthStore } from '@/store/authStore';
import { isAuthConfigured } from '@/lib/firebase';
import { AVATAR_COLOR_KEYS, AVATAR_PALETTE, avatarSrc } from '@/lib/avatar';
import { ImageError, fileToAvatarDataUri } from '@/lib/image/downscale';
import { Avatar } from '@/components/Auth/Avatar';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="md" p={4}>
      <Text fontSize="xs" color="var(--tt-muted)" letterSpacing="wide">
        {label.toUpperCase()}
      </Text>
      <Text fontSize="2xl" fontWeight="bold" lineHeight="1.2">
        {value}
      </Text>
      {hint && (
        <Text fontSize="xs" color="var(--tt-muted)">
          {hint}
        </Text>
      )}
    </Box>
  );
}

function formatDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function RunRow({ run }: { run: SavedRun }) {
  return (
    <Flex
      align="center"
      justify="space-between"
      gap={4}
      px={4}
      py={3}
      borderWidth="1px"
      borderColor="var(--tt-border)"
      borderRadius="md"
      bg="var(--tt-surface)"
    >
      <Box minW={0}>
        <Text fontWeight="semibold" truncate>
          {run.title}
        </Text>
        <Text fontSize="sm" color="var(--tt-muted)" truncate>
          {run.artist} · {formatDate(run.playedAt)}
        </Text>
      </Box>
      <Flex align="center" gap={5} flexShrink={0} fontSize="sm">
        <Text minW="70px" textAlign="right" color="var(--tt-muted)">
          {run.wpm.toFixed(1)} wpm
        </Text>
        <Text minW="52px" textAlign="right" color="var(--tt-muted)">
          {Math.round(run.accuracy * 100)}%
        </Text>
        <Text minW="72px" textAlign="right" fontWeight="semibold">
          {run.totalScore.toLocaleString()}
        </Text>
      </Flex>
    </Flex>
  );
}

function BestRow({ best }: { best: TrackBest }) {
  return (
    <Flex
      align="center"
      justify="space-between"
      gap={4}
      px={4}
      py={3}
      borderWidth="1px"
      borderColor="var(--tt-border)"
      borderRadius="md"
    >
      <Box minW={0}>
        <Text fontWeight="semibold" truncate>
          {best.title}
        </Text>
        <Text fontSize="sm" color="var(--tt-muted)" truncate>
          {best.artist}
        </Text>
      </Box>
      <Flex align="center" gap={4} flexShrink={0} fontSize="sm">
        <Badge variant="subtle">
          {best.plays} {best.plays === 1 ? 'play' : 'plays'}
        </Badge>
        <Text minW="70px" textAlign="right" color="var(--tt-muted)">
          {best.bestWpm.toFixed(1)} wpm
        </Text>
        <Text minW="72px" textAlign="right" fontWeight="semibold">
          {best.bestScore.toLocaleString()}
        </Text>
      </Flex>
    </Flex>
  );
}

export function ProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  const logOut = useAuthStore((s) => s.logOut);

  const overview = useAccountStore((s) => s.overview);
  const loading = useAccountStore((s) => s.loading);
  const error = useAccountStore((s) => s.error);
  const load = useAccountStore((s) => s.load);
  const updateProfile = useAccountStore((s) => s.updateProfile);
  const deleteAccount = useAccountStore((s) => s.deleteAccount);

  const [nameDraft, setNameDraft] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [user, load]);

  // Signed out — including landing here directly from a bookmark.
  if (!isAuthConfigured()) return <Navigate to="/" replace />;
  if (initializing) return <Spinner />;
  if (!user) return <Navigate to="/" replace />;

  async function submitName(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const ok = await updateProfile({ displayName: nameDraft });
    setBusy(false);
    if (ok) setEditingName(false);
  }

  async function pickPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately, so re-picking the same file after an error still fires a change event.
    event.target.value = '';
    if (!file) return;

    setPhotoError(null);
    setBusy(true);
    try {
      // Downscaled and re-encoded in the browser; see lib/image/downscale.ts for why.
      await updateProfile({ photo: await fileToAvatarDataUri(file) });
    } catch (error) {
      setPhotoError(
        error instanceof ImageError ? error.message : 'That image could not be processed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoError(null);
    setBusy(true);
    await updateProfile({ photo: null });
    setBusy(false);
  }

  async function confirmDelete() {
    setBusy(true);
    const ok = await deleteAccount();
    setBusy(false);
    if (ok) {
      // The credential is gone server-side; drop the local session too so the UI isn't holding a
      // user object that no longer resolves to anything.
      await logOut();
      navigate('/');
    }
  }

  const stats = overview?.stats;

  return (
    <Stack gap={8} maxW="4xl">
      <Flex align="center" gap={4}>
        <Avatar
          name={overview?.profile.displayName ?? user.email ?? '?'}
          color={overview?.profile.avatarColor ?? 'slate'}
          src={avatarSrc(overview?.profile ?? null, user.photoURL)}
          size={64}
        />
        <Box minW={0}>
          <Heading size="lg" truncate>
            {overview?.profile.displayName ?? user.email}
          </Heading>
          <Text color="var(--tt-muted)">
            {user.email} · joined {overview ? formatDate(overview.profile.createdAt) : '—'}
          </Text>
        </Box>
      </Flex>

      {loading && !overview && (
        <Flex align="center" gap={3} color="var(--tt-muted)">
          <Spinner size="sm" /> <Text>Loading your account…</Text>
        </Flex>
      )}

      {error && (
        <Box borderWidth="1px" borderColor="var(--tt-wrong)" borderRadius="md" p={4}>
          <Text color="var(--tt-wrong)">{error}</Text>
        </Box>
      )}

      {stats && (
        <>
          <Grid templateColumns={{ base: '1fr 1fr', md: 'repeat(4, 1fr)' }} gap={4}>
            <Stat label="Runs" value={stats.runs.toLocaleString()} />
            <Stat
              label="Avg WPM"
              value={stats.wpm.toFixed(1)}
              hint=""
            />
            <Stat label="Accuracy" value={`${Math.round(stats.accuracy * 100)}%`} hint="lifetime" />
            <Stat label="Best score" value={stats.bestScore.toLocaleString()} />
          </Grid>

          <Grid templateColumns={{ base: '1fr 1fr', md: 'repeat(4, 1fr)' }} gap={4}>
            <Stat label="Best WPM" value={stats.bestWpm.toFixed(1)} />
            <Stat label="Total score" value={stats.totalScore.toLocaleString()} />
            <Stat label="Lines typed" value={stats.linesCompleted.toLocaleString()} hint="finished in time" />
            <Stat
              label="Time typing"
              value={`${Math.round(stats.totalTypingMs / 60_000)}m`}
              hint="excludes gaps between lines"
            />
          </Grid>
        </>
      )}

      {overview && overview.topTracks.length > 0 && (
        <Box>
          <Heading size="sm" mb={3}>
            Best tracks
          </Heading>
          <Stack gap={2}>
            {overview.topTracks.map((best) => (
              <BestRow key={best.lrclibId} best={best} />
            ))}
          </Stack>
        </Box>
      )}

      {overview && (
        <Box>
          <Heading size="sm" mb={3}>
            Recent runs
          </Heading>
          {overview.recentRuns.length === 0 ? (
            <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="md" p={6}>
              <Text color="var(--tt-muted)">
                No saved runs yet. Finish a song while signed in and it will show up here.
              </Text>
            </Box>
          ) : (
            <Stack gap={2}>
              {overview.recentRuns.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </Stack>
          )}
        </Box>
      )}

      <Box id="account" borderWidth="1px" borderColor="var(--tt-border)" borderRadius="md" p={5}>
        <Heading size="sm" mb={4}>
          Account
        </Heading>

        <Stack gap={4}>
          {/* Picture */}
          <Flex gap={4} align="center" wrap="wrap">
            <Avatar
              name={overview?.profile.displayName ?? '?'}
              color={overview?.profile.avatarColor ?? 'slate'}
              src={avatarSrc(overview?.profile ?? null, user.photoURL)}
              size={56}
            />
            <Stack gap={2} flex="1" minW="220px">
              <Flex gap={2} wrap="wrap">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  loading={busy}
                >
                  Upload picture
                </Button>
                {overview?.profile.photo && (
                  <Button size="xs" variant="plain" onClick={removePhoto} disabled={busy}>
                    Remove
                  </Button>
                )}
              </Flex>
              <Text fontSize="xs" color="var(--tt-muted)">
                Cropped to a square and shrunk in your browser before upload — the original file
                never leaves your machine, and neither does its location data.
                {!overview?.profile.photo && user.photoURL && ' Currently showing your Google picture.'}
              </Text>
              {photoError && (
                <Text fontSize="xs" color="var(--tt-wrong)">
                  {photoError}
                </Text>
              )}
            </Stack>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
              onChange={pickPhoto}
              style={{ display: 'none' }}
            />
          </Flex>

          <Box h="1px" bg="var(--tt-border)" />

          {/* Avatar color — only meaningful when initials are what's actually shown. */}
          <Flex gap={3} align="center" justify="space-between" wrap="wrap">
            <Box>
              <Text fontSize="sm" color="var(--tt-muted)">
                Avatar color
              </Text>
              {avatarSrc(overview?.profile ?? null, user.photoURL) && (
                <Text fontSize="xs" color="var(--tt-muted)">
                  Shown when no picture is set.
                </Text>
              )}
            </Box>
            {/*
              Plain <button>, not `Box as="button"`. Chakra v3's polymorphic `as` is unreliable
              here — the same prop refuses to type `src` on an img or `type` on an input — and a
              swatch that silently renders as a div is a control that looks right and does nothing.
              A real button also gets keyboard focus and Enter/Space for free.
            */}
            <Flex gap={2}>
              {AVATAR_COLOR_KEYS.map((color) => {
                const selected = overview?.profile.avatarColor === color;
                return (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Avatar color ${color}`}
                    aria-pressed={selected}
                    title={color}
                    disabled={busy}
                    onClick={() => void updateProfile({ avatarColor: color })}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: AVATAR_PALETTE[color].bg,
                      border: `2px solid ${selected ? 'var(--tt-text)' : 'transparent'}`,
                      outlineOffset: 2,
                      cursor: busy ? 'default' : 'pointer',
                      padding: 0,
                    }}
                  />
                );
              })}
            </Flex>
          </Flex>

          <Box h="1px" bg="var(--tt-border)" />

          {editingName ? (
            <form onSubmit={submitName}>
              <Flex gap={3} align="center" wrap="wrap">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="Display name"
                  maxLength={24}
                  borderColor="var(--tt-border)"
                  maxW="280px"
                  autoFocus
                />
                <Button type="submit" size="sm" colorPalette="blue" loading={busy}>
                  Save
                </Button>
                <Button size="sm" variant="plain" onClick={() => setEditingName(false)}>
                  Cancel
                </Button>
              </Flex>
            </form>
          ) : (
            <Flex gap={3} align="center" justify="space-between" wrap="wrap">
              <Text fontSize="sm" color="var(--tt-muted)">
                Display name:{' '}
                <span style={{ color: 'var(--tt-text)' }}>
                  {overview?.profile.displayName ?? '—'}
                </span>
              </Text>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setNameDraft(overview?.profile.displayName ?? '');
                  setEditingName(true);
                }}
              >
                Change
              </Button>
            </Flex>
          )}

          <Box h="1px" bg="var(--tt-border)" />

          {confirmingDelete ? (
            <Stack gap={3}>
              <Text fontSize="sm" color="var(--tt-wrong)">
                This deletes your profile, every saved run and your sign-in, permanently. There is no
                undo.
              </Text>
              <Flex gap={3}>
                <Button size="sm" colorPalette="red" onClick={confirmDelete} loading={busy}>
                  Delete everything
                </Button>
                <Button size="sm" variant="plain" onClick={() => setConfirmingDelete(false)}>
                  Keep my account
                </Button>
              </Flex>
            </Stack>
          ) : (
            <Flex gap={3} align="center" justify="space-between" wrap="wrap">
              <Text fontSize="sm" color="var(--tt-muted)">
                Delete your account and all saved runs.
              </Text>
              <Button size="xs" variant="outline" onClick={() => setConfirmingDelete(true)}>
                Delete account
              </Button>
            </Flex>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}
