'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

const LANDED_KEY = 'eve.landed';

/**
 * Sends the user to the page they chose as their default — once per browser
 * tab/session, so the first time the app opens they land there, while the
 * Dashboard button in the rail still shows the dashboard afterwards.
 *
 * The dashboard is rendered by the server before this can decide, so while
 * the choice is pending a plain cover hides it instead of flashing it.
 */
export function DefaultPageRedirect({ target }: { target: string }): JSX.Element | null {
  const router = useRouter();
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let alreadyLanded = false;
    try {
      alreadyLanded = window.sessionStorage.getItem(LANDED_KEY) === '1';
      window.sessionStorage.setItem(LANDED_KEY, '1');
    } catch {
      // Blocked storage: treat every visit as the first, which redirects only from "/" anyway.
    }
    if (alreadyLanded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPending(false);
      return;
    }
    router.replace(target);
  }, [router, target]);

  return pending ? <div className="eve-landing-cover" aria-hidden="true" /> : null;
}
