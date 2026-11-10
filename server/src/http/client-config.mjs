import { resolveManagedConfig, validateResolvedConfig } from '../config/resolve.mjs';
import { ConfigError } from '../config/errors.mjs';
import { validateLiteValues } from './lite-policy.mjs';

/** Deliberate LAN-only client projection; never serialize the runtime secret registry. */
export function clientConfiguration(heads, deviceId, runtimeStore) {
  const global = heads.find(h => h.scopeKey === 'global');
  const device = heads.find(h => h.scopeKey === `device:${deviceId}`);
  const values = resolveManagedConfig(global?.document, device?.document);
  const issues = [...validateResolvedConfig(values, runtimeStore.context), ...validateLiteValues(values)];
  if (issues.length) throw new ConfigError('INVALID_CONFIG','Invalid effective configuration',{issues});
  const assigned = (group, fields) => [global,device].some(head => fields.some(field =>
    Object.hasOwn(head?.document?.values?.[group] ?? {},field)));
  const settings = {}, unsupported = [];
  if (assigned('parser',['enabled','endpoint'])) {
    settings.parser_use = !!values.parser.enabled;
    settings.parser_torrent_type = 'jackett';
    settings.parser_use_link = 'one';
    settings.jackett_url = values.parser.enabled ? values.parser.endpoint?.url || '' : '';
    settings.jackett_key = values.parser.enabled && values.parser.endpoint?.credentialRef
      ? runtimeStore.readSecret(values.parser.endpoint.credentialRef) : '';
    settings.jackett_url_two = settings.jackett_key_two = '';
  }
  if (assigned('torrServer',['enabled','primary','backup'])) {
    if (values.torrServer.primary?.credentialRef || values.torrServer.backup?.credentialRef)
      throw new ConfigError('INVALID_CONFIG','Managed TorrServer authentication is not supported yet');
    settings.torrserver_url = values.torrServer.enabled ? values.torrServer.primary?.url || '' : '';
    settings.torrserver_url_two = values.torrServer.enabled ? values.torrServer.backup?.url || '' : '';
    settings.torrserver_use_link = 'one';
    // Do not send credentials from a previous local server to a new managed URL.
    settings.torrserver_auth = false;
  }
  for (const [field,native] of [['preload','torrserver_preload'],['saveToDatabase','torrserver_savedb']])
    if (assigned('torrServer',[field])) settings[native] = values.torrServer[field];
  if (assigned('metadata',['locale'])) settings.tmdb_lang = values.metadata.locale;
  if (assigned('ui',['animations'])) settings.animation = values.ui.animations;
  for (const field of ['theme','density']) if (assigned('ui',[field])) unsupported.push(`ui.${field}`);
  let metadata = null;
  if (values.metadata?.endpoint) {
    settings.source = 'tmdb';
    const baseUrl = values.metadata.endpoint.url.replace(/\/tmdb-proxy\.js\/?$/,'').replace(/\/+$/,'');
    metadata = {baseUrl};
    if (values.metadata.endpoint.credentialRef) unsupported.push('metadata.credentialRef');
  }
  return {schemaVersion:1,deviceId,revisions:{global:global?.revision ?? 0,device:device?.revision ?? 0},settings,metadata,unsupported};
}
