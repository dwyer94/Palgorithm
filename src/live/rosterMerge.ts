import type { RosterEntry as SolverRosterEntry } from '../solver/types';
import type { RosterEntry } from '../store/types';
import type { LivePlayerPals, PlayerIdentifier } from './types';

/**
 * Builds the solver's minimal `{species, gender, passives}` shape from the local roster
 * plus any selected connected players' live pals (docs/UI_REQUIREMENTS.md: live pals are a
 * separate pool, functionally identical to roster pals once merged here, never persisted
 * into the local roster). Pals with an unresolved species or gender are excluded — the
 * solver has no concept of an unknown species — callers are responsible for surfacing
 * unresolved counts to the user elsewhere (e.g. the Server Pals view), not silently here.
 */
export function buildRosterForSolver(
  localRoster: RosterEntry[],
  selectedPlayerIds: Set<PlayerIdentifier>,
  palsByPlayer: Record<PlayerIdentifier, LivePlayerPals | undefined>,
): SolverRosterEntry[] {
  const local: SolverRosterEntry[] = localRoster.map((r) => ({
    species: r.species,
    gender: r.gender,
    passives: r.passives,
  }));

  const live: SolverRosterEntry[] = Array.from(selectedPlayerIds).flatMap((id) => {
    const playerPals = palsByPlayer[id];
    if (!playerPals) return [];
    return playerPals.pals
      .filter((pal) => pal.species !== null && pal.gender !== null)
      .map((pal) => ({ species: pal.species!, gender: pal.gender!, passives: pal.passives }));
  });

  return [...local, ...live];
}
