-- Custom SQL migration file, put your code below! --
-- Daily bars stored before they kept the exchange's reference are dropped, so they are fetched
-- again with it; their bars go with them through the foreign key.
DELETE FROM `candle_series` WHERE `interval` = '1d';
