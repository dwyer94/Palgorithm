-- Add `enabled` (default false) to the `live` jsonb default literal, matching the new
-- master-switch field in LiveConnectionSettings (src/store/types.ts). A saved `baseUrl`
-- alone no longer auto-connects on load — connecting reaches out to a (usually
-- private-network) proxy, which triggers the browser's own permission prompt, and firing
-- that unprompted on every sign-in (including on a device that never opted in, once cloud
-- sync carries the setting over) reads as alarming. Existing rows are unaffected by this
-- default change; remoteStore.ts's rowToSettings() merges DEFAULT_SETTINGS.live over
-- whatever a pre-existing row has, so rows saved before this field existed also come back
-- with enabled: false rather than undefined.
alter table settings
  alter column live set default '{
    "enabled": false,
    "baseUrl": "",
    "bearerToken": "",
    "autoPollEnabled": true,
    "autoPollIntervalSeconds": 300,
    "nameOverrides": {},
    "identityLinks": {}
  }'::jsonb;
