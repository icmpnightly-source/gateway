/** Why something could not be reached, with the engine's own explanation (in English). */
export interface ConnectionError {
  /** Short machine name: "refused", "credentials", "port_in_use", … */
  reason: string;
  message: string;
}

/** One of this computer's network addresses. */
export interface LocalAddress {
  address: string;
  /** The network adapter it belongs to, as the system names it. */
  adapter: string;
  /** On an adapter that virtual machines or VPNs make: rarely how other computers reach this one. */
  virtual: boolean;
}

/** How things stand on this computer right now. */
export interface SystemStatus {
  version: string;
  /** Whether this is the desktop app, with a window to close, or the gateway on its own. */
  hasWindow: boolean;
  gateway: {
    port: number;
    /** Open to other computers, not only to programs on this one. */
    public: boolean;
    running: boolean;
    error: ConnectionError | null;
  };
  app: { port: number };
  addresses: LocalAddress[];
  /** The file on this computer that holds the projects and works (and the secrets, with no database). */
  dataFile: string;
  /** The shared database the JWT secrets come from, if one is used. */
  database: {
    /** False: the secrets are kept in this computer's file. */
    used: boolean;
    connected: boolean;
    error: ConnectionError | null;
    host: string;
    port: number;
    name: string;
    user: string;
  };
  /** Changes whenever a project, a work or (on any computer) a secret does. */
  revision: string;
}

export interface DatabaseSettings {
  host: string;
  port: number;
  database: string;
  user: string;
  /** Encrypted connection. */
  ssl: boolean;
  /** Whether a password is saved; the password itself never comes back. */
  hasPassword: boolean;
}

export interface GatewaySettings {
  port: number;
  public: boolean;
}

/** What the app window's close button does. */
export type OnClose = 'ask' | 'tray' | 'quit';

export interface ShownSettings {
  gateway: GatewaySettings;
  window: { onClose: OnClose };
  database: DatabaseSettings;
}

/** A recorded request, as the log's list shows it. */
export interface RequestSummary {
  id: string;
  /** ISO date string. */
  time: string;
  workId: string;
  workName: string;
  projectId: string;
  method: string;
  /** The address the client called. */
  url: string;
  /** What the client was answered; null when it left before any answer. */
  status: number | null;
  durationMs: number;
  /** Where the request was forwarded; null when the gateway answered itself. */
  destination: string | null;
  /** Why the destination could not be reached, when it could not. */
  failed: string | null;
  /**
   * Whose answer the client got: the destination's, passed on, or the
   * gateway's own (a refusal, or word that the destination did not answer).
   */
  answeredBy: 'destination' | 'gateway' | null;
}

/** A message's headers and, where bodies are recorded, the start of its body. */
export interface RecordedMessage {
  headers: Record<string, string>;
  body?: string;
}

/** A recorded request in full: what came in and what went out. */
export interface RequestRecord {
  id: string;
  time: string;
  workId: string;
  workName: string;
  projectId: string;
  status: number | null;
  durationMs: number;
  in: {
    method: string;
    url: string;
    clientIp: string;
    headers: Record<string, string>;
    body?: string;
  };
  out: {
    /** False when the gateway answered by itself and nothing left for the destination. */
    sent: boolean;
    /** Why nothing was sent. */
    note?: string;
    method?: string;
    url?: string;
    /** The address the destination's name resolved to. */
    ip?: string;
    headers?: Record<string, string>;
    /** What the destination answered. */
    status?: number;
    response?: RecordedMessage & { status: number };
    failed?: ConnectionError;
  };
  /** What the client was given; unset when it left before any answer. */
  answer?: RecordedMessage & { by: 'destination' | 'gateway' };
}

export interface SystemState {
  status?: SystemStatus;
  /** False while the engine itself does not answer. */
  reachable: boolean;
}
