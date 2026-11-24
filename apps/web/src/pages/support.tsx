import { type FormEvent } from 'react';
import { Problem, Shell } from '../components/Shell';
import { supportKey, trpc } from '../utils/trpc';

export default function Support() {
  const explain = trpc.explain.useMutation();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    supportKey.current = String(form.get('key'));
    explain.mutate({ bookingId: String(form.get('id')).trim() });
  }

  return (
    <Shell title="Why this host?">
      <h1 className="text-3xl font-semibold tracking-tight">Why this host?</h1>
      <p className="mt-2 text-muted">The reason is saved with the booking, so this reads it back and works nothing out again.</p>
      <form onSubmit={submit} className="mt-6 flex max-w-2xl flex-wrap items-end gap-3">
        <label className="grow text-sm">
          <span className="mb-1 block text-muted">Booking</span>
          <input name="id" required className="field" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Support key</span>
          <input name="key" type="password" required autoComplete="off" className="field" />
        </label>
        <button className="primary" disabled={explain.isPending}>
          Look it up
        </button>
      </form>
      <div className="mt-6 max-w-2xl">
        {explain.error && (
          <Problem>{explain.error.data?.code === 'BAD_REQUEST' ? 'That is not a booking number' : explain.error.message}</Problem>
        )}
        {explain.data && (
          <ol className="divide-y divide-line rounded-lg border border-line bg-white">
            {explain.data.reasons.map((r, i) => (
              <li key={r} className={i === 0 ? 'px-5 py-3 font-medium' : 'px-5 py-3 text-sm text-muted'}>
                {r}
              </li>
            ))}
          </ol>
        )}
        {explain.data && explain.data.attempts > 1 && (
          <p className="mt-3 text-sm text-muted">It took {explain.data.attempts} tries, because a host was taken in the same moment.</p>
        )}
      </div>
    </Shell>
  );
}
