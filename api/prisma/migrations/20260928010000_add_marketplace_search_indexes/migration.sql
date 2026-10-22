CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Service_title_trigram_search_idx"
ON "Service" USING GIN (lower("title") gin_trgm_ops);

CREATE INDEX "Service_description_trigram_search_idx"
ON "Service" USING GIN (lower("description") gin_trgm_ops);

CREATE INDEX "Service_full_text_search_idx"
ON "Service" USING GIN ((
  setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce("description", '')), 'B')
));

CREATE INDEX "User_displayName_trigram_search_idx"
ON "User" USING GIN (lower("displayName") gin_trgm_ops);

CREATE INDEX "Category_name_trigram_search_idx"
ON "Category" USING GIN (lower("name") gin_trgm_ops);

CREATE INDEX "School_name_trigram_search_idx"
ON "School" USING GIN (lower("name") gin_trgm_ops);

CREATE INDEX "School_shortName_trigram_search_idx"
ON "School" USING GIN (lower("shortName") gin_trgm_ops);
