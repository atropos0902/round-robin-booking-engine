# How events leave the database

The event is written in the booking transaction. There is no moment where the booking exists and the event does not.

The relay leases up to ten rows, publishes them and marks them. It holds no transaction open during the network call. If it dies in between, the lease runs out and the rows are sent again. That is the one place where duplicates come from, and why every consumer drops repeats by event id.

**Order is not promised.** The relay sends in order, EventBridge and SQS do not keep it. Calendar sync therefore ignores what the event says and makes the calendar match the booking as it is now, then looks once more in case it changed during the request.

**Webhooks keep a record per subscriber.** One broken endpoint is tried again without calling the others a second time.

**One gap stays open.** A consumer that dies after its work and before its note does the work again. Calendar writes are repeatable. A mail could go out twice.

**Event shapes outlive a deploy.** A field may be added as optional. Anything else is a new version, with both accepted until the old one has drained.
