CREATE TABLE `fintrack_profiles_v2` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fintrack_snapshots_v2` (
	`owner_user_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`client_updated_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `fintrack_profiles_v2`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fintrack_snapshots_v2_updated_at_idx` ON `fintrack_snapshots_v2` (`updated_at`);