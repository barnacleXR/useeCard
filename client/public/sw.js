const CACHE='useecard-shell-v2';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/','/favicon.svg','/manifest.webmanifest','/pwa-192.png','/pwa-512.png'])));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('useecard-shell-')&&key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim();});
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  // 页面外壳网络优先；在线成功时更新缓存，离线时才能打开与当前资源文件匹配的最新版本。
  if(request.mode==='navigate'){event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();void caches.open(CACHE).then(cache=>cache.put('/',copy));}return response;}).catch(()=>caches.match('/')));return;}
  if(url.pathname.startsWith('/assets/')||url.pathname==='/favicon.svg'||url.pathname==='/manifest.webmanifest')event.respondWith(caches.match(request).then(hit=>hit||fetch(request).then(response=>{if(response.ok){const copy=response.clone();void caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;})));
});
self.addEventListener('push',event=>{let data={title:'useeCard',body:'有新的提醒，请打开应用查看。',url:'/notifications'};try{data={...data,...event.data.json()};}catch{}event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/apple-touch-icon.png',data:{url:data.url}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.openWindow(event.notification.data?.url||'/notifications'));});
