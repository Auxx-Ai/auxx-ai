-- Pre-launch: no users to preserve. Wipe before changing the column type
-- because there is no usable text->jsonb<TiptapDoc> cast. Org-installed
-- copies re-populate from the .md system source on next install.
TRUNCATE TABLE "PromptTemplate";
ALTER TABLE "PromptTemplate" ALTER COLUMN "prompt" SET DATA TYPE jsonb USING prompt::jsonb;
