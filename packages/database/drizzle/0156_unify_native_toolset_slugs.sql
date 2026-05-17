-- Rewrite native toolset slugs in `Agent.toolsets` JSONB array. Pre-launch,
-- no backcompat. See plans/kopilot/agents/tools/unified-app-hierarchy.md §3.1.
--
-- `Agent.toolsets` is a JSONB array of `ToolsetEntry { slug, ... }`. Walk each
-- agent's array, rewrite the `slug` field in-place using the legacy → unified
-- mapping, and write the new array back.
UPDATE "Agent" SET "toolsets" = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN elem->>'slug' = 'mail.threads'     THEN jsonb_set(elem, '{slug}', '"auxx:mail:threads"')
      WHEN elem->>'slug' = 'mail.compose'     THEN jsonb_set(elem, '{slug}', '"auxx:mail:compose"')
      WHEN elem->>'slug' = 'mail.drafts'      THEN jsonb_set(elem, '{slug}', '"auxx:mail:drafts"')
      WHEN elem->>'slug' = 'entities.search'  THEN jsonb_set(elem, '{slug}', '"auxx:entities:search"')
      WHEN elem->>'slug' = 'entities.write'   THEN jsonb_set(elem, '{slug}', '"auxx:entities:write"')
      WHEN elem->>'slug' = 'comments.read'    THEN jsonb_set(elem, '{slug}', '"auxx:comments:read"')
      WHEN elem->>'slug' = 'comments.write'   THEN jsonb_set(elem, '{slug}', '"auxx:comments:write"')
      WHEN elem->>'slug' = 'knowledge'        THEN jsonb_set(elem, '{slug}', '"auxx:knowledge"')
      WHEN elem->>'slug' = 'kb.write'         THEN jsonb_set(elem, '{slug}', '"auxx:kb:write"')
      WHEN elem->>'slug' = 'tasks.read'       THEN jsonb_set(elem, '{slug}', '"auxx:tasks:read"')
      WHEN elem->>'slug' = 'tasks.write'      THEN jsonb_set(elem, '{slug}', '"auxx:tasks:write"')
      WHEN elem->>'slug' = 'docs'             THEN jsonb_set(elem, '{slug}', '"auxx:docs"')
      WHEN elem->>'slug' = 'actors'           THEN jsonb_set(elem, '{slug}', '"auxx:actors"')
      ELSE elem
    END
  ), '[]'::jsonb)
  FROM jsonb_array_elements("toolsets") AS elem
)
WHERE jsonb_typeof("toolsets") = 'array' AND jsonb_array_length("toolsets") > 0;
