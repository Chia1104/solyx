-- Custom SQL migration file, put your code below! --
-- Articles and social posts come from whichever web search the user picks; items keep their scores.
UPDATE `news_items` SET `source` = 'web-article' WHERE `source` = 'firecrawl-news';
--> statement-breakpoint
UPDATE `news_items` SET `source` = 'web-social' WHERE `source` = 'firecrawl-social';
--> statement-breakpoint
DELETE FROM `news_source_health` WHERE `source` IN ('firecrawl-news', 'firecrawl-social');
