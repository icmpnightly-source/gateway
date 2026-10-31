-- Reads a bearer JWT and tells the upstream what was in it: chosen claims
-- become request headers. Optionally verifies the token first (signature,
-- expiry, issuer, audience) and gates the route on claim values.
--
-- With `verify_signature` off the token is only decoded: anyone can mint a
-- token carrying any claims, so nothing forwarded from it can be trusted.

local cjson = require "cjson.safe"
-- The bundled jwt plugin's parser: signature checks for every JWS algorithm.
local jwt_parser = require "kong.plugins.jwt.jwt_parser"
local algorithms = require "kong.plugins.jwt-claim-forward.algorithms"

local kong = kong
local ngx_decode_base64 = ngx.decode_base64
local ngx_time = ngx.time
local type = type
local ipairs = ipairs
local pcall = pcall
local tostring = tostring
local fmt = string.format
local rep = string.rep
local floor = math.floor

local MAX_SAFE_INTEGER = 2 ^ 53


local JwtClaimForward = {
  -- Below every bundled authentication plugin and above rate-limiting, which
  -- can therefore limit by a header set here.
  PRIORITY = 990,
  VERSION = "0.3.0",
}


-- Accepts the URL-safe and the standard alphabet, padded or not.
local function decode_base64url(input)
  local remainder = #input % 4
  if remainder == 1 then
    return nil
  end
  if remainder > 0 then
    input = input .. rep("=", 4 - remainder)
  end

  input = input:gsub("%-", "+"):gsub("_", "/")
  return ngx_decode_base64(input)
end


local function bearer_token(header_value)
  if type(header_value) ~= "string" then
    return nil
  end

  local token = header_value:match("^%s*[Bb][Ee][Aa][Rr][Ee][Rr]%s+(%S+)%s*$")
                or header_value:match("^%s*(%S+)%s*$")
  return token
end


-- Returns the claims and their still-encoded form, or nil and the reason.
local function decoded_claims(token)
  -- header.payload.signature; the signature may be empty or absent.
  local encoded = token:match("^[^%.]+%.([^%.]+)%.?[^%.]*$")
  if not encoded then
    return nil, "token is not a JWT"
  end

  local claims = cjson.decode(decode_base64url(encoded) or "")
  if type(claims) ~= "table" then
    return nil, "token payload is not readable"
  end

  return claims, encoded
end


local function load_secret(id)
  local secret, err = kong.db.konggate_secrets:select({ id = id })
  if err then
    return nil, err
  end
  return secret
end


-- The key a rule verifies against (see daos.lua), cached. Kong drops the
-- cached copy on its own when the entry is changed or deleted.
local function find_secret(id)
  if not id then
    return nil
  end

  local cache_key = kong.db.konggate_secrets:cache_key(id)
  local secret, err = kong.cache:get(cache_key, nil, load_secret, id)
  if err then
    kong.log.err("could not load secret ", id, ": ", err)
  end

  return secret
end


local function key_of(secret)
  if algorithms.hmac[secret.algorithm] and secret.value_is_base64 then
    return decode_base64url(secret.value)
  end
  return secret.value
end


local function audience_matches(aud, expected)
  if type(aud) == "table" then
    for _, item in ipairs(aud) do
      if item == expected then
        return true
      end
    end
    return false
  end

  return aud == expected
end


-- Returns the claims and their still-encoded form, or nil and the reason.
local function verified_claims(token, conf)
  -- The parser indexes whatever the header decodes to, so a token whose
  -- header is valid JSON but not an object makes it throw.
  local ok, jwt, err = pcall(jwt_parser.new, jwt_parser, token)
  if not ok or not jwt then
    return nil, "token is not a valid JWT" .. (ok and err and " (" .. err .. ")" or "")
  end
  if type(jwt.claims) ~= "table" then
    return nil, "token payload is not readable"
  end

  local secret = find_secret(conf.secret_id)
  if not secret then
    -- Deleted, or never set: nothing can be verified, so nothing passes.
    kong.log.err("the secret this route verifies tokens against is missing")
    return nil, "token cannot be verified"
  end

  -- The algorithm is ours to choose, not the token's: trusting the header
  -- would let an HS256 token be "signed" with a published public key.
  if jwt.header.alg ~= secret.algorithm then
    return nil, "token is not signed with " .. secret.algorithm
  end

  local key = key_of(secret)
  if not key or key == "" then
    kong.log.err("secret '", secret.name, "' holds no usable key")
    return nil, "token signature is invalid"
  end

  -- Throws on a key OpenSSL cannot load.
  local checked, valid = pcall(jwt.verify_signature, jwt, key)
  if not checked then
    kong.log.err("could not verify token signature: ", valid)
  end
  if not checked or not valid then
    return nil, "token signature is invalid"
  end

  local claims = jwt.claims

  if conf.verify_expiry then
    local now = ngx_time()
    local exp, nbf = claims.exp, claims.nbf

    if exp ~= nil then
      if type(exp) ~= "number" then
        return nil, "token 'exp' is not a number"
      end
      if now >= exp + conf.leeway then
        return nil, "token has expired"
      end
    end

    if nbf ~= nil then
      if type(nbf) ~= "number" then
        return nil, "token 'nbf' is not a number"
      end
      if now + conf.leeway < nbf then
        return nil, "token is not valid yet"
      end
    end
  end

  if conf.issuer and claims.iss ~= conf.issuer then
    return nil, "token issuer is not accepted"
  end

  if conf.audience and not audience_matches(claims.aud, conf.audience) then
    return nil, "token audience is not accepted"
  end

  return claims, jwt.claims_64
