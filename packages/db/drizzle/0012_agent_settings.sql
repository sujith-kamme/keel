-- Phase 7f: the single agent's model and prompt become each agent's starting values.
INSERT INTO "settings" ("key", "value", "updated_at", "updated_by")
SELECT k.new_key, s."value", now(), NULL
FROM "settings" s
JOIN (VALUES
  ('agent_model', 'policy_agent_model'),
  ('agent_model', 'refund_agent_model'),
  ('agent_prompt', 'policy_agent_prompt'),
  ('agent_prompt', 'refund_agent_prompt')
) AS k(old_key, new_key) ON s."key" = k.old_key
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
DELETE FROM "settings" WHERE "key" IN ('agent_model', 'agent_prompt');
