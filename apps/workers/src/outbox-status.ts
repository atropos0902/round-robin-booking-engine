import { db, outboxStatus } from '@rr/core';

outboxStatus(db()).then((s) => {
  console.log(`${s.pending} waiting, oldest ${s.oldestSeconds}s, ${s.retried} tried more than once`);
  return db().$disconnect();
});
