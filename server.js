const fs = require('fs');
const path = require('path');
const express = require('express');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const VAPID_FILE = path.join(__dirname, 'vapid-keys.json');

function loadVapidKeys() {
  if (fs.existsSync(VAPID_FILE)) {
    return JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
  }
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
  return keys;
}

const vapidKeys = loadVapidKeys();
const subject = process.env.VAPID_SUBJECT || 'mailto:dev@localhost';
webpush.setVapidDetails(subject, vapidKeys.publicKey, vapidKeys.privateKey);

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// simple in-memory store of subscriptions (dedup by endpoint)
const subscriptions = new Map();

app.get('/vapidPublicKey', (_, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  subscriptions.set(sub.endpoint, sub);
  console.log(`Subscribed (${subscriptions.size} total)`);
  res.status(201).json({ ok: true });
});

app.post('/trigger', async (req, res) => {
  const { title = 'Notification', body = 'Hello depuis le serveur!', data = {} } = req.body || {};
  const payload = JSON.stringify({ title, body, data });

  const results = [];
  for (const [endpoint, sub] of subscriptions.entries()) {
    try {
      await webpush.sendNotification(sub, payload);
      results.push({ endpoint, status: 'sent' });
    } catch (err) {
      // remove gone subscriptions
      if (err.statusCode === 410 || err.statusCode === 404) {
        subscriptions.delete(endpoint);
      }
      results.push({ endpoint, status: 'error', error: err.message });
    }
  }
  res.json({ sent: results.length, results });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
