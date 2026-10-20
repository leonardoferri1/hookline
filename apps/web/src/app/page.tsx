import { redirect } from 'next/navigation';
import { readApiKey } from '@/lib/session';

/** The console has no landing page: an operator either has a session or needs to start one. */
export default async function Home() {
  redirect((await readApiKey()) ? '/overview' : '/connect');
}
