local typedefs = require "kong.db.schema.typedefs"


-- Verification needs a key to verify against, and one that exists.
local function check_secret(entity)
  local config = entity.config
  if not config.verify_signature then
    return true
  end

  -- A field left out arrives here as a null, not as nil.
  if config.secret_id == nil or config.secret_id == ngx.null then
    return nil, "secret_id is required to verify tokens"
  end

  local secret, err = kong.db.konggate_secrets:select({ id = config.secret_id })
  if err then
    return nil, "could not look the secret up: " .. err
  end
  if not secret then
    return nil, "there is no secret with this secret_id"
  end

  return true
end


return {
  name = "jwt-claim-forward",
  fields = {
    { consumer = typedefs.no_consumer },
    { protocols = typedefs.protocols_http },
    { config = {
        type = "record",
        fields = {
          -- Header the client sends the token in, with or without "Bearer ".
          { token_header = typedefs.header_name { required = true, default = "Authorization" } },

          -- Which claims to copy, and the header each one is forwarded in.
          -- A claim may be a dotted path into nested objects ("user.id").
          -- `required` rejects (401) a token that lacks the claim.
          { claims = {
              type = "array",
              required = true,
              default = {},
              elements = {
                type = "record",
                fields = {
                  { claim = { type = "string", required = true, len_min = 1 } },
                  { header = typedefs.header_name { required = true } },
                  { required = { type = "boolean", required = true, default = false } },
                },
              },
          } },
          -- Forward the whole payload, still base64url-encoded JSON, in this header.
          { payload_header = typedefs.header_name },
          -- Whether the upstream also receives the original token.
          { forward_token = { type = "boolean", required = true, default = true } },
          -- Answer 401 when the request carries no token, instead of
          -- forwarding it without the headers above.
          { strict = { type = "boolean", required = true, default = true } },

          -- Let a request through only when each claim holds one of its
          -- values (403 otherwise). An array claim passes if any item matches.
          { conditions = {
              type = "array",
              required = true,
              default = {},
              elements = {
                type = "record",
                fields = {
                  { claim = { type = "string", required = true, len_min = 1 } },
                  { values = {
                      type = "array",
                      required = true,
                      len_min = 1,
                      elements = { type = "string", len_min = 1 },
                  } },
                },
              },
          } },

          -- Off: the token is decoded and believed as is.
          { verify_signature = { type = "boolean", required = true, default = false } },
          -- The key to verify against, and with it the algorithm tokens must
          -- be signed with: the id of a konggate_secrets entry (see daos.lua).
          -- The key itself is never part of this config. (Not typedefs.uuid:
          -- that one fills itself in with a random id when left out.)
          { secret_id = { type = "string", uuid = true } },
          -- Reject expired (`exp`) and not-yet-valid (`nbf`) tokens.
          { verify_expiry = { type = "boolean", required = true, default = true } },
          -- Seconds of clock difference to forgive in those two checks.
          { leeway = { type = "integer", required = true, default = 0, between = { 0, 3600 } } },
          -- When set, `iss` must equal it and `aud` must equal or contain it.
          { issuer = { type = "string", len_min = 1 } },
          { audience = { type = "string", len_min = 1 } },
        },
    } },
  },
  entity_checks = {
    { custom_entity_check = {
        field_sources = { "config" },
        fn = check_secret,
    } },
  },
}
