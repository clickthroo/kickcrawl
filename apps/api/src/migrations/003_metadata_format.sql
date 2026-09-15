-- Adds a 'metadata' scrape_results format so title/description/image (the
-- human-friendly summary of a scraped item) can be stored alongside the raw
-- markdown/extracted rows, without changing the public API's response shape.
ALTER TABLE scrape_results DROP CONSTRAINT scrape_results_format_check;
ALTER TABLE scrape_results ADD CONSTRAINT scrape_results_format_check
  CHECK (format IN ('markdown','html','links','screenshot','extracted','metadata'));
