const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function labelDocument(data) {
 const labels = Array.isArray(data) ? data : [data];
 if (!labels.length || labels.length > 500) throw new Error('Danh sách tem không hợp lệ.');
 let count = 0;
 const body = labels.map(label => {
  const copies = label.label_print_count ?? 1;
  if (!Number.isInteger(copies) || copies < 1 || copies > 200 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(label.barcode_image || '')) throw new Error('Dữ liệu tem không hợp lệ.');
  count += copies;
  if (count > 2000) throw new Error('Mỗi lần in tối đa 2000 tem.');
  const html = `<section><b>BV 198 - KHOA VI SINH</b><p>${escape(label.item_name)}</p><img src="${label.barcode_image}"><p>${escape(label.batch_code)}</p><p>HSD: ${escape(String(label.expiry_date || '').slice(0,10))}</p></section>`;
  return html.repeat(copies);
 }).join('');
 return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:50mm 30mm;margin:0}*{box-sizing:border-box}body{margin:0;font:8px Arial}section{width:50mm;height:30mm;padding:2mm;text-align:center;overflow:hidden;break-after:page}section:last-child{break-after:auto}p{margin:1mm 0}img{width:44mm;height:12mm}</style></head><body>${body}</body></html>`;
}
module.exports = { labelDocument };
