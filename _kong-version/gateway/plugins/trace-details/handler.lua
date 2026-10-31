-- Writes what a request looked like into its trace: as it came in from the
-- client ("in", "in.*"), and as it left for the upstream ("out", "out.*").
-- Trace viewers list attributes by name, so the two one-line summaries, "in"
-- and "out", each come out on top of their group.
--
-- It only adds attributes to the trace's first span. The opentelemetry plugin
-- on the same route is what records and exports the trace, so without it (or
-- for a request it did not sample) nothing is kept.

local kong = kong
local ngx = ngx
local type = type
local pairs = pairs
local concat = table.concat

-- Enough to tell values apart without turning a trace into a copy of the traffic.
local MAX_VALUE = 1024
local MAX_BODY = 2048

-- Bodies worth showing as text.
local TEXT_TYPES = { "json", "xml", "text/", "x-www-form-urlencoded", "graphql" }


local TraceDetails = {
  -- Above every plugin that changes the request, so that "in" is what the
  -- client really sent.
  PRIORITY = 150000,
  VERSION = "0.1.0",
}


-- The span the whole request hangs off, when the request is being recorded.
local function root_span()
  local spans = ngx.ctx.KONG_SPANS
  local span = spans and spans[1]

  if span and span.is_recording ~= false and span.should_sample ~= false then
    return span
  end
end


local function shorten(value, limit)
  if #value > limit then
    return value:sub(1, limit) .. "… (" .. #value .. " bytes)"
  end
  return value
end


-- Says that there was a value, and for Authorization what kind, but not what.
local function masked(value)
  local scheme = type(value) == "string" and value:match("^(%a+)%s+%S")
  return scheme and scheme .. " ***" or "***"
end


local function add_headers(span, prefix, headers, conf)
  local redact = {}
  for _, name in ipairs(conf.redact_headers) do
    redact[name:lower()] = true
  end

  for name, value in pairs(headers) do
    -- A header sent several times arrives as a list.
    if type(value) == "table" then
      value = concat(value, ", ")
    end

    if type(value) == "string" and value ~= "" then
      span:set_attribute(prefix .. name, redact[name] and masked(value) or shorten(value, MAX_VALUE))
    end
  end
end


local function is_text(content_type)
  if not content_type then
    return false
  end

  content_type = content_type:lower()
  for _, kind in ipairs(TEXT_TYPES) do
    if content_type:find(kind, 1, true) then
      return true
    end
  end
  return false
end


function TraceDetails:access(conf)
  local span = root_span()
  if not span then
    return
  end

  -- The Host header is the address the client used. Kong's own idea of its
  -- port is the one it listens on inside the container, not the published one.
  local host = kong.request.get_header("host") or kong.request.get_host()

  span:set_attribute("in", kong.request.get_method() .. " " .. kong.request.get_scheme() .. "://" .. host
                           .. kong.request.get_path_with_query())
  span:set_attribute("in.client_ip", kong.client.get_ip())
  add_headers(span, "in.header.", kong.request.get_headers(), conf)

  if conf.capture_body then
    if not is_text(kong.request.get_header("content-type")) then
      if (tonumber(kong.request.get_header("content-length")) or 0) > 0 then
        span:set_attribute("in.body", "(not shown: not text)")
      end

    else
      -- nil for a body too big for nginx to have kept in memory.
      local body = kong.request.get_raw_body()
      if not body then
        span:set_attribute("in.body", "(not shown: too large)")
      elseif body ~= "" then
        span:set_attribute("in.body", shorten(body, MAX_BODY))
      end
    end
  end
end


-- By now every plugin has had its say about the request, the upstream has been
-- tried, and the span is still open (Kong closes it before the log phase).
function TraceDetails:header_filter(conf)
  local span = root_span()
  if not span then
    return
  end

  local source = kong.response.get_source()
  if source == "exit" then
    -- A plugin answered in the gateway's name: turned the request down, or
    -- replied to a browser's preflight. Nothing went to the upstream.
    span:set_attribute("out", "(nothing sent: the gateway answered " .. kong.response.get_status() .. " itself)")
    span:set_attribute("out.sent", false)
    return
  end

  local var = ngx.var
  local balancer = ngx.ctx.balancer_data or {}
  local target = (balancer.host or var.upstream_host or "?") .. ":" .. (balancer.port or "?")

  span:set_attribute("out", kong.request.get_method() .. " " .. (var.upstream_scheme or "http") .. "://" .. target
                            .. (var.upstream_uri or ""))
  span:set_attribute("out.sent", true)
  if balancer.ip then
    span:set_attribute("out.ip", balancer.ip)
  end

  if source == "service" then
    span:set_attribute("out.status", kong.service.response.get_status())
  else
    -- The upstream could not be reached or did not answer in time; the status
    -- the client gets is the gateway's own.
    span:set_attribute("out.failed", "no answer; the gateway replied " .. kong.response.get_status())
  end

  -- The request headers as the plugins left them, plus the ones Kong itself
  -- sets on the way out.
  local headers = kong.request.get_headers()
  headers["host"] = var.upstream_host
  headers["x-forwarded-for"] = var.upstream_x_forwarded_for
  headers["x-forwarded-proto"] = var.upstream_x_forwarded_proto
  headers["x-forwarded-host"] = var.upstream_x_forwarded_host
  headers["x-forwarded-port"] = var.upstream_x_forwarded_port
  headers["x-forwarded-path"] = var.upstream_x_forwarded_path
  headers["x-forwarded-prefix"] = var.upstream_x_forwarded_prefix
  headers["x-real-ip"] = var.remote_addr
  headers["x-kong-request-id"] = var.kong_request_id
  add_headers(span, "out.header.", headers, conf)
end


return TraceDetails
