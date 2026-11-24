import { useRouter } from 'next/router';
import { Problem, Shell } from '../../components/Shell';
import { fullTime } from '../../utils/time';
import { trpc } from '../../utils/trpc';

export default function BookingPage() {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : '';
  const booking = trpc.booking.useQuery({ token }, { enabled: Boolean(token) });
  const cancel = trpc.cancel.useMutation({ onSettled: () => void booking.refetch() });
  const b = booking.data;

  return (
    <Shell title="Your meeting">
      {booking.error && <Problem>This link does not lead to a meeting.</Problem>}
      {b && (
        <div className="max-w-xl rounded-lg border border-line bg-white p-6">
          <p data-status={b.status} className={b.status === 'CONFIRMED' ? 'text-sm text-pine' : 'text-sm text-brick'}>
            {b.status === 'CONFIRMED' ? 'Confirmed' : 'Cancelled'}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {b.title} with {b.host.name}
          </h1>
          <p className="mt-3">{fullTime(b.start, b.invitee.timeZone)}</p>
          <p className="text-sm text-muted">{b.invitee.timeZone.replaceAll('_', ' ')}</p>
          <p className="mt-4 text-sm text-muted">
            Booking <code className="select-all">{b.id}</code>
          </p>
          {cancel.error && (
            <div className="mt-4">
              <Problem>{cancel.error.message}</Problem>
            </div>
          )}
          {b.status === 'CONFIRMED' && (
            <button className="quiet mt-6" disabled={cancel.isPending} onClick={() => cancel.mutate({ token })}>
              {cancel.isPending ? 'Cancelling' : 'Cancel the meeting'}
            </button>
          )}
        </div>
      )}
    </Shell>
  );
}
