import { createApp } from './app.js';
const app = await createApp();
await app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1');
console.log(`useeCard 已启动，端口 ${process.env.PORT || 3000}`);
