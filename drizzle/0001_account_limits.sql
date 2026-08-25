CREATE TABLE `user_credential` (
	`user_id` text PRIMARY KEY NOT NULL,
	`openai_key` text,
	`openai_hint` text,
	`mistral_key` text,
	`mistral_hint` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `run` ADD `turns` integer DEFAULT 0 NOT NULL;