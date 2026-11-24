import { useRouter } from 'next/router';
import { type FormEvent, useState } from 'react';
import { fullTime } from '../utils/time';
import { trpc } from '../utils/trpc';
import { Problem } from './Shell';

interface Props {
  slug: string;
  start: string;
  timeZone: string;
  onBack: () => void;
  onTaken: () => void;
}

export function BookingForm({ slug, start, timeZone, onBack, onTaken }: Props) {
  const router = useRouter();
  // One key per opened form: a double click or a retry after a timeout stays one meeting.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const book = trpc.book.useMutation({
    onSuccess: (b) => void router.push(`/bookings/${b.manageToken}`),
    onError: (e) => {
      if (e.data?.reason === 'no_host_available') onTaken();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    book.mutate({
      slug,
      start,
      idempotencyKey,
      invitee: { name: String(form.get('name')), email: String(form.get('email')), timeZone },
    });
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      <p className="text-sm">
        <span className="block font-medium">{fullTime(start, timeZone)}</span>
        <span className="text-muted">{timeZone.replaceAll('_', ' ')}</span>
      </p>
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Your name</span>
        <input name="name" required maxLength={120} autoComplete="name" className="field" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Email</span>
        <input name="email" type="email" required maxLength={254} autoComplete="email" className="field" />
      </label>
      {book.error && <Problem>{book.error.data?.reason ? book.error.message : 'That did not go through. Try again.'}</Problem>}
      <div className="flex gap-2">
        <button type="submit" className="primary" disabled={book.isPending || book.isSuccess}>
          {book.isPending ? 'Booking' : 'Book the meeting'}
        </button>
        <button type="button" className="quiet" onClick={onBack}>
          Other times
        </button>
      </div>
    </form>
  );
}
