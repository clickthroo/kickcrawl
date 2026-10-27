-- The Soccer Archive's crawl was stuck at 72/50000 pages for several minutes
-- straight, 100% of browser-rendered fetch attempts failing with Chromium
-- "Failed to launch zygote process" (a container-level resource exhaustion
-- symptom, not an application bug) - this site was the single biggest new
-- consumer of browser-rendered fetches at the time. Turning off forced
-- browser rendering lets its pages fetch over plain HTTP instead, sidestepping
-- Chromium launches for this site entirely.
UPDATE sites SET use_browser_default = false WHERE base_url = 'https://thesoccerarchive.com';
