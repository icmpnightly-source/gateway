local typedefs = require "kong.db.schema.typedefs"
local openssl_pkey = require "resty.openssl.pkey"
local algorithms = require "kong.plugins.jwt-claim-forward.algorithms"


-- A key has to be one the algorithm can use, and one that loads.
local function check_value(entity)
  local value = entity.value

  if algorithms.hmac[entity.algorithm] then
    if entity.value_is_base64 then
      local standard = value:gsub("%-", "+"):gsub("_", "/")
      standard = standard .. string.rep("=", (4 - #standard % 4) % 4)
      if not ngx.decode_base64(standard) then
        return nil, "value is not valid base64"
      end
    end

    return true
  end

  local ok, key = pcall(openssl_pkey.new, value)
  if not ok or not key then
    return nil, "value is not a valid PEM public key, which " .. entity.algorithm .. " needs"
  end

  return true
end


return {
  -- The keys tokens are verified against, kept under a name. Rules refer to
  -- one by id, so a key's value sits in no plugin config.
  {
    name = "konggate_secrets",
    primary_key = { "id" },
    -- Generated CRUD endpoints would hand the value back to anyone who asks.
    -- api.lua serves this entity instead, and never returns it.
    generate_admin_api = false,
    fields = {
      { id = typedefs.uuid },
      { created_at = typedefs.auto_timestamp_s },
      { updated_at = typedefs.auto_timestamp_s },
      { name = { type = "string", required = true, unique = true, len_min = 1, len_max = 64 } },
      { algorithm = { type = "string", required = true, one_of = algorithms.all } },
      -- A shared secret for the HS* algorithms, a PEM public key for the rest.
      { value = { type = "string", required = true, len_min = 1, encrypted = true } },
      { value_is_base64 = { type = "boolean", required = true, default = false } },
    },
    entity_checks = {
      { custom_entity_check = {
          field_sources = { "algorithm", "value", "value_is_base64" },
          fn = check_value,
      } },
    },
  },

  -- What the UI groups its rules ("works") under. Nothing here is secret, so
  -- Kong's generated CRUD endpoints serve it, at /konggate_projects.
  {
    name = "konggate_projects",
    primary_key = { "id" },
    fields = {
      { id = typedefs.uuid },
      { created_at = typedefs.auto_timestamp_s },
      { updated_at = typedefs.auto_timestamp_s },
      { name = { type = "string", required = true, unique = true, len_min = 1, len_max = 64 } },
      -- The shape of the project's tokens, as last read off a sample: which
      -- fields there are to choose from. Paths and types only, no values.
      { token_fields = {
          type = "array",
          required = true,
          default = {},
          elements = {
            type = "record",
            fields = {
              { path = { type = "string", required = true, len_min = 1 } },
              { type = { type = "string", required = true, one_of = { "string", "number", "boolean", "array", "object", "null" } } },
            },
          },
      } },
    },
  },
}
