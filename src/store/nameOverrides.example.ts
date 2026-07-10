/**
 * Template for seeding `DEFAULT_SETTINGS.live.nameOverrides` (src/store/types.ts) with your
 * own SteamID64 -> display name mapping, without committing it to a public repo.
 *
 * To use: copy this file to `nameOverrides.local.ts` (gitignored) in this same directory and
 * fill in your own entries. If `nameOverrides.local.ts` doesn't exist, types.ts falls back to
 * an empty seed — the app still builds and runs fine; you just won't have pre-populated
 * names, and can add them by hand from the Settings view instead.
 */
export const nameOverrides: Record<string, string> = {
  '76561198000000000': 'YourFriendName',
};
