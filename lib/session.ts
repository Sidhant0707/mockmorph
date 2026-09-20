import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

function hasStringId(user: unknown): user is { id: string } {
  return (
    typeof user === 'object' &&
    user !== null &&
    'id' in user &&
    typeof (user as { id: unknown }).id === 'string' &&
    (user as { id: string }).id.length > 0
  );
}

/** Returns the signed-in user's id, or null if there is no valid session. */
export async function getSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const user: unknown = session?.user;
  return hasStringId(user) ? user.id : null;
}