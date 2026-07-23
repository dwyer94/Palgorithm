-- team_slots never gained a column for TeamSlot.disabled (the cosmetic "grey this one
-- out" toggle added to the client type in store/types.ts) — remoteStore.ts's pushTeams/
-- fetchTeams silently dropped it on every cloud round-trip since signed-in users never
-- touch team_slots.disabled directly, only the shape returned by fetchTeams(). Guests on
-- localStorage were unaffected (localStore.ts persists the whole Team[] blob as-is).
alter table team_slots add column disabled boolean not null default false;
