import { useMemo, useRef, useState } from 'react';
import type { Species, Passive } from '../data/schema';
import { useTeams } from '../store/hooks';
import { newId } from '../store/localStore';
import { CLOUD_ROW_CAPS, createEmptyTeam, TEAM_SLOT_COUNT, type Team, type TeamSlot } from '../store/types';
import { PalIcon, PassiveChip, RowCapBadge } from './components';
import { useRulesetContext } from './RulesetContext';
import { useAuthContext } from './AuthContext';
import TeamDetailView from './TeamDetailView';

/** Loose structural check on parsed JSON before it's trusted as `Team[]` — enough to reject
 * garbage/foreign files without a full schema (the store layer doesn't validate its other
 * localStorage-backed types either; `parse<T>` in localStore.ts just trusts the cast). */
function isTeamArray(data: unknown): data is Team[] {
  if (!Array.isArray(data)) return false;
  return data.every((t) => {
    if (typeof t !== 'object' || t === null) return false;
    const team = t as Record<string, unknown>;
    return (
      typeof team.id === 'string' &&
      typeof team.name === 'string' &&
      typeof team.createdAt === 'string' &&
      Array.isArray(team.slots) &&
      (team.slots as unknown[]).every((s) => {
        if (typeof s !== 'object' || s === null) return false;
        const slot = s as Record<string, unknown>;
        return (slot.target === null || typeof slot.target === 'string') && Array.isArray(slot.desiredPassives);
      })
    );
  });
}

/** Team Builder: a list of named 5-slot teams (design mirrors `SavedPlansView`'s list+card
 * shape), each slot independently tracking its own attached breeding plan. */
