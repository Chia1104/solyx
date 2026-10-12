-- Custom SQL migration file, put your code below! --
-- A forecast kept before base rates were measured has none, which reads as `null` like one whose
-- bars held too little history.
UPDATE `forecasts` SET `forecast` = json_set(`forecast`, '$.baseRates', json('null')) WHERE json_type(`forecast`, '$.baseRates') IS NULL;
