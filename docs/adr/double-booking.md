# How a host is kept from being booked twice

Three locks, each for something the others cannot do.

| Lock | Scope | What it is for |
| --- | --- | --- |
| Row lock on `event_type` | One rotation | Balances are read and written by one booking at a time |
| Advisory lock on the host | One host, every rotation | Puts inserts for the same host in line |
| `booking_no_overlap` | One host, every rotation | Refuses the overlap, whoever tries it |

Only the constraint guarantees anything. The other two make it correct to rely on the balances, and fast to lose.

**Why not only the row lock.** It cannot see a host who is in another rotation.

**Why not only the constraint.** Two inserts that exclude each other wait on each other. Postgres ends that as a deadlock, after a second. Eight rotations going for one host at the same time gave 21 deadlocks in 320 bookings. With the advisory lock the second insert waits its turn and gets the constraint error at once.

**Why a new transaction.** The failed insert has aborted the old one. The next try reads everything again, and the host who was lost is marked `lost_race`, so the saved reason says what happened.

**Lock order.** Rotation, then host. A transaction takes one of each, so they cannot form a cycle. Cancelling takes only the rotation.

Buffers are part of the blocked range and add up: ten minutes after one meeting and five before the next leave fifteen minutes between them.
