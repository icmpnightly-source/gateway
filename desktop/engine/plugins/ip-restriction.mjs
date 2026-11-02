// IP restriction: only some client addresses let through, or some kept out.
// Addresses and networks, IPv4 or IPv6: 192.168.1.20, 10.0.0.0/8, fd00::/8.

import { BlockList, isIP } from 'node:net';
import { refuse } from './fields.mjs';

function rules(entries) {
  const blocks = new BlockList();
  for (const entry of entries) {
    const [address, bits] = entry.split('/');
    const family = isIP(address);
    const type = family === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) blocks.addAddress(address, type);
    else blocks.addSubnet(address, Number(bits), type);
  }
  return blocks;
}

function checkEntry(entry, what) {
  const [address, bits, rest] = entry.split('/');
  const family = isIP(address);
  if (!family || rest !== undefined) refuse(`IP restriction: ${what}: "${entry}" is not an address or a network (such as 10.0.0.0/8)`);
  if (bits !== undefined && (!/^\d+$/.test(bits) || Number(bits) > (family === 6 ? 128 : 32))) {
    refuse(`IP restriction: ${what}: "${entry}" has a network size that does not fit`);
  }
}

export default {
  name: 'ip-restriction',
  title: 'IP restriction',
  description: 'Lets only the client addresses listed through, or keeps the ones listed out.',
  priority: 1600,
  onPreflight: true,
  fields: {
    allow: { type: 'list', label: 'Allow only', help: 'Addresses or networks, such as 192.168.1.0/24. Empty: any address not denied.' },
    deny: { type: 'list', label: 'Deny', help: 'Addresses or networks always refused.' },
    status: { type: 'number', label: 'Answer code', default: 403, min: 400, max: 499 },
    message: { type: 'string', label: 'Message', default: 'Your address is not allowed' },
  },

  check(config) {
    config.status = Math.round(config.status);
    for (const entry of config.allow) checkEntry(entry, 'allow');
    for (const entry of config.deny) checkEntry(entry, 'deny');
  },

  prepare(config) {
    return { allow: config.allow.length > 0 ? rules(config.allow) : null, deny: rules(config.deny) };
  },

  access(ctx, config, state) {
    const { ip } = ctx.client;
    const type = isIP(ip) === 6 ? 'ipv6' : 'ipv4';
    const denied = state.deny.check(ip, type) || (state.allow !== null && !state.allow.check(ip, type));
    if (denied) ctx.respond(config.status, { message: config.message || 'Your address is not allowed', reason: 'ip' });
  },
};
