const assert=require('node:assert/strict');const {randomUUID}=require('crypto');
const base=process.env.TEST_API_URL||'http://127.0.0.1:3100/api';let token;
async function request(route,body,key){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'X-Idempotency-Key':key||randomUUID()}: {})},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.equal(r.ok,true,route+': '+JSON.stringify(d));return d;}
(async()=>{
 token=(await request('/auth/login',{username:'admin',password:'123456'})).token;
 const items=(await request('/items')).items,locations=(await request('/locations')).locations;
 const code='TEST-'+Date.now(),key=randomUUID(),payload={supplier_name:'Nghiem thu',items:[{item_id:items[0].id,location_id:locations[0].id,batch_code:code,quantity:10,unit_price:100,expiry_date:'2028-12-31',label_print_count:2}]};
 const a=await request('/imports',payload,key),b=await request('/imports',payload,key);assert.equal(a.ticket.id,b.ticket.id);
 const scan=()=>request('/batches/scan/'+code);let batch=(await scan()).batch;assert.equal(+batch.current_quantity,10);
 const out=await request('/exports',{department_name:'Khoa test',notes:'Acceptance',items:[{batch_id:batch.batch_id,quantity:3}]});assert.equal(+(await scan()).batch.current_quantity,7);
 await request('/exports/'+out.ticket.id+'/cancel',{cancel_reason:'Nghiem thu hoan ton'});assert.equal(+(await scan()).batch.current_quantity,10);
 const labels=await request('/imports/'+a.ticket.id+'/labels');assert.equal(labels.labels[0].label_print_count,2);assert.ok(labels.labels[0].barcode_image.startsWith('data:image/png;base64,'));
 const x=await fetch(base+'/reports/movements?format=xlsx',{headers:{Authorization:'Bearer '+token}});assert.equal(x.status,200);assert.equal(Buffer.from(await x.arrayBuffer()).subarray(0,2).toString(),'PK');
 console.log('PASS login, import, idempotency replay, barcode, export, cancel/restore stock, labels, Excel');
})().catch(e=>{console.error(e);process.exitCode=1});