end


local function find_claim(claims, name)
  -- Exact match first: namespaced claims such as "https://example.com/id"
  -- contain dots of their own.
  local value = claims[name]
  if value ~= nil then
    return value
  end

  -- "user.id" walks into nested objects.
  value = claims
  for key in name:gmatch("[^%.]+") do
    if type(value) ~= "table" then
      return nil
    end
    value = value[key]
  end

  return value
end


-- Strings, numbers and booleans as text; nil for anything else, and for
-- strings that cannot travel in a header (empty, control characters).
local function scalar_text(value)
  local kind = type(value)

  if kind == "string" then
    if value == "" or value:find("%c") then
      return nil
    end
    return value
  end

  if kind == "number" then
    -- tostring() would print a large numeric id in exponent form.
    if value == floor(value) and value > -MAX_SAFE_INTEGER and value < MAX_SAFE_INTEGER then
      return fmt("%.0f", value)
    end
    return tostring(value)
  end

  if kind == "boolean" then
    return tostring(value)
  end

  return nil
end


-- Objects and arrays are forwarded as JSON.
local function to_header_value(value)
  if type(value) == "table" then
    return cjson.encode(value)
  end
  return scalar_text(value)
end


local function is_accepted(value, accepted)
  local text = scalar_text(value)
  if not text then
    return false
  end

  for _, candidate in ipairs(accepted) do
    if candidate == text then
      return true
    end
  end
  return false
end


-- A claim meets a condition when its value, or any item of an array value
-- (think "roles"), is one of the accepted values.
local function meets(value, accepted)
  if type(value) ~= "table" then
    return is_accepted(value, accepted)
  end

  for _, item in ipairs(value) do
    if is_accepted(item, accepted) then
      return true
    end
  end
  return false
end


local function unauthorized(reason)
  return kong.response.exit(401, { message = "Unauthorized: " .. reason }, {
    ["WWW-Authenticate"] = "Bearer",
  })
end


function JwtClaimForward:access(conf)
  local set_header = kong.service.request.set_header
  local clear_header = kong.service.request.clear_header

  local token = bearer_token(kong.request.get_header(conf.token_header))

  -- These headers are ours to set: whatever the client put in them is dropped,
  -- so the upstream never sees a value that didn't come from the token.
  for _, mapping in ipairs(conf.claims) do
    clear_header(mapping.header)
  end
  if conf.payload_header then
    clear_header(conf.payload_header)
  end

  local claims, encoded, reason
  if token then
    local read = conf.verify_signature and verified_claims or decoded_claims
    claims, encoded = read(token, conf)

    if not claims then
      reason, encoded = encoded, nil
      -- A token that fails verification is never let through, strict or not.
      if conf.verify_signature then
        return unauthorized(reason)
      end
    end
  end

  if not claims then
    -- No token, or (unverified) nothing readable in it. A route gated on
    -- claim values cannot be entered without them.
    if conf.strict or conf.conditions[1] then
      return unauthorized(reason or "token is missing")
    end

  else
    for _, condition in ipairs(conf.conditions) do
      if not meets(find_claim(claims, condition.claim), condition.values) then
        return kong.response.exit(403, {
          message = "Forbidden: token '" .. condition.claim .. "' does not allow this request",
        })
      end
    end

    for _, mapping in ipairs(conf.claims) do
      local value = to_header_value(find_claim(claims, mapping.claim))
      if value then
        set_header(mapping.header, value)
      elseif mapping.required then
        return unauthorized("token has no usable '" .. mapping.claim .. "' claim")
      end
    end

    if conf.payload_header then
      set_header(conf.payload_header, encoded)
    end
  end

  if not conf.forward_token then
    clear_header(conf.token_header)
  end
end


return JwtClaimForward
