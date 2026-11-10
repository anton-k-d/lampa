import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openConfigDatabase } from './config/database.mjs';
import { createConfigRepository } from './config/repository.mjs';
import { createConfigService } from './config/service.mjs';
import { createRuntimeStore } from './runtime/store.mjs';
import { createHomeServer } from './http/server.mjs';
import { createRecommendationRepository } from './recommendations/repository.mjs';
import { createJobs } from './recommendations/jobs.mjs';
import { createAISettings } from './recommendations/settings.mjs';
import { createRecommendationService, createMetadataProviderPool } from './recommendations/service.mjs';
import { createScheduler, shutdownRecommendationServer } from './recommendations/scheduler.mjs';
import { createMetadataCatalog } from './recommendations/metadata.mjs';
import { createOpenAITransport } from './recommendations/openai.mjs';
import { resolveManagedConfig } from './config/resolve.mjs';
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
  const recommendationRepository = createRecommendationRepository(db);
  const aiSettings = createAISettings(db,runtimeStore);
  const metadataProvider=createMetadataProviderPool({configuration:()=>{const global=repository.getHead('global');return {url:resolveManagedConfig(global?.document).metadata?.endpoint?.url,revision:global?.revision??0};},factory:createMetadataCatalog});
  const recommendationService = createRecommendationService({db,repository:recommendationRepository,jobs:createJobs(db),settings:aiSettings,providerRevision:()=>repository.getHead('global')?.revision??0,provider:metadataProvider,transportFactory:apiKey=>createOpenAITransport({apiKey})});
  const scheduler=createScheduler({db,settings:aiSettings,service:recommendationService});
  const server = createHomeServer({
    db, aiSettings, recommendationRepository, recommendationService,
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
    scheduler.start();
    console.log(`Server listening on ${address.address}:${address.port}`);
  });
  const shutdown = () => { void shutdownRecommendationServer({server,scheduler,db}).catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT',shutdown); process.once('SIGTERM',shutdown);
} catch {
  db?.close();
  console.error('Unable to start: check that DATABASE_PATH has an owned private directory (mode 0700) and is writable.');
  process.exitCode = 1;
}
