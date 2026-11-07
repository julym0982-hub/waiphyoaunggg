'use strict';
const { db, getSettings, pubSettings, wrap } = require('../lib/core');

module.exports = wrap(async (req, res) => {
  const d = await db();
  const [s, p] = await Promise.all([
    getSettings(d),
    d.collection('products').find({}).sort({ createdAt: -1 }).toArray()
  ]);
  res.status(200).json({
    settings: pubSettings(s),
    products: p.map(x => ({
      id: x._id, title: x.title, price: x.price, salePrice: x.salePrice || 0,
      category: x.category, image: x.image || '', desc: x.desc || '', inStock: !!x.inStock
    }))
  });
});
