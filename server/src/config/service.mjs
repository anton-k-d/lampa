import { ConfigError } from './errors.mjs';
import { validateConfigDocument } from './validation.mjs';
import { resolveManagedConfig, validateResolvedConfig } from './resolve.mjs';

const matchesScope = (scopeKey, document) => typeof scopeKey === 'string' && document && typeof document === 'object' && (
  (scopeKey === 'global' && document.scope === 'global' && !Object.hasOwn(document, 'deviceId')) ||
  (scopeKey.startsWith('device:') && scopeKey.length > 7 && document.scope === 'device' && document.deviceId === scopeKey.slice(7))
);

/** Orchestrate structural and trusted policy validation around repository transactions. */
export function createConfigService({ repository, policy = {}, additionalValidator = () => [] }) {
  function validate(scopeKey, document, heads) {
    const structural = validateConfigDocument(document);
    if (!structural.valid) return structural;
    if (!matchesScope(scopeKey, document)) return { valid:false, issues:[{path:'',code:'scope_mismatch',message:'Document scope does not match scope key'}] };
    const global = scopeKey === 'global' ? document : heads.find(head => head.scopeKey === 'global')?.document;
    const devices = scopeKey === 'global'
      ? heads.filter(head => head.scopeKey.startsWith('device:')).map(head => head.document)
      : [document];
    const check = values => [...validateResolvedConfig(values, policy), ...additionalValidator(values)];
    const issues = scopeKey === 'global' ? check(resolveManagedConfig(global)) : [];
    for (const device of devices) issues.push(...check(resolveManagedConfig(global, device)));
    return { valid:issues.length === 0, issues };
  }
  const preview = ({scopeKey, document}) => validate(scopeKey, document, repository.listHeads());
  const validator = scopeKey => (document, heads) => {
    const result = validate(scopeKey, document, heads);
    if (!result.valid) throw new ConfigError('INVALID_CONFIG', 'Invalid configuration document', {issues:result.issues});
  };
  return {
    preview,
    publish: input => repository.publish(input, validator(input?.scopeKey)),
    rollback: input => repository.rollback(input, validator(input?.scopeKey)),
  };
}
