-- Custom SQL migration file, put your code below! --
-- An outcome kept before distributions were added back was judged on the close as it traded,
-- which is what none going ex reads as.
UPDATE `forecasts` SET `outcome` = json_set(`outcome`, '$.distributed', 0) WHERE `outcome` IS NOT NULL AND json_type(`outcome`, '$.distributed') IS NULL;
