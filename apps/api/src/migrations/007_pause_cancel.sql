-- Lets an admin pause/resume or cancel an in-progress crawl from the UI,
-- rather than only ever being able to wait for it to finish or fail.
ALTER TABLE jobs DROP CONSTRAINT jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('queued','running','paused','completed','failed','cancelled'));
