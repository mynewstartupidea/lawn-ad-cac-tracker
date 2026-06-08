-- Adds a unique constraint on sales.email to prevent duplicate sales rows.
-- This enforces deduplication at the DB level, eliminating the race condition
-- where two concurrent Slack events (message + message_changed) both insert
-- before either can see the other's row.
--
-- Run this once in the Supabase SQL editor before deploying the webhook change.

ALTER TABLE sales ADD CONSTRAINT sales_email_unique UNIQUE (email);
