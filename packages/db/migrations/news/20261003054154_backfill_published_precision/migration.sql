-- Custom SQL migration file, put your code below! --
-- Filings and PTT post ids give the minute; search engines' ages are claimed only to the day.
UPDATE `news_items`
SET `published_precision` = CASE
	WHEN `source` IN ('mops-announcements', 'ptt-stock') THEN 'minute'
	ELSE 'day'
END
WHERE `published_at` IS NOT NULL;
