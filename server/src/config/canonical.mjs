import { createHash } from 'node:crypto';

/** Serialize a validated JSON value with recursively sorted object keys. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function sha256Json(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
