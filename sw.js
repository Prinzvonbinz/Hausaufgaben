self.addEventListener('push', e=>{
  let data={title:'Klassen Planer', body:'Neuer Termin'};
  try{ if(e.data) data=e.data.json(); }catch{}
  e.waitUntil(self.registration.showNotification(data.title, {body:data.body, icon:'https://cdn-icons-png.flaticon.com/512/3652/3652191.png', badge:'https://cdn-icons-png.flaticon.com/512/3652/3652191.png'}));
});
self.addEventListener('notificationclick', e=>{ e.notification.close(); e.waitUntil(clients.openWindow('/')); });
