import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ConfigError } from './errors.mjs';

const schema = JSON.parse(readFileSync(new URL('../../../schemas/managed-config.v1.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, ownProperties: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const escapePointer = value => value.replace(/~/g, '~0').replace(/\//g, '~1');

/** Validate a managed document without modifying it. */
export function validateConfigDocument(value) {
  if (validate(value)) return { valid: true, issues: [] };
  const issues = validate.errors.map(error => {
    let path = error.instancePath;
    if (error.keyword === 'required') path += `/${escapePointer(error.params.missingProperty)}`;
    return { path, code: error.keyword, message: 'Invalid configuration value' };
  });
  return { valid: false, issues };
}

/** Parse and validate a UTF-8 sized configuration document. */
export function parseConfigDocument(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 262144) {
    throw new ConfigError('INVALID_CONFIG', 'Invalid configuration document', { issues: [{ path: '', code: 'size', message: 'Invalid configuration document size' }] });
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ConfigError('INVALID_CONFIG', 'Invalid configuration document', { issues: [{ path: '', code: 'syntax', message: 'Invalid JSON syntax' }] });
  }
  const result = validateConfigDocument(value);
  if (!result.valid) throw new ConfigError('INVALID_CONFIG', 'Invalid configuration document', { issues: result.issues });
  return value;
}