export default function TeamsView() {
  const { passives, speciesById } = useRulesetContext();
  const passivesById = useMemo(() => new Map(passives.map((p) => [p.id, p])), [passives]);
  const [teams, setTeams] = useTeams();
  const { user } = useAuthContext();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [initialOpenIndex, setInitialOpenIndex] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;

  const openTeam = (id: string, slotIndex: number | null = null) => {
    setSelectedTeamId(id);
    setInitialOpenIndex(slotIndex);
  };
  const backToList = () => {
    setSelectedTeamId(null);
    setInitialOpenIndex(null);
  };

  const exportTeams = () => {
    const blob = new Blob([JSON.stringify(teams, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'palgorithm-teams-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTeams = async (file: File) => {
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setImportError('That file isn’t valid JSON.');
      return;
    }
    if (!isTeamArray(parsed)) {
      setImportError('That file doesn’t look like a Team Builder backup.');
      return;
    }
    // Never overwrite an existing team by id collision (e.g. re-importing the same backup) —
    // give the imported copy a fresh id instead, so the worst case is a harmless duplicate
    // rather than silently losing local edits.
    const existingIds = new Set(teams.map((t) => t.id));
    const imported = parsed.map((t) => (existingIds.has(t.id) ? { ...t, id: newId() } : t));
    setTeams([...teams, ...imported]);
  };

  const createTeam = () => {
    const name = draftName.trim() || `Team ${teams.length + 1}`;
    const team = createEmptyTeam(name, newId());
    setTeams([...teams, team]);
    setDraftName('');
    openTeam(team.id);
  };

  const removeTeam = (id: string) => {
    setTeams(teams.filter((t) => t.id !== id));
    if (selectedTeamId === id) backToList();
  };

  const renameTeam = (id: string, name: string) => {
    setTeams(teams.map((t) => (t.id === id ? { ...t, name } : t)));
  };

  const updateTeam = (team: Team) => {
    setTeams(teams.map((t) => (t.id === team.id ? team : t)));
  };

  if (selectedTeam) {
    return (
      <TeamDetailView
        team={selectedTeam}
        onUpdateTeam={updateTeam}
        onBack={backToList}
        initialOpenIndex={initialOpenIndex}
      />
    );
  }

  return (
    <main className="flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[1080px] px-4 pb-[60px] pt-[26px] md:px-[34px]">
        <div className="mb-0.5 flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="font-sans text-[22px] font-bold tracking-[-.4px]">Team builder</div>
            {user && <RowCapBadge count={teams.length} cap={CLOUD_ROW_CAPS.teams} />}
          </div>
          <div className="flex gap-2">
            <span
              onClick={exportTeams}
              className="cursor-pointer rounded-panel border border-border-card bg-white px-3 py-1.5 font-sans text-[12px] font-semibold text-[#6b655c] hover:border-muted-lighter"
            >
              ⤓ Export backup
            </span>
            <span
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer rounded-panel border border-border-card bg-white px-3 py-1.5 font-sans text-[12px] font-semibold text-[#6b655c] hover:border-muted-lighter"
            >
              ⤒ Import backup
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importTeams(file);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        <div className="mb-1.5 font-sans text-[13px] text-muted">
          Build a {TEAM_SLOT_COUNT}-Pal team, run a breeding plan for each slot, and revisit them any time.
        </div>
        {importError && <div className="mb-4 font-sans text-[12px] font-semibold text-brand-hover">{importError}</div>}

        <div className="mb-6 flex gap-2">
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createTeam()}
            placeholder="New team name…"
            className="flex-1 rounded-[7px] border border-border-input bg-white px-3 py-2 font-sans text-[13px] outline-none focus:border-primary"
          />
          <span
            onClick={createTeam}
            className="cursor-pointer rounded-panel bg-sidebar-bg px-4 py-2 font-sans text-[13px] font-semibold text-white hover:bg-sidebar-hover"
          >
            + New team
          </span>
        </div>

        {teams.length === 0 && (
          <div className="rounded-card border border-dashed border-border-input bg-panel-subtle p-10 text-center font-sans text-[13px] text-muted">
            No teams yet. Create one above to start planning a party.
          </div>
        )}

        <div className="flex flex-col gap-3">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              speciesById={speciesById}
              passivesById={passivesById}
              onOpen={() => openTeam(team.id)}
              onOpenSlot={(index) => openTeam(team.id, index)}
              onRemove={() => removeTeam(team.id)}
              onRename={(name) => renameTeam(team.id, name)}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function TeamCard({
  team,
  speciesById,
  passivesById,
  onOpen,
  onOpenSlot,
  onRemove,
  onRename,
}: {
  team: Team;
  speciesById: Map<string, Species>;
  passivesById: Map<string, Passive>;
  onOpen: () => void;
  onOpenSlot: (index: number) => void;
  onRemove: () => void;
  onRename: (name: string) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(team.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const plannedCount = team.slots.filter((s) => s.plan).length;

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border-card bg-white px-5 py-4 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
      {editingName ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className="rounded-[7px] border-[1.5px] border-primary px-2 py-1 font-sans text-[14px] font-bold text-ink outline-none"
          />
          <span
            onClick={() => {
              if (draftName.trim()) onRename(draftName.trim());
              setEditingName(false);
            }}
            className="cursor-pointer rounded-[6px] bg-primary px-2 py-1 font-mono text-[11px] font-semibold text-white"
          >
            Save
          </span>
          <span
            onClick={() => {
              setDraftName(team.name);
              setEditingName(false);
            }}
            className="cursor-pointer px-1 py-1 font-mono text-[11px] font-semibold text-muted"
          >
            Cancel
          </span>
        </div>
      ) : (
        <>
          <span className="font-sans text-[15px] font-bold">{team.name}</span>
          <span
            onClick={() => {
              setDraftName(team.name);
              setEditingName(true);
            }}
            className="cursor-pointer rounded-[5px] bg-[#f2ece0] px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-light hover:text-brand-hover"
          >
            ✎ rename
          </span>
        </>
      )}
      <span className="rounded-pill bg-[#f0ece2] px-[7px] py-[2px] font-sans text-[10px] font-semibold text-muted">
        {plannedCount}/{TEAM_SLOT_COUNT} planned
      </span>
      <span className="font-mono text-[11px] text-muted">{new Date(team.createdAt).toLocaleString()}</span>
      <div className="ml-auto flex items-center gap-2">
        {confirmingDelete ? (
          <>
            <span className="font-sans text-[12px] text-muted">Delete "{team.name}"?</span>
            <span
              onClick={onRemove}
              className="cursor-pointer rounded-panel bg-brand-hover px-3 py-1.5 font-sans text-[12px] font-semibold text-white hover:opacity-90"
            >
              Yes, delete
            </span>
            <span
              onClick={() => setConfirmingDelete(false)}
              className="cursor-pointer rounded-panel border border-border-card px-3 py-1.5 font-sans text-[12px] font-semibold text-muted-light hover:border-muted-lighter"
            >
              Cancel
            </span>
          </>
        ) : (
          <>
            <span
              onClick={onOpen}
              className="cursor-pointer rounded-panel border border-border-card px-3 py-1.5 font-sans text-[12px] font-semibold hover:border-primary hover:text-primary-dark"
            >
              Open
            </span>
            <span
              onClick={() => setConfirmingDelete(true)}
              className="cursor-pointer rounded-panel border border-border-card px-3 py-1.5 font-sans text-[12px] font-semibold text-muted-light hover:border-brand-hover hover:text-brand-hover"
            >
              Delete
            </span>
          </>
        )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        {team.slots.map((slot, index) => (
          <TeamSlotPreview
            key={index}
            slot={slot}
            speciesById={speciesById}
            passivesById={passivesById}
            onClick={() => onOpenSlot(index)}
          />
        ))}
      </div>
    </div>
  );
}

function TeamSlotPreview({
  slot,
  speciesById,
  passivesById,
  onClick,
}: {
  slot: TeamSlot;
  speciesById: Map<string, Species>;
  passivesById: Map<string, Passive>;
  onClick: () => void;
}) {
  const targetSpecies = slot.target ? speciesById.get(slot.target) : undefined;

  if (!slot.target || !targetSpecies) {
    return (
      <div
        onClick={onClick}
        className="flex min-h-[92px] cursor-pointer flex-col items-center justify-center gap-1 rounded-card border border-dashed border-border-input bg-panel-subtle p-3 text-center hover:border-muted-lighter"
      >
        <span className="font-sans text-[11px] text-muted-light">Empty slot</span>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="flex cursor-pointer flex-col items-center gap-1.5 rounded-card border border-border-card bg-white p-3 text-center shadow-card hover:border-primary"
    >
      <PalIcon icon={targetSpecies.icon} size={34} variant="card" />
      <div className="w-full truncate font-sans text-[12.5px] font-bold">{targetSpecies.displayName}</div>
      {slot.desiredPassives.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1">
          {slot.desiredPassives.map((id) => (
            <PassiveChip key={id} label={passivesById.get(id)?.displayName ?? id} tier={passivesById.get(id)?.tier} />
          ))}
        </div>
      )}
      {slot.plan && (
        <span
          className={`font-mono text-[10.5px] font-semibold ${
            slot.plan.result.feasible ? 'text-success-text' : 'text-brand-hover'
          }`}
        >
          {slot.plan.result.feasible ? `${slot.plan.result.combinationCount} combos` : 'infeasible'}
        </span>
      )}
    </div>
  );
}
