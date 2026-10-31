-- The JWS algorithms tokens can be verified with.

return {
  all = {
    "HS256", "HS384", "HS512",
    "RS256", "RS384", "RS512",
    "ES256", "ES384", "ES512",
    "PS256", "PS384", "PS512",
    "EdDSA",
  },
  -- Verified with a shared secret; every other algorithm takes a public key.
  hmac = { HS256 = true, HS384 = true, HS512 = true },
}
