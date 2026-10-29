-- Custom SQL migration file, put your code below! --
-- An outcome kept with the cash gone ex added back was judged at its close plus that cash.
UPDATE `forecasts` SET `outcome` = json_remove(json_set(`outcome`, '$.adjustedClose', json_extract(`outcome`, '$.close') + json_extract(`outcome`, '$.distributed')), '$.distributed') WHERE `outcome` IS NOT NULL;
