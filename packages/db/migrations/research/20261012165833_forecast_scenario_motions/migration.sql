-- A forecast kept before each scenario was put to a vote was voted on whole or not at all, which
-- reads as no vote on its scenarios; the vote on the whole says nothing of any one of them.
UPDATE `forecasts` SET `forecast` = json_set(json_remove(`forecast`, '$.council'), '$.motions', json('null')) WHERE json_type(`forecast`, '$.motions') IS NULL;
