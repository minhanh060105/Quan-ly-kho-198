const {test}=require('node:test');const assert=require('node:assert/strict');
const {databaseMode}=require('../src/health/mode');
const {labelDocument}=require('../../client/labels');
test('HA requires explicit standalone opt-in and >=3 cluster members',()=>{
 assert.equal(databaseMode({}).mode,'cluster');
 assert.throws(()=>databaseMode({DB_CLUSTER_SIZE:'1'}));
 assert.throws(()=>databaseMode({DB_CLUSTER_SIZE:'2'}));
 assert.throws(()=>databaseMode({DB_MODE:'standalone',NODE_ENV:'production'}));
 assert.equal(databaseMode({DB_MODE:'standalone'}).clusterSize,1);
});
test('barcode printing renders all labels, counts copies and escapes text',()=>{
 const html=labelDocument([{barcode_image:'data:image/png;base64,AAAA',batch_code:'<b>unsafe</b>',label_print_count:3}]);
 assert.equal((html.match(/<section>/g)||[]).length,3);assert.ok(html.includes('&lt;b&gt;unsafe&lt;/b&gt;'));
 assert.throws(()=>labelDocument([{barcode_image:'https://example.com/x'}]));
 assert.throws(()=>labelDocument([{barcode_image:'data:image/png;base64,AAAA',label_print_count:0}]));
});
