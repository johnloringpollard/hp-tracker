self.addEventListener("push", event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "Daily Fit";
  const options = {
    body: data.body || "Daily Fit update",
    icon: "app-icon-192.png",
    badge: "app-icon-192.png",
    data: {
      url: data.url || self.registration.scope
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();

  const url = event.notification.data?.url || self.registration.scope;

  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const existingClient = windowClients.find(client => client.url.startsWith(self.registration.scope));

    if (existingClient) {
      await existingClient.focus();
      return;
    }

    await clients.openWindow(url);
  })());
});
