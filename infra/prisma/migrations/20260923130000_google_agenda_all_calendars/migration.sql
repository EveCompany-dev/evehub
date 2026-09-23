-- Google Agenda connections read every calendar ticked in the Google account
-- ("Marketing Evecompany", "Foto e Video", ...), not just its main one, where
-- the team keeps almost nothing. "*" = all of them (see the google-calendar connector).
UPDATE "ConnectorInstance"
SET "config" = jsonb_set(COALESCE("config", '{}'::jsonb), '{calendarIds}', '["*"]'::jsonb)
WHERE "connectorId" = 'google-calendar';
