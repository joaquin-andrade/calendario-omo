require("dotenv").config();
const express=require("express");
const session=require("express-session");
const pgSession=require("connect-pg-simple")(session);
const {Pool}=require("pg");
const bcrypt=require("bcryptjs");
const path=require("path");

const app=express();
app.set("trust proxy",1);
const PORT=process.env.PORT||3000;
const connectionString=process.env.DATABASE_URL||process.env.POSTGRES_URL||process.env.POSTGRES_PRISMA_URL;

const pool=new Pool({
  connectionString,
  ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false
});

const AREAS=["Dirección","UTP","Inspectoría","Convivencia Escolar","PIE","Informática","Orquesta","Actividades Artísticas","Deportes","Reuniones","Otros"];

app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));

app.use(session({
  store:new pgSession({pool,tableName:"user_sessions",createTableIfMissing:true}),
  secret:process.env.SESSION_SECRET||"CAMBIA_ESTA_CLAVE_EN_VERCEL",
  resave:false,
  saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:43200000}
}));

const login=(req,res,next)=>req.session.user?next():res.status(401).json({error:"Debes iniciar sesión"});
const publisher=(req,res,next)=>{
  if(!req.session.user)return res.status(401).json({error:"Debes iniciar sesión para publicar"});
  if(req.session.user.role==="Administrador"||req.session.user.canPublish)return next();
  return res.status(403).json({error:"Tu cuenta no tiene permiso para publicar"});
};
const admin=(req,res,next)=>req.session.user?.role==="Administrador"?next():res.status(403).json({error:"Solo el administrador puede realizar esta acción"});

