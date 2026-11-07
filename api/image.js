'use strict';
const { db, ObjectId, httpErr, wrap } = require('../lib/core');

module.exports = wrap(async (req, res) => {
  const id = String(req.query.id || '');
  if (!/^[a-f0-9]{24}$/.test(id)) throw httpErr(404, 'Not found');
  const d = await db();
  const doc = await d.collection('images').findOne({ _id: new ObjectId(id) });
  if (!doc) throw httpErr(404, 'Not found');
  const b = doc.data.buffer;
  res.setHeader('Content-Type', doc.type || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.status(200).end(Buffer.from(b.subarray(0, doc.data.position || b.length)));
});
