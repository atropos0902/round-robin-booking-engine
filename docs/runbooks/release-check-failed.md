# Release check failed

**Alarm:** incident.io, "The release check failed". Customers probably cannot book.

1. Roll the two Vercel projects back to the previous deployment. Do this first. Old code runs on the new schema, that is what the two-release rule is for.
2. Run the check again from Checkly. Green: the release was the cause, go on to 4.
3. Still red: it is not the release. Check the database, then [the outbox](outbox-stuck.md).
4. Sentry, filtered to the release. Elastic, `service.version: "<release>"` and `log.level: error`.

The check books the synthetic link, so there are no mails to apologise for. If it failed between booking and cancelling, its booking is still there. The check hosts are never full, so it can stay.

**Done when** the check has passed in all three locations.
