-- A forecast kept before a decisions model read its facts reads as one whose facts none read.
UPDATE `forecasts` SET `forecast` = json_set(`forecast`, '$.evidence', json('null')) WHERE json_type(`forecast`, '$.evidence') IS NULL;
