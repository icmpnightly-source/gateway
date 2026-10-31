// Works out the address the gateway should use to reach the computer this
// browser is on: what the "my IP" button of a rule's destination fills in.

const STORAGE_KEY = 'konggate.my-address';

/** What Docker gives a container for reaching the machine Docker itself runs on. */
export const SAME_MACHINE = 'host.docker.internal';

interface WhoAmI {
  /** The address the page was requested from, as its web server saw it. */
  client?: string;
  /** That server's own address, when it sits inside Docker's network (the packaged app). */
  server?: string;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const isLoopback = (address: string) => address === '::1' || address.startsWith('127.');

/** An IPv4 address or a host name: what can stand in a URL as it is. */
export function isAddress(value: string) {
  // All digits and dots is meant as an IP address, so it has to be a whole one.
  if (/^[\d.]+$/.test(value)) {
    return IPV4.test(value) && value.split('.').every((part) => Number(part) <= 255);
  }
  return /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value);
}

// Docker's networks are /16 by default: two addresses on the same one share
// their first two numbers.
function onSameNetwork(a: string, b: string) {
  const [x, y] = [IPV4.exec(a), IPV4.exec(b)];
  return Boolean(x && y && x[1] === y[1] && x[2] === y[2]);
}

const isLocalPage = () => ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

/**
 * The network address of the computer the gateway runs on, when this page
 * shows it: the app is served from that same computer, so unless the page was
 * opened as "localhost" its host is that address.
 */
export function gatewayMachineAddress(): string | undefined {
  return isLocalPage() ? undefined : window.location.hostname;
}

/**
 * An address as the gateway should be given it. Its own computer goes by
 * Docker's name for it: from inside a container that computer's network
 * address is not always reachable, the name is.
 */
export function asSeenFromGateway(address: string) {
  return address === gatewayMachineAddress() ? SAME_MACHINE : address;
}

/** Whether a destination names the gateway's own computer by its network address. */
export function isGatewayMachineUrl(destination: string) {
  const own = gatewayMachineAddress();
  if (!own) return false;

  try {
    return new URL(destination).hostname === own;
  } catch {
    return false;
  }
}

/** The address the user gave by hand last time, if any. */
export function rememberedAddress(): string {
  try {
    const address = localStorage.getItem(STORAGE_KEY) ?? '';
    return isAddress(address) ? address : '';
  } catch {
    return '';
  }
}

export function rememberAddress(address: string) {
  try {
    localStorage.setItem(STORAGE_KEY, address);
  } catch {
    // Private mode or storage disabled: it just won't be remembered.
  }
}

/**
 * The address of this browser's computer, when that can be told from here;
 * undefined when only the user knows it.
 */
export async function detectMyAddress(): Promise<string | undefined> {
  let who: WhoAmI;
  try {
    who = (await (await fetch('/whoami')).json()) as WhoAmI;
  } catch {
    return undefined;
  }

  const client = (who.client ?? '').replace(/^::ffff:/, '');
  if (!client) return undefined;

  // The page is served to the very machine it is served from.
  if (isLoopback(client)) return SAME_MACHINE;

  // From inside Docker's network (on Docker Desktop, at least) every visitor
  // looks like that network's own gateway. All that can still be told is
  // whether the browser is on the gateway's machine.
  if (who.server && onSameNetwork(client, who.server)) {
    return isLocalPage() ? SAME_MACHINE : undefined;
  }

  return client;
}

/** A destination with its host swapped for `host`; one that has no port yet is left ready for it to be typed. */
export function withHost(destination: string, host: string) {
  const match = /^(https?:\/\/)[^/:?#]*(.*)$/.exec(destination.trim());
  if (!match) return `http://${host}:`;

  const [, scheme, rest] = match;
  return `${scheme}${host}${rest || ':'}`;
}
