-- Custom SQL migration file, put your code below! --
-- A task kept before a change's scope could be set ran for every change, of every listing the user
-- holds and watches and of every theme.
UPDATE `scheduled_tasks` SET `schedule` = json_set(`schedule`, '$.scope', json('{"kinds":["falsifier-met","event-passed","signpost-met"],"listings":null,"themes":null}')) WHERE json_extract(`schedule`, '$.kind') = 'on-change' AND json_type(`schedule`, '$.scope') IS NULL;
--> statement-breakpoint
-- A run kept before runs kept their changes said nothing of what it was started for.
UPDATE `scheduled_tasks` SET `last_run` = json_set(`last_run`, '$.changes', json('[]')) WHERE `last_run` IS NOT NULL AND json_type(`last_run`, '$.changes') IS NULL;
