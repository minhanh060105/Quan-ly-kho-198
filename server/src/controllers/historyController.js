const { pool }=require('../config/db');
const { id, fail, dates }=require('../utils/business');
const ExcelJS=require('exceljs');
const { generateCode128Base64 }=require('../utils/barcode');
const union=`SELECT t.id,t.ticket_code,'IMPORT' AS type,t.supplier_name AS partner,'COMPLETED' AS status,t.created_at,t.created_by,t.notes,NULL AS reversal_ticket_code FROM import_tickets t
 UNION ALL SELECT t.id,t.ticket_code,'EXPORT',t.department_name,t.status,t.created_at,t.created_by,t.notes,t.reversal_ticket_code FROM export_tickets t`;
function filter(query, alias='t'){
 const [from,to]=dates(query),p=[from,to];let sql=`${alias}.created_at>=? AND ${alias}.created_at<DATE_ADD(?,INTERVAL 1 DAY)`;
 if(query.type&&query.type!=='ALL'){if(!['IMPORT','EXPORT'].includes(query.type))fail('Loại phiếu không hợp lệ.');sql+=` AND ${alias}.type=?`;p.push(query.type);}
 if(query.search){sql+=` AND (${alias}.ticket_code LIKE ? OR ${alias}.partner LIKE ?)`;p.push('%'+query.search+'%','%'+query.search+'%');}
 return [sql,p];
}
exports.tickets=async(req,res)=>{
 const [where,p]=filter(req.query);const page=Math.max(1,Number(req.query.page)||1),limit=50,offset=(Math.floor(page)-1)*limit;
 const [[{total}]]=await pool.query(`SELECT COUNT(*) total FROM (${union}) t WHERE ${where}`,p);
 const [tickets]=await pool.query(`SELECT t.*,u.full_name creator_name FROM (${union}) t JOIN users u ON u.id=t.created_by WHERE ${where} ORDER BY t.created_at DESC,t.id DESC LIMIT ? OFFSET ?`,[...p,limit,offset]);
 res.json({success:true,tickets,total,page:Math.floor(page),page_size:limit});
};
exports.detail=async(req,res)=>{
 const type=req.params.type.toUpperCase();if(!['IMPORT','EXPORT'].includes(type))fail('Loại phiếu không hợp lệ.');const table=type==='IMPORT'?'import':'export';
 const [[ticket]]=await pool.query(`SELECT t.*,u.full_name creator_name FROM ${table}_tickets t JOIN users u ON u.id=t.created_by WHERE t.id=?`,[id(req.params.id)]);if(!ticket)fail('Không tìm thấy phiếu.',404);
 const [items]=await pool.query(`SELECT d.*,b.batch_code,b.expiry_date,i.code item_code,i.name item_name,i.unit,l.name location_name FROM ${table}_ticket_details d JOIN batches b ON b.id=d.batch_id JOIN items i ON i.id=b.item_id LEFT JOIN locations l ON l.id=b.location_id WHERE d.ticket_id=?`,[ticket.id]);
 res.json({success:true,ticket:{...ticket,type,items}});
};
exports.labels=async(req,res)=>{
 const [rows]=await pool.query('SELECT d.label_print_count,b.batch_code,b.expiry_date,i.name item_name FROM import_ticket_details d JOIN batches b ON b.id=d.batch_id JOIN items i ON i.id=b.item_id WHERE d.ticket_id=?',[id(req.params.id)]);
 if(!rows.length)fail('Không tìm thấy phiếu nhập.',404);
 const labels=await Promise.all(rows.map(async r=>({...r,barcode_image:await generateCode128Base64(r.batch_code)})));res.json({success:true,labels});
};
exports.movements=async(req,res)=>{
 const [where,p]=filter(req.query);const [rows]=await pool.query(`SELECT t.ticket_code,t.type,t.partner,t.status,t.created_at,u.full_name creator_name,b.batch_code,i.code item_code,i.name item_name,i.unit,d.quantity,d.unit_price FROM (${union}) t JOIN users u ON u.id=t.created_by JOIN (
 SELECT ticket_id,batch_id,quantity,unit_price,'IMPORT' type FROM import_ticket_details
 UNION ALL SELECT ticket_id,batch_id,quantity,NULL,'EXPORT' FROM export_ticket_details
 ) d ON d.ticket_id=t.id AND d.type=t.type JOIN batches b ON b.id=d.batch_id JOIN items i ON i.id=b.item_id WHERE ${where} ORDER BY t.created_at,t.ticket_code,b.batch_code`,p);
 if(req.query.format!=='xlsx')return res.json({success:true,data:rows});
 const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Nhập xuất');
 ws.columns=[['Phiếu','ticket_code',24],['Loại','type',12],['Đối tác / Khoa','partner',28],['Trạng thái','status',16],['Ngày','created_at',22],['Người lập','creator_name',24],['Lô','batch_code',32],['Mã hàng','item_code',20],['Mặt hàng','item_name',35],['ĐVT','unit',12],['Số lượng','quantity',16],['Đơn giá','unit_price',16]].map(([header,key,width])=>({header,key,width}));
 rows.forEach(r=>ws.addRow({...r,quantity:Number(r.quantity),unit_price:r.unit_price==null?null:Number(r.unit_price)}));ws.getRow(1).font={bold:true};ws.views=[{state:'frozen',ySplit:1}];ws.autoFilter='A1:L1';
 res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename=Bao_cao_nhap_xuat.xlsx');res.send(await wb.xlsx.writeBuffer());
};
exports.audit=async(req,res)=>{
 const [from,to]=dates(req.query),p=[from,to];let where='a.created_at>=? AND a.created_at<DATE_ADD(?,INTERVAL 1 DAY)';
 if(req.query.user_id){where+=' AND a.user_id=?';p.push(id(req.query.user_id));}if(req.query.action){where+=' AND a.action LIKE ?';p.push('%'+req.query.action+'%');}
 const page=Math.max(1,Math.floor(Number(req.query.page)||1));
 const [[{total}]]=await pool.query(`SELECT COUNT(*) total FROM audit_logs a WHERE ${where}`,p);
 const [logs]=await pool.query(`SELECT a.*,u.full_name,u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT 50 OFFSET ?`,[...p,(page-1)*50]);res.json({success:true,logs,total,page,page_size:50});
};
exports.stocktakeDetail=async(req,res)=>{
 const [[ticket]]=await pool.query('SELECT * FROM stocktakes WHERE id=?',[id(req.params.id)]);if(!ticket)fail('Không tìm thấy phiếu kiểm kê.',404);
 const[items]=await pool.query('SELECT d.*,b.batch_code,b.current_quantity,i.name item_name,i.unit FROM stocktake_details d JOIN batches b ON b.id=d.batch_id JOIN items i ON i.id=b.item_id WHERE d.stocktake_id=?',[ticket.id]);res.json({success:true,ticket,items});
};
