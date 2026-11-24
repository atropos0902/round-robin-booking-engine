import Link from 'next/link';
import { Problem, Shell } from '../components/Shell';
import { trpc } from '../utils/trpc';

export default function Home() {
  const links = trpc.links.useQuery();
  return (
    <Shell title="Book a meeting">
      <h1 className="text-3xl font-semibold tracking-tight">Book a meeting</h1>
      <p className="mt-2 text-muted">Pick a topic and a time. Whoever is next in turn and free will take it.</p>
      {links.error && <Problem>The list could not be loaded.</Problem>}
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {links.data?.map((l) => (
          <li key={l.slug}>
            <Link href={`/${l.slug}`} className="block rounded-lg border border-line bg-white p-5 hover:border-pine">
              <span className="block font-medium">{l.title}</span>
              <span className="mt-1 block text-sm text-muted">
                {l.durationMinutes} minutes, {l.hosts} {l.hosts === 1 ? 'host' : 'hosts'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
