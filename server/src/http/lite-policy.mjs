/** Capabilities supported by the Lite configuration client. */
export function validateLiteValues(values) {
  const issues = [];
  const add = path => issues.push({ path, code: 'unsupported_capability', message: 'Capability is not supported by Lite' });
  if (values.metadata?.providerId !== undefined && values.metadata.providerId !== 'tmdb') add('/metadata/providerId');
  if (values.parser?.kind !== undefined && values.parser.kind !== 'jackett') add('/parser/kind');
  if (values.features?.sync) add('/features/sync');
  if (values.features?.plugins) add('/features/plugins');
  if (values.sources?.length) add('/sources');
  if (values.plugins?.length) add('/plugins');
  if (values.defaultSourceId !== undefined) add('/defaultSourceId');
  return issues;
}
