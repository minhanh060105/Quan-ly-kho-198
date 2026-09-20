const { pool }=require('../config/db');
// Shared database snapshots, rather than local process broadcasts, work across VIP changes.
exports.stream=(req,res)=>{
 res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
 let closed=false,busy=false,signature='';
 const send=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
 const timer=setInterval(tick,2000);
 req.on('close',()=>{closed=true;clearInterval(timer);});
 async function tick(){if(closed||busy)return;busy=true;try{
  const [[user]]=await pool.query('SELECT status,deleted_at,token_version FROM users WHERE id=?',[req.user.id]);
  if(!user||user.status!=='ACTIVE'||user.deleted_at||user.token_version!==req.user.token_version){send('expired',{});clearInterval(timer);res.end();return;}
  const [logs]=await pool.query('SELECT a.id,a.action,a.created_at,a.user_id,u.full_name FROM audit_logs a JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 50');
  const next=JSON.stringify(logs);if(next!==signature){signature=next;send('change',{logs:req.user.role==='STAFF'?[]:logs});}else res.write(': heartbeat\n\n');
 }catch{if(!closed)send('unavailable',{});}finally{busy=false;}}
 tick();
};
