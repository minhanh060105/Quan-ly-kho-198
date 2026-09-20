const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { fail, id, text, audit, transaction } = require('../utils/business');
function password(value) { if (typeof value !== 'string' || value.length < 10 || Buffer.byteLength(value) > 72) fail('Mật khẩu cần ít nhất 10 ký tự và tối đa 72 byte.'); return value; }
function profile(body) {
  if (!['ADMIN','MANAGER','STAFF'].includes(body.role)) fail('Vai trò không hợp lệ.');
  return [text(body.full_name,100), body.role, JSON.stringify({ can_import: body.can_import === true, can_export: body.can_export === true })];
}
exports.me = async (req,res) => res.json({ success:true, user:req.user });
exports.users = async (req,res) => { const [users] = await pool.query('SELECT id, username, full_name, role, status, permissions, created_at FROM users WHERE deleted_at IS NULL ORDER BY id'); res.json({success:true,users}); };
exports.createUser = async (req,res) => {
  const username = text(req.body.username,50); if (!/^[a-zA-Z0-9_.-]+$/.test(username)) fail('Tên đăng nhập chỉ gồm chữ, số, dấu . _ -');
  const values = profile(req.body), hash = await bcrypt.hash(password(req.body.password),12);
  const result = await transaction(async c => { const [r] = await c.query('INSERT INTO users (username,password_hash,full_name,role,permissions) VALUES (?,?,?,?,?)',[username,hash,...values]); await audit(c,req,'USER_CREATE','USER',r.insertId,{username,role:req.body.role}); return r.insertId; });
  res.status(201).json({success:true,id:result});
};
async function updateUser(req, deleted) {
  const target = id(req.params.id);
  if (target === req.user.id && (deleted || req.body.status === 'LOCKED' || req.body.role !== 'ADMIN')) fail('Không thể tự xóa, khóa hoặc hạ quyền tài khoản quản trị đang dùng.');
  return transaction(async c => {
    // Serialize all admin mutations on a stable set to protect the last active admin.
    const [users] = await c.query('SELECT id, role, status FROM users WHERE deleted_at IS NULL ORDER BY id FOR UPDATE');
    const user = users.find(u=>u.id===target); if (!user) fail('Không tìm thấy tài khoản.',404);
    if (user.role==='ADMIN' && user.status==='ACTIVE' && (deleted || req.body.role!=='ADMIN' || req.body.status!=='ACTIVE') && users.filter(u=>u.role==='ADMIN'&&u.status==='ACTIVE').length<=1) fail('Phải giữ ít nhất một admin đang hoạt động.');
    if (deleted) await c.query("UPDATE users SET deleted_at=NOW(),status='LOCKED',token_version=token_version+1 WHERE id=?",[target]);
    else {
      if (!['ACTIVE','LOCKED'].includes(req.body.status)) fail('Trạng thái không hợp lệ.');
      await c.query('UPDATE users SET full_name=?,role=?,permissions=?,status=?,token_version=token_version+1 WHERE id=?',[...profile(req.body),req.body.status,target]);
    }
    await audit(c,req,deleted?'USER_DELETE':'USER_UPDATE','USER',target,deleted?{deleted:true}:{role:req.body.role,status:req.body.status,can_import:req.body.can_import===true,can_export:req.body.can_export===true});
  });
}
exports.updateUser = async(req,res)=>{await updateUser(req,false);res.json({success:true});};
exports.deleteUser = async(req,res)=>{await updateUser(req,true);res.json({success:true,message:'Đã xóa tài khoản khỏi danh sách sử dụng; lịch sử nghiệp vụ được giữ nguyên.'});};
exports.changePassword = async(req,res)=>{
  const hash=await bcrypt.hash(password(req.body.new_password),12);
  await transaction(async c=>{
    const [[user]]=await c.query('SELECT password_hash FROM users WHERE id=? FOR UPDATE',[req.user.id]);
    if(typeof req.body.old_password!=='string'||!await bcrypt.compare(req.body.old_password,user.password_hash)) fail('Mật khẩu hiện tại không chính xác.');
    await c.query('UPDATE users SET password_hash=?,token_version=token_version+1 WHERE id=?',[hash,req.user.id]);
    await audit(c,req,'PASSWORD_CHANGE','USER',req.user.id,{});
  });res.json({success:true,message:'Đã đổi mật khẩu. Vui lòng đăng nhập lại.'});
};
exports.items = async(req,res)=>{const [items]=await pool.query('SELECT i.*, c.name AS category_name FROM items i JOIN categories c ON c.id=i.category_id ORDER BY i.name');const [categories]=await pool.query('SELECT * FROM categories ORDER BY name');res.json({success:true,items,categories});};
exports.saveItem = async(req,res)=>{
 const b=req.body;
 if (!Number.isFinite(b.min_stock)||b.min_stock<0||b.min_stock>999999999||!Number.isInteger(b.min_stock*1000)) fail('Ngưỡng tồn không hợp lệ.');
 if(b.expire_alert_days!==null&&(!Number.isInteger(b.expire_alert_days)||b.expire_alert_days<1||b.expire_alert_days>365)) fail('Ngưỡng hạn dùng phải từ 1 đến 365 hoặc để trống.');
 const values=[id(b.category_id),text(b.code,50),text(b.name,200),text(b.unit,20),b.min_stock,b.expire_alert_days,text(b.storage_condition||'',100,false)];
 const target=await transaction(async c=>{let target;
 if(req.params.id){target=id(req.params.id);const [r]=await c.query('UPDATE items SET category_id=?,code=?,name=?,unit=?,min_stock=?,expire_alert_days=?,storage_condition=? WHERE id=?',[...values,target]);if(!r.affectedRows)fail('Không tìm thấy mặt hàng.',404);}
 else {const [r]=await c.query('INSERT INTO items (category_id,code,name,unit,min_stock,expire_alert_days,storage_condition) VALUES (?,?,?,?,?,?,?)',values);target=r.insertId;}
 await audit(c,req,'ITEM_SAVE','ITEM',target,b);return target;});res.json({success:true,id:target});
};
exports.category = async(req,res)=>{const b=req.body;if(!['HOA_CHAT','VAT_TU','DUNG_CU'].includes(b.type))fail('Loại danh mục không hợp lệ.');await transaction(async c=>{const[r]=await c.query('INSERT INTO categories(code,name,type) VALUES (?,?,?)',[text(b.code,20),text(b.name,100),b.type]);await audit(c,req,'CATEGORY_CREATE','CATEGORY',r.insertId,b);});res.json({success:true});};
exports.configs=async(req,res)=>{const[configs]=await pool.query('SELECT * FROM system_config');res.json({success:true,configs});};
exports.saveConfig=async(req,res)=>{
 const allowed={DEFAULT_EXPIRE_ALERT_DAYS:[1,365],CANCEL_EXPORT_LIMIT_HOURS:[1,168]}; const [min,max]=allowed[req.body.config_key]||[];
 const value=Number(req.body.config_value);if(!min||!Number.isInteger(value)||value<min||value>max)fail('Tham số ngoài phạm vi cho phép.');
 await transaction(async c=>{await c.query('INSERT INTO system_config(config_key,config_value) VALUES (?,?) ON DUPLICATE KEY UPDATE config_value=VALUES(config_value)',[req.body.config_key,String(value)]);await audit(c,req,'CONFIG_UPDATE','CONFIG',req.body.config_key,{value});});res.json({success:true});
};
