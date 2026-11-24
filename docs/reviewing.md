# Reviewing a high-risk change

A pull request is high risk when it touches assignment or availability, migrations, or event shapes. CI puts the label on and asks for a rollback note.

**Assignment and availability**

- Is the decision still a function of its inputs? No clock, no randomness, no database.
- Do balances still add up to zero, also after a cancellation?
- Does it hold on the day the clocks change, in a zone with a 30 or 45 minute offset, and where midnight does not exist?
- Break it on purpose. Which test fails? If none does, the change is missing one.

**Locks**

- Rotation first, then host. Anything that takes them the other way round is a deadlock waiting for traffic.
- Is anything slow done while a lock is held?

**Migrations**

- Old code runs on the new schema for the length of a deploy, and again after a rollback.
- The first release adds, the second removes. The second names the first with `-- contract:`.
- Does it take a lock on `booking` that would stop people from booking?

**Events**

- There are messages of the old shape in the queues right now. What happens to them?
