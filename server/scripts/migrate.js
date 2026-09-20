const fs=require('fs');const path=require('path');
require('dotenv').config({path:path.resolve(__dirname,'../.env')});
async function migrate(){
 const c=await require('mysql2/promise').createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'visinh_db',multipleStatements:true});
 try {
  for(const [name,definition] of [['deleted_at','DATETIME NULL'],['token_version','INT NOT NULL DEFAULT 0']]){
   const [rows]=await c.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['users',name]);
   if(!rows.length)await c.query(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
  }
  await c.query(fs.readFileSync(path.resolve(__dirname,'../../infra/mysql/migrations/001_api_requests.sql'),'utf8'));
  await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
  const [done]=await c.execute('SELECT name FROM schema_migrations WHERE name=?',['002_requirements']);
  if(!done.length){
   const sql=fs.readFileSync(path.resolve(__dirname,'../../infra/mysql/migrations/002_requirements.sql'),'utf8').replace(/ALTER TABLE users[^;]+;/,'');
   await c.query(sql);await c.execute('INSERT INTO schema_migrations(name) VALUES (?)',['002_requirements']);
  }
  console.log('Migrations OK');
 }finally{await c.end();}
}
migrate().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
