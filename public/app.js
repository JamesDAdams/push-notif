const elEnable = document.getElementById('enable');
const elSend = document.getElementById('send');
const elReset = document.getElementById('reset');
const elStatus = document.getElementById('status');

function log(...msgs) {
  const msg = msgs.map(m => (typeof m === 'string' ? m : JSON.stringify(m))).join(' ');
  elStatus.textContent = msg;
  console.log(...msgs);
}

async function getPublicKey() {
  const r = await fetch('/vapidPublicKey');
  if (!r.ok) throw new Error('Impossible de récupérer la clé publique VAPID');
  const { publicKey } = await r.json();
  return publicKey;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const outputArray = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) outputArray[i] = raw.charCodeAt(i);
  return outputArray;
}

async function sendSubscriptionToServer(subscription) {
  const resp = await fetch('/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(subscription),
  });
  if (!resp.ok) throw new Error('Envoi de la souscription échoué');
}

async function ensureSubscription(reg) {
  // 1) Réutiliser si déjà abonné
  let sub = await reg.pushManager.getSubscription();
  if (sub) return sub;

  // 2) Essayer de s’abonner
  const publicKey = await getPublicKey();
  const appServerKey = urlBase64ToUint8Array(publicKey);

  try {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey });
    return sub;
  } catch (err) {
    // 3) En cas d’AbortError (ou erreur de service), tenter de nettoyer et réessayer une fois
    if (err.name === 'AbortError' || /push service error/i.test(err.message || '')) {
      console.warn('Subscribe failed with AbortError; attempting unsubscribe-then-retry...');
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        try { await existing.unsubscribe(); } catch {}
      }
      // Petite attente pour laisser le push service se stabiliser
      await new Promise(r => setTimeout(r, 300));
      // Retry unique
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey });
      return sub;
    }
    throw err;
  }
}

async function registerAndSubscribe() {
  if (!('serviceWorker' in navigator)) throw new Error('Service Worker non supporté');
  if (!('PushManager' in window)) throw new Error('Push API non supportée');

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready; // attendre l’activation
  log('Service Worker prêt, demande de permission...');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permission refusée');

  const subscription = await ensureSubscription(reg);
  await sendSubscriptionToServer(subscription);

  elSend.disabled = false;
  elReset.disabled = false;
  log('Souscription prête. Prêt à recevoir des notifications.');
  return { reg, subscription };
}

async function resetSubscription() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    try {
      await sub.unsubscribe();
      log('Ancienne souscription supprimée, recréation en cours...');
    } catch (e) {
      console.warn('Unsubscribe failed:', e);
    }
  }
  const newSub = await ensureSubscription(reg);
  await sendSubscriptionToServer(newSub);
  elSend.disabled = false;
  elReset.disabled = false;
  log('Nouvelle souscription créée.');
}

elEnable.addEventListener('click', async () => {
  elEnable.disabled = true;
  try {
    await registerAndSubscribe();
  } catch (e) {
    log(`${e.name || 'Error'}: ${e.message || String(e)}`);
    elEnable.disabled = false;
  }
});

elSend.addEventListener('click', async () => {
  elSend.disabled = true;
  try {
    await fetch('/trigger', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Coucou!',
        body: 'Ceci est une notification push de test.',
        data: { ts: Date.now() },
      }),
    });
    log('Notification de test envoyée.');
  } catch (e) {
    log('Erreur: ' + (e.message || String(e)));
  } finally {
    elSend.disabled = false;
  }
});

elReset.addEventListener('click', async () => {
  elReset.disabled = true;
  try {
    await resetSubscription();
  } catch (e) {
    log(`${e.name || 'Error'}: ${e.message || String(e)}`);
  } finally {
    elReset.disabled = false;
  }
});
