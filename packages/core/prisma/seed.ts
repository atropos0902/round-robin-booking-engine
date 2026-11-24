import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const weekdays = (startMinute: number, endMinute: number) =>
  [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute, endMinute }));

const HOSTS = [
  { name: 'Mere', timeZone: 'Pacific/Auckland', hours: weekdays(540, 1020) },
  { name: 'Asha', timeZone: 'Asia/Kolkata', hours: weekdays(600, 1140) },
  { name: 'Tomas', timeZone: 'Europe/Lisbon', hours: weekdays(540, 1080) },
  { name: 'Lucia', timeZone: 'America/Santiago', hours: weekdays(540, 1080) },
  { name: 'Drew', timeZone: 'America/New_York', hours: weekdays(480, 960) },
];

async function main(): Promise<void> {
  if ((await db.eventType.count()) > 0) return console.log('There is data already, nothing to do');
  const ids = new Map<string, string>();
  for (const { hours, ...host } of HOSTS) {
    const row = await db.host.create({ data: { ...host, email: `${host.name.toLowerCase()}@example.test`, hours: { create: hours } } });
    ids.set(host.name, row.id);
  }
  const members = (spec: Record<string, { weight?: number; priority?: number }>) =>
    Object.entries(spec).map(([name, rest]) => ({ hostId: ids.get(name)!, ...rest }));

  await db.eventType.create({
    data: {
      slug: 'product-tour',
      title: 'Product tour',
      durationMinutes: 30,
      slotStepMinutes: 30,
      bufferAfterMinutes: 10,
      minimumNoticeMinutes: 120,
      dailyCapPerHost: 6,
      members: { create: members({ Mere: { weight: 2 }, Asha: { weight: 2 }, Tomas: { weight: 3 }, Lucia: {}, Drew: {} }) },
    },
  });
  await db.eventType.create({
    data: {
      slug: 'onboarding',
      title: 'Onboarding call',
      durationMinutes: 45,
      slotStepMinutes: 15,
      bufferBeforeMinutes: 5,
      bufferAfterMinutes: 5,
      minimumNoticeMinutes: 60,
      members: { create: members({ Tomas: { priority: 1 }, Asha: { priority: 1 }, Drew: {} }) },
    },
  });

  // The release check books this one. Two hosts on opposite sides of the world, always open.
  const checks = await Promise.all(
    [
      { name: 'Check east', timeZone: 'Pacific/Auckland' },
      { name: 'Check west', timeZone: 'America/New_York' },
    ].map((h, i) =>
      db.host.create({
        data: {
          ...h,
          email: `check-${i}@example.test`,
          hours: { create: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) },
        },
      }),
    ),
  );
  await db.eventType.create({
    data: {
      slug: 'release-check',
      title: 'Release check',
      durationMinutes: 15,
      slotStepMinutes: 15,
      synthetic: true,
      members: { create: checks.map((c) => ({ hostId: c.id })) },
    },
  });
  console.log('Seeded five hosts, two rotations and the release check');
}

main().finally(() => db.$disconnect());
