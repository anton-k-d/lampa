import { ConfigError } from './errors.mjs';

const defaults = () => ({ ui: { theme: 'system', density: 'comfortable', animations: true }, sources: [], plugins: [], torrServer: { enabled: false }, parser: { enabled: false }, features: { search: true, sync: false, plugins: false }, lockedPaths: [] });
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

function rejectPrototypeKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (forbidden.has(key)) throw new ConfigError('INVALID_CONFIG', 'Invalid configuration document', { issues: [{ path: '', code: 'forbidden_key', message: 'Invalid configuration property' }] });
    rejectPrototypeKeys(value[key]);
  }
}

function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (key === 'lockedPaths') {
      target[key] = [...new Set([...target[key], ...value])];
    } else if (Array.isArray(value)) {
      target[key] = structuredClone(value);
    } else if (value && typeof value === 'object') {
      target[key] = merge(target[key] && typeof target[key] === 'object' && !Array.isArray(target[key]) ? target[key] : {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

/** Merge validated documents into an independent managed values object. */
export function resolveManagedConfig(global, device) {
  rejectPrototypeKeys(global);
  rejectPrototypeKeys(device);
  const result = defaults();
  if (global) merge(result, global.values);
  if (device) merge(result, device.values);
  return result;
}

/** Apply lexical and trusted registry policy to structurally valid resolved values. */
export function validateResolvedConfig(values, policy = {}) {
  const { providerIds = new Set(), secretRefs = new Set(), reviewedPlugins = new Map(), allowedLanOrigins = new Set() } = policy;
  const issues = [];
  const add = (path, code, message) => issues.push({ path, code, message });
  const checkUrl = (url, path) => {
    try {
      const parsed = new URL(url);
      if ((parsed.username || parsed.password || parsed.search || parsed.hash || url.includes('?') || url.includes('#')) || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && allowedLanOrigins.has(parsed.origin)))) throw new Error();
    } catch {
      add(path, 'url_policy', 'Endpoint URL violates policy');
    }
  };
  const checkEndpoint = (endpoint, path, metadata = false) => {
    if (!endpoint) return;
    checkUrl(endpoint.url, `${path}/url`);
    if (endpoint.credentialRef !== undefined) {
      if (metadata && endpoint.mode === 'direct-device') add(`${path}/credentialRef`, 'credential_policy', 'Credential reference is not permitted');
      else if (!secretRefs.has(endpoint.credentialRef)) add(`${path}/credentialRef`, 'unknown_secret', 'Unknown credential reference');
    }
  };
  if (values.metadata?.providerId !== undefined && !providerIds.has(values.metadata.providerId)) add('/metadata/providerId', 'unknown_provider', 'Unknown metadata provider');
  checkEndpoint(values.metadata?.endpoint, '/metadata/endpoint', true);
  const unique = (items, path) => {
    const seen = new Set();
    items.forEach((item, index) => {
      if (seen.has(item.id)) add(`${path}/${index}/id`, 'duplicate_id', 'Duplicate identifier');
      seen.add(item.id);
    });
  };
  unique(values.sources, '/sources');
  unique(values.plugins, '/plugins');
  values.sources.forEach((source, index) => checkEndpoint(source.endpoint, `/sources/${index}/endpoint`));
  if (values.defaultSourceId !== undefined && !values.sources.some(source => source.id === values.defaultSourceId && source.enabled)) add('/defaultSourceId', 'invalid_default', 'Default source must be enabled');
  if (values.torrServer.enabled && !values.torrServer.primary) add('/torrServer/primary', 'required', 'Enabled integration requires an endpoint');
  checkEndpoint(values.torrServer.primary, '/torrServer/primary');
  checkEndpoint(values.torrServer.backup, '/torrServer/backup');
  if (values.parser.enabled && !values.parser.endpoint) add('/parser/endpoint', 'required', 'Enabled integration requires an endpoint');
  checkEndpoint(values.parser.endpoint, '/parser/endpoint');
  values.plugins.forEach((plugin, index) => {
    checkUrl(plugin.url, `/plugins/${index}/url`);
    if (!plugin.enabled) return;
    const reviewed = reviewedPlugins.get(plugin.id);
    if (!reviewed || reviewed.url !== plugin.url || reviewed.sha256 !== plugin.sha256 || reviewed.minClientVersion !== plugin.minClientVersion) add(`/plugins/${index}`, 'unreviewed_plugin', 'Plugin does not match a reviewed entry');
  });
  return issues;
}
