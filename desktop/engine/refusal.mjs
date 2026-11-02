/** A failure the caller is expected to explain to the user, with the HTTP status that fits. */
export class Refusal extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
