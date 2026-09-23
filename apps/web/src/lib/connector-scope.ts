/**
 * Who a connection belongs to. A client's connections are its own accounts:
 * social media (Meta: Instagram + Facebook) and its Google Ads (ads data
 * only) — what the client page offers. Every other outside service (Notion,
 * Google Agenda, the Claude assistant) is the team's own, on the Equipe page.
 */
export const CLIENT_CONNECTOR_IDS: ReadonlySet<string> = new Set(['meta', 'google-ads']);

export function isClientConnector(connector: { id: string }): boolean {
  return CLIENT_CONNECTOR_IDS.has(connector.id);
}

export function isTeamConnector(connector: { id: string; category: string }): boolean {
  return connector.category === 'external' && !CLIENT_CONNECTOR_IDS.has(connector.id);
}