async function ensureSchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS users(
    id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Publicador',can_publish BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS event_categories(
    id BIGSERIAL PRIMARY KEY,name TEXT UNIQUE NOT NULL,color TEXT NOT NULL DEFAULT '#1E88E5',
    active BOOLEAN NOT NULL DEFAULT TRUE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS events(
    id BIGSERIAL PRIMARY KEY,title TEXT NOT NULL,event_date DATE NOT NULL,start_time TIME NOT NULL,
    end_time TIME NOT NULL,place TEXT NOT NULL DEFAULT '',area TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_by_name TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),category_id BIGINT REFERENCES event_categories(id) ON DELETE SET NULL
  )`);
  const cats=[
    ["Dirección","#8E24AA"],["UTP","#1E88E5"],["Inspectoría","#FB8C00"],
    ["Convivencia Escolar","#43A047"],["PIE","#00ACC1"],["Informática","#3949AB"],
    ["Orquesta","#D81B60"],["Actividades Artísticas","#6D4C41"],["Deportes","#00897B"],
    ["Reuniones","#F4511E"],["Otros","#757575"]
  ];
  for(const [name,color] of cats) await pool.query(
    `INSERT INTO event_categories(name,color) VALUES($1,$2) ON CONFLICT(name) DO NOTHING`,[name,color]
  );
  // Optional first-run account bootstrap. Set these in Vercel Environment Variables.
  if(process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD){
    const h=await bcrypt.hash(process.env.ADMIN_PASSWORD,12);
    await pool.query(`INSERT INTO users(name,email,password_hash,role,can_publish)
      VALUES($1,$2,$3,'Administrador',true)
      ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,
      role='Administrador',can_publish=true,active=true`,
      [process.env.ADMIN_NAME||"Administrador",process.env.ADMIN_EMAIL.trim().toLowerCase(),h]);
  }
  if(process.env.PUBLISHER_EMAIL&&process.env.PUBLISHER_PASSWORD){
    const h=await bcrypt.hash(process.env.PUBLISHER_PASSWORD,12);
    await pool.query(`INSERT INTO users(name,email,password_hash,role,can_publish)
      VALUES($1,$2,$3,'Publicador',true)
      ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,
      role='Publicador',can_publish=true,active=true`,
      [process.env.PUBLISHER_NAME||"Publicador",process.env.PUBLISHER_EMAIL.trim().toLowerCase(),h]);
  }
}

app.get("/api/areas",(req,res)=>res.json(AREAS));
app.get("/api/me",(req,res)=>res.json({user:req.session.user||null}));

app.post("/api/login",async(req,res)=>{
  try{
    const email=String(req.body.email||"").trim().toLowerCase();
    const password=String(req.body.password||"");
    const r=await pool.query(`SELECT id,name,email,role,can_publish,active,password_hash
      FROM users WHERE lower(email)=lower($1) AND active=true LIMIT 1`,[email]);
    if(!r.rows.length||!(await bcrypt.compare(password,r.rows[0].password_hash)))
      return res.status(401).json({error:"Correo o contraseña incorrectos"});
    const u=r.rows[0];
    req.session.user={id:u.id,name:u.name,email:u.email,role:u.role,canPublish:u.role==="Administrador"||u.can_publish};
    res.json({user:req.session.user});
  }catch(e){console.error(e);res.status(500).json({error:"Error del servidor"});}
});

app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get("/api/events",async(req,res)=>{
  try{
    const r=await pool.query(`SELECT e.id,e.title,e.event_date AS date,e.start_time AS start,
      e.end_time AS "end",e.place,e.area,e.description,e.created_by AS "createdBy",
      e.created_by_name AS "createdByName",e.category_id AS "categoryId"
      FROM events e ORDER BY e.event_date,e.start_time`);
    res.json(r.rows);
  }catch(e){console.error("GET /api/events",e);res.status(500).json({error:"No se pudieron cargar las actividades"});}
});

app.post("/api/events",publisher,async(req,res)=>{
  try{
    const {title,date,start,end,place="",area,description="",categoryId=null}=req.body;
    if(!title||!date||!start||!end||!area)return res.status(400).json({error:"Completa actividad, fecha, horarios y área"});
    if(!AREAS.includes(area))return res.status(400).json({error:"Área no válida"});
    const r=await pool.query(`INSERT INTO events
      (title,event_date,start_time,end_time,place,area,description,created_by,created_by_name,category_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id,title,event_date AS date,start_time AS start,end_time AS "end",place,area,description,
      created_by AS "createdBy",created_by_name AS "createdByName",category_id AS "categoryId"`,
      [title,date,start,end,place,area,description,req.session.user.id,req.session.user.name,categoryId]);
    res.status(201).json(r.rows[0]);
  }catch(e){console.error("POST /api/events",e);res.status(500).json({error:"No se pudo guardar la actividad"});}
});

app.delete("/api/events/:id",publisher,async(req,res)=>{
  try{
    const id=Number(req.params.id);
    const r=await pool.query("SELECT created_by FROM events WHERE id=$1",[id]);
    if(!r.rows.length)return res.status(404).json({error:"Actividad no encontrada"});
    if(req.session.user.role!=="Administrador"&&r.rows[0].created_by!==req.session.user.id)
      return res.status(403).json({error:"Solo puedes eliminar tus actividades"});
    await pool.query("DELETE FROM events WHERE id=$1",[id]);
    res.json({ok:true});
  }catch(e){console.error(e);res.status(500).json({error:"No se pudo eliminar"});}
});

app.get("/api/users",login,admin,async(req,res)=>{
  try{
    const r=await pool.query(`SELECT id,name,email,role,can_publish AS "canPublish",active FROM users ORDER BY name`);
    res.json(r.rows);
  }catch(e){res.status(500).json({error:"No se pudieron cargar los usuarios"});}
});

app.post("/api/users",login,admin,async(req,res)=>{
  try{
    const {name,email,password,role="Publicador"}=req.body;
    if(!name||!email||!password)return res.status(400).json({error:"Completa nombre, correo y contraseña"});
    if(password.length<8)return res.status(400).json({error:"La contraseña debe tener al menos 8 caracteres"});
    const hash=await bcrypt.hash(password,12);
    const canPublish=role==="Administrador"||role==="Publicador";
    const r=await pool.query(`INSERT INTO users(name,email,password_hash,role,can_publish)
      VALUES($1,$2,$3,$4,$5)
      RETURNING id,name,email,role,can_publish AS "canPublish",active`,
      [name,email.trim().toLowerCase(),hash,role,canPublish]);
    res.status(201).json(r.rows[0]);
  }catch(e){res.status(500).json({error:e.code==="23505"?"Ese correo ya está registrado":"No se pudo crear el usuario"});}
});

app.patch("/api/users/:id",login,admin,async(req,res)=>{
  try{
    const fields=[],values=[];
    if(req.body.canPublish!==undefined){fields.push(`can_publish=$${values.length+1}`);values.push(!!req.body.canPublish);}
    if(req.body.active!==undefined){fields.push(`active=$${values.length+1}`);values.push(!!req.body.active);}
    if(!fields.length)return res.status(400).json({error:"Sin cambios"});
    values.push(Number(req.params.id));
    const r=await pool.query(`UPDATE users SET ${fields.join(",")} WHERE id=$${values.length}
      RETURNING id,name,email,role,can_publish AS "canPublish",active`,values);
    res.json(r.rows[0]);
  }catch(e){res.status(500).json({error:"No se pudo actualizar el usuario"});}
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

ensureSchema().then(()=>app.listen(PORT,()=>console.log("Calendario OMO en puerto "+PORT)))
.catch(e=>{console.error("No se pudo inicializar la base de datos",e);app.listen(PORT,()=>console.log("Servidor iniciado sin inicialización de BD"));});
