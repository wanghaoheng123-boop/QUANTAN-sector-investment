import NextAuth from 'next-auth'
import { getAuthOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler = NextAuth(getAuthOptions() as any)

export { handler as GET, handler as POST }
