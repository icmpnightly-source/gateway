return {
  postgres = {
    up = [[
      CREATE TABLE IF NOT EXISTS "konggate_projects" (
        "id"            UUID                       PRIMARY KEY,
        "created_at"    TIMESTAMP WITH TIME ZONE   DEFAULT (CURRENT_TIMESTAMP(0) AT TIME ZONE 'UTC'),
        "updated_at"    TIMESTAMP WITH TIME ZONE   DEFAULT (CURRENT_TIMESTAMP(0) AT TIME ZONE 'UTC'),
        "name"          TEXT                       UNIQUE,
        "token_fields"  JSONB[]
      );
    ]],
  },
}
