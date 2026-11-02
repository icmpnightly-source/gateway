// CORS: lets web pages from other addresses call the work from a browser.
// The gateway answers the browser's preflight itself, before any other
// plugin, and says on every answer which pages may read it.

import { TRACE_ID_HEADER } from '../gateway.mjs';

const PREFLIGHT_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
// How long a browser may go by an answer to its preflight before asking again.
const PREFLIGHT_SECONDS = 600;
// The headers the gateway's plugins put on an answer, for a page to be able to
// read them where "*" cannot say so (an answer that allows credentials).
const OWN_HEADERS = ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After', 'X-Cache-Status', TRACE_ID_HEADER];

export default {
  name: 'cors',
  title: 'CORS',
  description: 'Lets web pages on other addresses call this work from a browser. The gateway answers the browser\'s preflight itself.',
  priority: 2000,
  fields: {
    origins: {
      type: 'list',
      label: 'Allowed origins',
      help: 'Addresses of the pages allowed, such as https://app.example.com; "*" for any.',
      default: ['*'],
    },
    credentials: {
      type: 'boolean',
      label: 'With credentials',
      help: 'Lets pages send cookies and sign-in headers.',
      default: false,
    },
  },

  check(config) {
    if (config.origins.length === 0) config.origins = ['*'];
  },

  // The request id's header, when the work gives one, is among those a page may read.
  prepare(config, { work }) {
    const requestId = (work.plugins ?? []).find((plugin) => plugin.name === 'request-id' && plugin.enabled);
    return { exposed: [...OWN_HEADERS, ...(requestId ? [requestId.config.header] : [])] };
  },

  // Before any other plugin, so that even a refusal says which pages may read it.
  rewrite(ctx, config, state) {
    const origin = ctx.request.incomingHeader('origin');
    if (!origin) return;

    const { origins, credentials } = config;
    const any = origins.includes('*');
    const isAllowed = any || origins.includes(origin);
    ctx.shared.corsAllowed = isAllowed;

    if (isAllowed) {
      // A browser refuses "*" together with credentials, so the caller is named.
      ctx.response.setHeader('Access-Control-Allow-Origin', any && !credentials ? '*' : origin);
      if (credentials) ctx.response.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (!any || credentials) ctx.response.setHeader('Vary', 'Origin');

    // Otherwise a page could not read the headers the gateway adds: the
    // request's id, what is left of the limit.
    if (isAllowed && !ctx.request.preflightFor) {
      ctx.response.setHeader('Access-Control-Expose-Headers', credentials ? state.exposed.join(', ') : '*');
    }
  },

  // A browser asking first: answered here, and nothing goes to the destination.
  preflight(ctx, _config) {
    const wanted = ctx.request.incomingHeader('access-control-request-headers');
    const allowed = [['Access-Control-Allow-Methods', ctx.work.methods.length > 0 ? ctx.work.methods.join(',') : PREFLIGHT_METHODS]];
    if (wanted) allowed.push(['Access-Control-Allow-Headers', wanted]);
    if (ctx.shared.corsAllowed) {
      allowed.push(['Access-Control-Max-Age', String(PREFLIGHT_SECONDS)]);
      // A page from a less private address calling one on the LAN is asked
      // about first, by browsers that do so.
      if (ctx.request.incomingHeader('access-control-request-private-network') === 'true') {
        allowed.push(['Access-Control-Allow-Private-Network', 'true']);
      }
    }
    ctx.answerPreflight(allowed);
  },
};
