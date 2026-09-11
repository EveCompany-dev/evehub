import { prisma } from '@eve/core';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { getSessionUser } from '../../lib/session';
import { ProfileForm } from './ProfileForm';

export const dynamic = 'force-dynamic';

export default async function ProfilePage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, name: true, email: true, image: true, isOwner: true, passwordHash: true },
  });

  if (!row) redirect('/login');

  return (
    <ProfileForm
      initial={{
        id: row.id,
        name: row.name,
        email: row.email,
        image: row.image,
        isOwner: row.isOwner,
        // Só o fato de existir chega ao cliente; o hash nunca sai do servidor.
        hasPassword: Boolean(row.passwordHash),
      }}
    />
  );
}
