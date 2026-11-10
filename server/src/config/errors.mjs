/** A safe error at the managed configuration boundary. */
export class ConfigError extends Error {
  constructor(code, message, { issues, currentRevision } = {}) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
    if (issues !== undefined) this.issues = issues;
    if (currentRevision !== undefined) this.currentRevision = currentRevision;
  }
}
