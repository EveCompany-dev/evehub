import { describe, expect, it } from 'vitest';
import { landingOptions, resolveLandingPage } from './navigation';

const ALL_TABS = ['chat', 'jobs', 'tables', 'connectors', 'automations', 'scheduling', 'financial', 'team'];

describe('landingOptions', () => {
  it('offers the pages the user can open, including the Agenda sub-pages', () => {
    const hrefs = landingOptions(ALL_TABS).map((route) => route.href);
    expect(hrefs).toEqual(expect.arrayContaining(['/', '/jobs', '/clients', '/clients/calendar', '/agenda', '/scheduling', '/automations']));
    // Not places to open the app on.
    expect(hrefs).not.toContain('/settings');
    expect(hrefs).not.toContain('/perfil');
    expect(hrefs).not.toContain('/notifications');
  });

  it('no longer offers "Minha Agenda": the agenda is the team one only', () => {
    expect(landingOptions(ALL_TABS).map((route) => route.href)).not.toContain('/agenda?mine=1');
  });

  it('keeps the content calendar next to the agenda, under the same tab', () => {
    const hrefs = landingOptions(ALL_TABS).map((route) => route.href);
    expect(hrefs.indexOf('/clients/calendar')).toBe(hrefs.indexOf('/agenda') + 1);
  });

  it('hides what a cargo leaves out', () => {
    const hrefs = landingOptions(['chat', 'jobs', 'tables']).map((route) => route.href);
    expect(hrefs).toContain('/jobs');
    expect(hrefs).toContain('/clients');
    expect(hrefs).not.toContain('/agenda');
    expect(hrefs).not.toContain('/clients/calendar');
    expect(hrefs).not.toContain('/automations');
  });
});

describe('resolveLandingPage', () => {
  it('returns the chosen page when the user may open it', () => {
    expect(resolveLandingPage('/clients/calendar', ALL_TABS)).toBe('/clients/calendar');
    expect(resolveLandingPage('/automations', ALL_TABS)).toBe('/automations');
  });

  it('sends an old "Minha Agenda" choice to the team agenda', () => {
    expect(resolveLandingPage('/agenda?mine=1', ALL_TABS)).toBe('/agenda');
    expect(resolveLandingPage('/agenda?mine=1', ['chat'])).toBeNull();
  });

  it('falls back to the dashboard (null) for nothing, "/", unknown pages, and pages the user lost access to', () => {
    expect(resolveLandingPage(null, ALL_TABS)).toBeNull();
    expect(resolveLandingPage(undefined, ALL_TABS)).toBeNull();
    expect(resolveLandingPage('/', ALL_TABS)).toBeNull();
    expect(resolveLandingPage('/nao-existe', ALL_TABS)).toBeNull();
    expect(resolveLandingPage('/automations', ['chat', 'jobs'])).toBeNull();
    expect(resolveLandingPage('https://evil.example/', ALL_TABS)).toBeNull();
  });
});
