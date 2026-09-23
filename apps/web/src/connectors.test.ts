import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listConnectors } from './connectors';

const repoRoot = new URL('../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, repoRoot), 'utf8');

/**
 * connectors.ts is a list of side-effect imports: forget a line and the
 * connector simply never appears, with nothing failing to say so. This is
 * that missing failure.
 */
describe('the connectors the app registers', () => {
  const byId = new Map(listConnectors().map((connector) => [connector.id, connector]));

  it('registers every connector package in the workspace', () => {
    expect([...byId.keys()].sort()).toEqual(
      ['calculator', 'calendar', 'chat', 'demo', 'google-ads', 'google-calendar', 'meta', 'notes', 'notion', 'overview', 'timer', 'todo'].sort(),
    );
  });

  it('gives every connector that authenticates a schema for its secrets', () => {
    // The setup form asks for whatever the schema declares; a connector that
    // says it authenticates but describes nothing would render an empty form.
    for (const connector of listConnectors().filter((item) => item.auth !== 'none')) {
      expect(connector.credentialsSchema, connector.id).toBeDefined();
      expect(connector.capabilities.read, connector.id).toBe(true);
    }
  });

  /**
   * A connector package the production images never copy breaks the Docker
   * build and nothing else — which is how c7bfec4 shipped. The deps stage
   * lists each package.json by hand, so the list has to be checked by hand too.
   */
  it('copies every connector package into both production images', () => {
    const packages = readdirSync(new URL('packages/connectors/', repoRoot), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(packages).toContain('google-ads');

    for (const dockerfile of ['infra/Dockerfile.web', 'infra/Dockerfile.worker']) {
      const contents = read(dockerfile);
      for (const name of packages) {
        expect(contents, `${dockerfile} is missing ${name}`).toContain(`COPY packages/connectors/${name}/package.json`);
      }
    }
  });

  it('reads Google Ads without being able to touch a live campaign', () => {
    const googleAds = byId.get('google-ads')!;
    expect(googleAds.category).toBe('external');
    expect(googleAds.auth).toBe('oauth2');
    expect(googleAds.capabilities).toEqual({ read: true, write: false, webhook: false });
  });

  it('keeps Tarefas a local, credential-free module with no connector data', () => {
    const todo = byId.get('todo')!;
    expect(todo.label).toBe('Tarefas');
    expect(todo.category).toBe('local');
    expect(todo.auth).toBe('none');
    expect(todo.capabilities).toEqual({ read: true, write: false, webhook: false });
  });

  it('gives a writable connector the version read that undo depends on', () => {
    for (const connector of listConnectors().filter((item) => item.capabilities.write)) {
      expect(connector.write, connector.id).toBeTypeOf('function');
      expect(connector.readVersion, connector.id).toBeTypeOf('function');
    }
  });
});
