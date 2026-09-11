import { Flex } from '@chakra-ui/react';
import type { AvatarColor } from '@shared/types';
import { AVATAR_PALETTE, initialsFor } from '@/lib/avatar';

interface Props {
  name: string;
  color: AvatarColor;
  /** Uploaded picture or provider photo. Falls back to initials when null or when it fails to load. */
  src?: string | null;
  size?: number;
}

/**
 * A circular avatar: the picture if there is one, initials on the account's color if not.
 *
 * `onError` matters more than it looks. The provider photo is a remote URL we don't control — a
 * Google account that changes its picture, or a user with images blocked, leaves a broken icon in
 * the header of every page. Hiding the failed image reveals the initials underneath it, so the
 * worst case is a plain avatar rather than a broken one.
 */
export function Avatar({ name, color, src, size = 28 }: Props) {
  const palette = AVATAR_PALETTE[color];

  return (
    <Flex
      align="center"
      justify="center"
      position="relative"
      overflow="hidden"
      flexShrink={0}
      borderRadius="full"
      boxSize={`${size}px`}
      bg={palette.bg}
      color={palette.fg}
      fontWeight="bold"
      fontSize={`${Math.max(10, Math.round(size * 0.4))}px`}
      lineHeight="1"
      userSelect="none"
    >
      {initialsFor(name)}
      {src && (
        <img
          src={src}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      )}
    </Flex>
  );
}
