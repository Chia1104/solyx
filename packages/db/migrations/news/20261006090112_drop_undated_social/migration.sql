-- Custom SQL migration file, put your code below! --
-- Social posts are dated by their ids now. Undated ones, profiles among them, are mostly older than
-- any search reaches; recent ones come back dated at the next collection.
DELETE FROM `news_items` WHERE `source` = 'web-social' AND `published_at` IS NULL;
