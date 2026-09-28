CREATE TABLE "device_state" (
	"device_id" text PRIMARY KEY NOT NULL,
	"battery" integer,
	"lock_state" text,
	"last_sync_at" text,
	"fetched_at" timestamp with time zone NOT NULL
);
