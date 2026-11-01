UPDATE agents
SET configuration = jsonb_set(
  COALESCE(configuration, '{}'::jsonb),
  '{knowledge}',
  jsonb_build_object(
    'enabled', true,
    'source_ids', COALESCE(configuration #> '{knowledge,source_ids}', '[]'::jsonb),
    'search_method', COALESCE(configuration #>> '{knowledge,search_method}', 'hybrid'),
    'max_results', COALESCE((configuration #>> '{knowledge,max_results}')::int, 5),
    'failure_policy', COALESCE(configuration #>> '{knowledge,failure_policy}', 'closed')
  ),
  true
)
WHERE COALESCE(configuration, '{}'::jsonb) = '{}'::jsonb
  AND COALESCE(model_settings->>'knowledge_enabled', 'false') = 'true';
