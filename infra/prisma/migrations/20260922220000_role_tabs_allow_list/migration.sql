-- Role.tabs changes meaning: it used to list the tabs a cargo ADDED on top of
-- a fixed default set (chat, jobs, tables, connectors, automations, team), and
-- the isSocialMedia tag added 'scheduling'. From now on every tab is on by
-- default and Role.tabs is an allow-list: a tab it leaves out is hidden.
--
-- Rewrite every existing Role to the full set its members could already see,
-- so nobody with a cargo gains or loses a tab in the switch. A cargo held by
-- anyone tagged Social Media keeps 'scheduling' for all of its members.
UPDATE "Role" AS r
SET "tabs" = (
  SELECT COALESCE(jsonb_agg(tab ORDER BY tab), '[]'::jsonb)
  FROM (
    SELECT DISTINCT tab
    FROM (
      SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(r."tabs") = 'array' THEN r."tabs" ELSE '[]'::jsonb END) AS tab
      UNION
      SELECT unnest(ARRAY['chat', 'jobs', 'tables', 'connectors', 'automations', 'team'])
      UNION
      SELECT 'scheduling'
      WHERE EXISTS (SELECT 1 FROM "User" AS u WHERE u."roleId" = r."id" AND u."isSocialMedia")
    ) AS merged
    WHERE tab IN ('chat', 'jobs', 'tables', 'connectors', 'automations', 'scheduling', 'financial', 'team')
  ) AS allowed
);
