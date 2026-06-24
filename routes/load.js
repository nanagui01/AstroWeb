const express = require('express');
const router = express.Router();

router.get('/:scriptId', (req, res) => {
  const { key, hwid } = req.query;
  const scriptId = req.params.scriptId;

  if (!key) return res.status(400).send('Acesso negado. Key é obrigatória.');

  const keyData = req.db.prepare('SELECT * FROM keys WHERE key = ?').get([key]);
  if (!keyData) {
    log(req, 'KEY_INVALID', `Key: ${key}`);
    return res.status(403).send('Acesso negado. Key inválida.');
  }

  if (keyData.status === 'revoked') {
    log(req, 'KEY_REVOKED', `Key: ${key}`);
    return res.status(403).send('Acesso negado. Key revogada.');
  }

  if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
    req.db.prepare('UPDATE keys SET status = ? WHERE id = ?').run(['expired', keyData.id]);
    req.saveDb();
    log(req, 'KEY_EXPIRED', `Key: ${key}`);
    return res.status(403).send('Acesso negado. Key expirada.');
  }

  if (keyData.hwid && hwid && keyData.hwid !== hwid) {
    log(req, 'HWID_MISMATCH', `Key: ${key}`);
    return res.status(403).send('Acesso negado. HWID não corresponde.');
  }

  if (!keyData.hwid && hwid) {
    req.db.prepare('UPDATE keys SET hwid = ? WHERE id = ?').run([hwid, keyData.id]);
    req.saveDb();
  }

  const script = req.db.prepare('SELECT * FROM scripts WHERE id = ? AND status = ?').get([scriptId, 'online']);
  if (!script) {
    log(req, 'SCRIPT_NOT_FOUND', `Script: ${scriptId}`);
    return res.status(404).send('Acesso negado. Script não encontrado ou offline.');
  }

  req.db.prepare('UPDATE keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run([keyData.id]);
  req.saveDb();
  log(req, 'SCRIPT_ACCESS', `Script: ${script.name}, Key: ${key}`);

  res.type('text/plain').send(script.content);
});

function log(req, action, details) {
  req.db.prepare('INSERT INTO logs (action, details, ip) VALUES (?, ?, ?)').run([action, details, req.ip]);
  req.saveDb();
}

module.exports = router;
