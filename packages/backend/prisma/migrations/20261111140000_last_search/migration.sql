-- The last search in a chat, so "more", a kept budget and "go back" survive a restart.
ALTER TABLE "conversations" ADD COLUMN "last_search" JSONB;
