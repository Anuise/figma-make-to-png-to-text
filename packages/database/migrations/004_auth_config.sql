ALTER TABLE exploration_configurations
  ADD COLUMN auth_steps JSONB,
  ADD COLUMN storage_state_env_var TEXT;
