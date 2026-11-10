import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openConfigDatabase } from './config/database.mjs';
import { createConfigRepository } from './config/repository.mjs';
import { createConfigService } from './config/service.mjs';
import { createRuntimeStore } from './runtime/store.mjs';
import { createHomeServer } from './http/server.mjs';
import { validateLiteValues } from './http/lite-policy.mjs';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8080);
const databasePath = process.env.DATABASE_PATH || join(process.env.RUNTIME_DIRECTORY || join(serverRoot,'.data'), 'config.sqlite');
let db;
try {
  db = openConfigDatabase(databasePath);
  const repository = createConfigRepository(db);
  const runtimeStore = createRuntimeStore(db);
  const service = createConfigService({repository, policy:runtimeStore.context, additionalValidator:validateLiteValues});
  const server = createHomeServer({
    repository,
    service,
    runtimeStore,
    adminRoot: join(serverRoot,'admin'),
    clientRoot: process.env.CLIENT_ROOT || resolve(serverRoot,'../build/github/lampa'),
    allowedHosts: (process.env.ALLOWED_HOSTS || `${host},localhost,127.0.0.1`).split(',').filter(Boolean),
  });
  server.on('error', () => { console.error('Server could not start; check HOST and PORT.'); db.close(); process.exitCode = 1; });
  server.listen(port,host, () => {
    const address = server.address();
    console.log(`Server listening on ${address.address}:${address.port}`);
  });
  const shutdown = () => server.close(() => { db.close(); });
  process.once('SIGINT',shutdown); process.once('SIGTERM',shutdown);
} catch {
  db?.close();
  console.error('Unable to start: check that DATABASE_PATH has an owned private directory (mode 0700) and is writable.');
  process.exitCode = 1;
}
