-- Admin API for the keys tokens are verified against, and for the
-- administrator sign-in that guards them.
--
-- Anyone may list the keys by name. Only a signed-in administrator may add,
-- change or remove one. Nobody is ever sent a key's value back.

local cjson = require "cjson"
local bit = require "bit"
local openssl_mac = require "resty.openssl.mac"
local to_hex = require("resty.string").to_hex
local Errors = require "kong.db.errors"

local kong = kong
local ngx = ngx
local tonumber = tonumber
local type = type

local PLUGIN_NAME = "jwt-claim-forward"
local SESSION_SECONDS = 12 * 60 * 60
-- Wrong passwords tolerated from one address within a minute.
local MAX_FAILED_LOGINS = 5


-- The administrator's password: the KONGGATE_ADMIN_PASSWORD environment
-- variable of the Kong container.
local function admin_password()
  local value = kong.vault.get("{vault://env/konggate-admin-password}")
  if type(value) == "string" and value ~= "" then
    return value
  end
end


local function mac(key, data)
  return to_hex(openssl_mac.new(key, "HMAC", nil, "sha256"):final(data))
end


-- Takes the same time wherever two equally long strings first differ.
local function secure_equals(a, b)
  if #a ~= #b then
    return false
  end

  local difference = 0
  for i = 1, #a do
    difference = bit.bor(difference, bit.bxor(a:byte(i), b:byte(i)))
  end
  return difference == 0
end


-- A session is its own expiry time, signed with the password: there is
-- nothing to store, and changing the password ends every session.
local function new_session(password)
  local expires_at = ngx.time() + SESSION_SECONDS
  return expires_at .. "." .. mac(password, "konggate-session:" .. expires_at), expires_at
end


local function is_admin()
  local password = admin_password()
  if not password then
    return false
  end

  local header = kong.request.get_header("authorization") or ""
  local expires_at, signature = header:match("^[Bb]earer%s+(%d+)%.(%x+)$")
  if not expires_at or tonumber(expires_at) <= ngx.time() then
    return false
  end

  return secure_equals(signature, mac(password, "konggate-session:" .. expires_at))
end


local function admin_only(handler)
  return function(self)
    if not is_admin() then
      return kong.response.exit(401, { message = "administrator sign-in required" })
    end
    return handler(self)
  end
end


-- Everything about a key except the key.
local function public_view(secret)
  return {
    id = secret.id,
    name = secret.name,
    algorithm = secret.algorithm,
    created_at = secret.created_at,
    updated_at = secret.updated_at,
  }
end


local function save_failed(err, err_t)
  local code = err_t and err_t.code

  if code == Errors.codes.UNIQUE_VIOLATION then
    return kong.response.exit(409, { message = "a secret with this name already exists" })
  end
  if code == Errors.codes.SCHEMA_VIOLATION then
    return kong.response.exit(400, { message = err })
  end

  kong.log.err("could not save a secret: ", err)
  return kong.response.exit(500, { message = "could not save the secret" })
end


-- How many rules verify tokens against the key right now.
local function rules_using(id)
  local count = 0

  for plugin, err in kong.db.plugins:each(1000) do
    if err then
      return nil, err
    end

    local config = plugin.config
    if plugin.name == PLUGIN_NAME and config.verify_signature and config.secret_id == id then
      count = count + 1
    end
  end

  return count
end


-- nil for an id that is not a UUID as much as for one that isn't there.
local function find(id)
  return (kong.db.konggate_secrets:select({ id = id }))
end


local function given(value, fallback)
  if value == nil or value == "" then
    return fallback
  end
  return value
end


return {
  ["/konggate/login"] = {
    POST = function(self)
      local password = admin_password()
      if not password then
        return kong.response.exit(503, {
          message = "no administrator password is set (KONGGATE_ADMIN_PASSWORD)",
        })
      end

      local attempts_key = "konggate:failed-logins:" .. ngx.var.remote_addr
      if (ngx.shared.kong:get(attempts_key) or 0) >= MAX_FAILED_LOGINS then
        return kong.response.exit(429, { message = "too many wrong passwords, try again in a minute" })
      end

      local attempt = self.params.password
      -- Compared as digests, so the lengths of the two say nothing either.
      if type(attempt) ~= "string"
         or not secure_equals(mac("konggate-login", attempt), mac("konggate-login", password))
      then
        ngx.shared.kong:incr(attempts_key, 1, 0, 60)
        return kong.response.exit(401, { message = "wrong password" })
      end

      local token, expires_at = new_session(password)
      return kong.response.exit(200, { token = token, expires_at = expires_at })
    end,
  },

  ["/konggate/secrets"] = {
    GET = function()
      local secrets = setmetatable({}, cjson.array_mt)

      for secret, err in kong.db.konggate_secrets:each(1000) do
        if err then
          kong.log.err("could not list the secrets: ", err)
          return kong.response.exit(500, { message = "could not list the secrets" })
        end
        secrets[#secrets + 1] = public_view(secret)
      end

      table.sort(secrets, function(a, b)
        return a.name < b.name
      end)

      return kong.response.exit(200, { data = secrets })
    end,

    POST = admin_only(function(self)
      local params = self.params

      local secret, err, err_t = kong.db.konggate_secrets:insert({
        name = params.name,
        algorithm = params.algorithm,
        value = params.value,
        value_is_base64 = params.value_is_base64,
      })
      if not secret then
        return save_failed(err, err_t)
      end

      return kong.response.exit(201, public_view(secret))
    end),
  },

  ["/konggate/secrets/:id"] = {
    -- Fields left out keep what they hold; that is how a key is renamed
    -- without anyone having to know its value.
    PATCH = admin_only(function(self)
      local params = self.params
      local existing = find(params.id)
      if not existing then
        return kong.response.exit(404, { message = "no such secret" })
      end

      local value_is_base64 = existing.value_is_base64
      if params.value_is_base64 ~= nil then
        value_is_base64 = params.value_is_base64
      end

      local secret, err, err_t = kong.db.konggate_secrets:update({ id = existing.id }, {
        name = given(params.name, existing.name),
        algorithm = given(params.algorithm, existing.algorithm),
        value = given(params.value, existing.value),
        value_is_base64 = value_is_base64,
      })
      if not secret then
        return save_failed(err, err_t)
      end

      return kong.response.exit(200, public_view(secret))
    end),

    DELETE = admin_only(function(self)
      local existing = find(self.params.id)
      if not existing then
        return kong.response.exit(404, { message = "no such secret" })
      end

      local in_use, err = rules_using(existing.id)
      if not in_use then
        kong.log.err("could not check what uses a secret: ", err)
        return kong.response.exit(500, { message = "could not delete the secret" })
      end
      if in_use > 0 then
        return kong.response.exit(409, {
          message = "the secret is used by " .. in_use .. " rule(s)",
          in_use = in_use,
        })
      end

      local ok, delete_err = kong.db.konggate_secrets:delete({ id = existing.id })
      if not ok then
        kong.log.err("could not delete a secret: ", delete_err)
        return kong.response.exit(500, { message = "could not delete the secret" })
      end

      return kong.response.exit(204)
    end),
  },
}
