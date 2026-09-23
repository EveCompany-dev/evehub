/**
 * Who a connection belongs to. A client's connections are its social media
 * accounts (Meta: Instagram + Facebook) — what the client page offers.
 * Every other outside service (Notion, Google Agenda, Google Ads, the Claude
 * assistant) is the team's own, connected from the Equipe page.
 */
export const CLIENT_CONNECTOR_IDS: ReadonlySet<string> = new Set(['meta']);

export function isClientConnector(connector: { id: string }): boolean {
  return CLIENT_CONNECTOR_IDS.has(connector.id);
}

export function isTeamConnector(connector: { id: string; category: string }): boolean {
  return connector.category === 'external' && !CLIENT_CONNECTOR_IDS.has(connector.id);
}
