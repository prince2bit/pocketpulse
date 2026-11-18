// An error we expect and can explain to the user (damaged database, unsupported Node).
// index.js prints these without a stack trace.

export class PocketPulseError extends Error {
  /**
   * @param {string} message - what went wrong, in friendly words
   * @param {{ hint?: string }} [options] - what the person can do about it
   */
  constructor(message, { hint } = {}) {
    super(message);
    this.name = 'PocketPulseError';
    this.hint = hint;
  }
}
