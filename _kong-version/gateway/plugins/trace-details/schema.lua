local typedefs = require "kong.db.schema.typedefs"


return {
  name = "trace-details",
  fields = {
    { protocols = typedefs.protocols_http },
    { config = {
        type = "record",
        fields = {
          -- Headers whose values never go into a trace: only that they were
          -- there. Whoever can open the traces can read everything else.
          { redact_headers = {
              type = "array",
              required = true,
              default = { "authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "apikey" },
              elements = typedefs.header_name,
          } },
          -- Also keep the start of a text request body. It can hold passwords
          -- and the like, so it is off unless asked for.
          { capture_body = { type = "boolean", required = true, default = false } },
        },
    } },
  },
}
