const crypto = require('crypto');

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') {
    throw new Error('Invalid image data');
  }

  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);

  if (!match) {
    throw new Error('Malformed image data URL');
  }

  const [, mime, base64] = match;

  return {
    mime: mime.toLowerCase(),
    base64,
    buffer: Buffer.from(base64, 'base64'),
  };
}

function hashPrescription(dataUrl) {
  const { buffer, mime } = parseDataUrl(dataUrl);

  const sha256 = crypto
    .createHash('sha256')
    .update(buffer)
    .digest('hex');

  return {
    algorithm: 'sha256',
    hash: sha256,
    mime,
    bytes: buffer.length,
  };
}

module.exports = {
  parseDataUrl,
  hashPrescription,
};