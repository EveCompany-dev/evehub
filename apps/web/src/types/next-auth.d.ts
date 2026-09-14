import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      isOwner: boolean;
      isSocialMedia: boolean;
      /** null = no Role assigned. See lib/permissions.ts's TabSubject/parseRoleTabs. */
      roleTabs: string[] | null;
      workspaceId: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sub?: string;
  }
}

export {};
