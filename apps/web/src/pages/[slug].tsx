import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { BookingForm } from '../components/BookingForm';
import { Problem, Shell } from '../components/Shell';
import { addDays, clock, dayLabel, today, zones } from '../utils/time';
import { trpc } from '../utils/trpc';

export default function BookPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === 'string' ? router.query.slug : '';
  // Unknown on the server, so it is filled in after the first render.
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [start, setStart] = useState<string | null>(null);
  useEffect(() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  const startDate = timeZone ? addDays(today(timeZone), page * 7) : '';
  const week = trpc.week.useQuery(
    { slug, startDate, timeZone: timeZone ?? '' },
    { enabled: Boolean(slug && timeZone), placeholderData: (previous) => previous },
  );

  if (week.error?.data?.code === 'NOT_FOUND') {
    return (
      <Shell title="Not found">
        <Problem>{week.error.message}</Problem>
      </Shell>
    );
  }

  const empty = week.data?.days.every((d) => d.slots.length === 0);
  return (
    <Shell title={week.data?.title ?? 'Book a meeting'}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{week.data?.title ?? ' '}</h1>
          <p className="mt-1 text-muted">{week.data ? `${week.data.durationMinutes} minutes` : ' '}</p>
        </div>
        {timeZone && (
          <label className="text-sm">
            <span className="mb-1 block text-muted">Times shown in</span>
            <select
              className="field"
              value={timeZone}
              onChange={(e) => {
                setTimeZone(e.target.value);
                setStart(null);
              }}
            >
              {zones(timeZone).map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <section className="mt-6 rounded-lg border border-line bg-white p-5">
        {start && timeZone ? (
          <BookingForm
            key={start}
            slug={slug}
            start={start}
            timeZone={timeZone}
            onBack={() => setStart(null)}
            onTaken={() => void week.refetch()}
          />
        ) : (
          <>
            <div className="mb-4 flex justify-between">
              <button className="quiet" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Earlier
              </button>
              <button className="quiet" disabled={page >= 7} onClick={() => setPage(page + 1)}>
                Later
              </button>
            </div>
            {week.error && <Problem>Times could not be loaded.</Problem>}
            {empty && <p className="py-8 text-center text-muted">Nothing is free in these seven days.</p>}
            {!empty && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7" aria-busy={week.isFetching}>
                {week.data?.days.map((day) => {
                  const label = dayLabel(day.date);
                  return (
                    <div key={day.date}>
                      <h2 className="mb-2 text-sm">
                        <span className="block font-medium">{label.weekday}</span>
                        <span className="text-muted">{label.day}</span>
                      </h2>
                      <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
                        {day.slots.map((s) => (
                          <li key={s}>
                            <button
                              data-slot={s}
                              className="w-full rounded-md bg-pine-soft py-1.5 text-sm tabular-nums text-pine-dark hover:bg-pine hover:text-white"
                              onClick={() => setStart(s)}
                            >
                              {clock(s, timeZone!)}
                            </button>
                          </li>
                        ))}
                        {day.slots.length === 0 && <li className="text-sm text-muted">None</li>}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>
    </Shell>
  );
}
