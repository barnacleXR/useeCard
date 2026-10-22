import { createApp } from './app.js';
import { createServer } from 'node:http';
import { SystemService } from './system/system.service.js';
const app = await createApp();
await app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1');
const metricsPort=Number(process.env.METRICS_PORT||3001);
if(process.env.METRICS_ENABLED==='true'){
  const metrics=createServer((req,res)=>{if(req.url!=='/metrics'){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':'text/plain; version=0.0.4','Cache-Control':'no-store'}).end(app.get(SystemService).metrics());});
  metrics.listen(metricsPort,process.env.METRICS_HOST||'127.0.0.1');
  process.on('SIGTERM',()=>metrics.close());
}
console.log(`useeCard 已启动，端口 ${process.env.PORT || 3000}`);
