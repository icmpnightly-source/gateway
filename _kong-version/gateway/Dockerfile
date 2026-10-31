# Kong with this project's plugins inside, so it runs with nothing mounted.
FROM kong:3.9

# Where KONG_LUA_PACKAGE_PATH below finds them as kong.plugins.<name>.
COPY plugins /opt/kong/plugins

ENV KONG_PLUGINS=bundled,jwt-claim-forward,trace-details \
    KONG_LUA_PACKAGE_PATH=/opt/?.lua;;
