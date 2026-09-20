const fs=require('fs');const path=require('path');const {spawn}=require('child_process');const {pipeline}=require('stream/promises');const zlib=require('zlib');
require('dotenv').config({path:path.resolve(__dirname,'../.env')});
function child(command,args){const p=spawn(command,args,{env:{...process.env,MYSQL_PWD:process.env.DB_PASSWORD},stdio:['pipe','pipe','pipe']});let error='';p.stderr.on('data',d=>error+=d);p.done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>code===0?resolve():reject(new Error(error||`Exit ${code}`)));});return p;}
const args=['--host='+process.env.DB_HOST,'--port='+(process.env.DB_PORT||3306),'--user='+process.env.DB_USER];
async function main(){
 const [mode='backup',file,target]=process.argv.slice(2);
 if(mode==='backup'){
  const dir=path.resolve(process.env.BACKUP_DIR||path.join(__dirname,'../../backups'));fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const dest=path.join(dir,'visinh-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sql.gz');const tmp=dest+'.partial';
  const p=child(process.env.MYSQLDUMP_BIN||'mysqldump',[...args,'--single-transaction','--quick','--routines','--triggers','--no-tablespaces','--set-gtid-purged=OFF',process.env.DB_NAME||'visinh_db']);p.stdin.end();
  try{await Promise.all([p.done,pipeline(p.stdout,zlib.createGzip(),fs.createWriteStream(tmp,{mode:0o600}))]);fs.renameSync(tmp,dest);console.log(dest);}catch(e){p.kill();fs.rmSync(tmp,{force:true});throw e;}
 }else if(mode==='restore'){
  if(!file||!target||!/^visinh_restore_[a-zA-Z0-9_]+$/.test(target))throw Error('Dùng: node scripts/backup.js restore FILE.sql.gz visinh_restore_TEN. Chỉ phục hồi vào DB kiểm tra mới.');
  const mysql=require('mysql2/promise');const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD});
  try{await c.query('CREATE DATABASE `'+target+'`');}finally{await c.end();}
  const p=child(process.env.MYSQL_BIN||'mysql',[...args,target]);p.stdout.resume();await Promise.all([p.done,pipeline(fs.createReadStream(path.resolve(file)),zlib.createGunzip(),p.stdin)]);console.log('Restored: '+target);
 }else throw Error('Chế độ phải là backup hoặc restore');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
