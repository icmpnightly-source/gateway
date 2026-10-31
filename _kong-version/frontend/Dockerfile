# The built app behind nginx. Build the app first (npm run build): this image
# only packages ./dist, so that it can be made without reaching an npm registry.
FROM nginx:1.30-alpine

# The image fills in ${VARIABLES} from the container's environment on start.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY dist /usr/share/nginx/html
