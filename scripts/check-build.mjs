import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep, dirname } from 'node:path';

const target = process.argv[2];
const outputs = {web:'build/github/lampa', webos:'build/webos'};
const args = process.argv.slice(3);
if (!Object.hasOwn(outputs, target) || (args.length && (args.length !== 2 || args[0] !== '--since' || !/^\d+$/.test(args[1])))) {
  console.error('Usage: node scripts/check-build.mjs <web|webos> [--since milliseconds]'); process.exit(1);
}
const root = resolve(outputs[target]);
const since = args.length ? Number(args[1]) : 0;
function check(name) {
  const file = resolve(root, name);
  if (!file.startsWith(root + sep)) throw new Error(`Invalid asset path: ${name}`);
  const stat = statSync(file);
  if (!stat.isFile() || !stat.size || stat.ctimeMs < since) throw new Error(`Empty or stale artifact: ${name}`);
}
try {
  check('index.html'); check('app.min.js'); check('css/app.css');
  const langs = readdirSync(resolve(root, 'lang')).filter(name => name.endsWith('.js'));
  if (!langs.length) throw new Error('No language files');
  for (const name of langs) check('lang/' + name);
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  // Only static script and link references; dynamic HTML inside scripts is not a file reference.
  const staticHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, match => match.replace(/>[^]*<\/script\s*>/i, '></script>'));
  const assets = [];
  for (const tag of staticHtml.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)) assets.push(tag[1]);
  for (const tag of staticHtml.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1].toLowerCase(), match[2]]));
    if (['og:image', 'msapplication-config'].includes((attributes.property || attributes.name || '').toLowerCase()) && attributes.content) assets.push(attributes.content);
  }
  function localAsset(value) {
    const asset = value.split(/[?#]/, 1)[0];
    return asset && !/^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(asset) ? asset : null;
  }
  for (const value of assets) {
    const asset = localAsset(value);
    if (!asset) continue;
    check(asset);
    if (/\.webmanifest$/i.test(asset)) {
      const manifest = JSON.parse(readFileSync(resolve(root, asset), 'utf8'));
      for (const icon of manifest.icons || []) {
        const iconPath = typeof icon.src === 'string' && localAsset(icon.src);
        if (iconPath) check(resolve(dirname(resolve(root, asset)), iconPath));
      }
    }
    if (/\.xml$/i.test(asset)) {
      const xml = readFileSync(resolve(root, asset), 'utf8');
      for (const match of xml.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gi)) {
        const tile = localAsset(match[1]);
        if (tile) check(tile);
      }
    }
  }
  console.log(`Validated ${target} build in ${root}`);
} catch (error) { console.error(`Build validation failed: ${error.message}`); process.exit(1); }
