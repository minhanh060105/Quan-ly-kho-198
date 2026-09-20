function quantity(value, allowZero = false) {
  return typeof value === 'number' && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) && value <= 999999999.999 && Math.abs(value * 1000 - Math.round(value * 1000)) < 0.00001;
}
function validItems(items, field, id, allowZero = false) {
  return Array.isArray(items) && items.length > 0 && items.length <= 500 && items.every(item => item && Number.isInteger(item[id]) && item[id] > 0 && quantity(item[field], allowZero)) && new Set(items.map(item => item[id])).size === items.length;
}
module.exports = { quantity, validItems };
