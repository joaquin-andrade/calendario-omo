require("dotenv").config();
const {Pool}=require("pg"),bcrypt=require("bcryptjs"),fs=require("fs");
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false});
(async()=>{await pool.query(fs.readFileSync(__dirname+"/schema.sql","utf8"));
const email=(process.env.ADMIN_EMAIL||"admin@omo.local").toLowerCase(), name=process.env.ADMIN_NAME||"Administrador", pass=process.env.ADMIN_PASSWORD||"CAMBIAR123!";
const hash=await bcrypt.hash(pass,12);
await pool.query(`INSERT INTO users(name,email,password_hash,role,can_publish) VALUES($1,$2,$3,'Administrador',true) ON CONFLICT(email) DO NOTHING`,[name,email,hash]);
console.log("Base inicializada. Administrador:",email);await pool.end()})().catch(e=>{console.error(e);process.exit(1)});