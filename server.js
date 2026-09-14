'use strict';
const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const path       = require('path');
const fs         = require('fs');
const { MongoClient } = require('mongodb');

const JWT_SECRET   = 'bulo-sint-franciscus-2025-secret';
const PORT         = process.env.PORT || 3000;
const MONGODB_URI  = process.env.MONGODB_URI;
const DB_FILE      = path.join(__dirname, 'users.json');
const ANSWERS_FILE = path.join(__dirname, 'answers.json');

// ─── Opslag: MongoDB als MONGODB_URI is ingesteld, anders lokale JSON-bestanden ──
// De JSON-bestanden staan op Render's tijdelijke schijf en gaan verloren bij een
// herstart/redeploy. Zet MONGODB_URI in de omgeving voor permanente opslag.
function makeFileStore(){
  function loadDB(){
    if(!fs.existsSync(DB_FILE)) return { users: [] };
    try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); } catch(e){ return {users:[]}; }
  }
  function saveDB(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
  function loadAnswers(){
    if(!fs.existsSync(ANSWERS_FILE)) return [];
    try { return JSON.parse(fs.readFileSync(ANSWERS_FILE,'utf8')); } catch(e){ return []; }
  }
  function saveAnswers(arr){ fs.writeFileSync(ANSWERS_FILE, JSON.stringify(arr,null,2)); }

  return {
    async init(){},
    async findUserByUsernameLower(usernameLower){
      const db = loadDB();
      return db.users.find(u=>u.usernameLower===usernameLower) || null;
    },
    async insertUserIfMissing(doc){
      const db = loadDB();
      if(db.users.some(u=>u._id===doc._id)) return;
      db.users.push(doc);
      saveDB(db);
    },
    async insertUser(doc){
      const db = loadDB();
      db.users.push(doc);
      saveDB(db);
    },
    async updateUser(id, patch){
      const db = loadDB();
      const user = db.users.find(u=>u._id===id);
      if(!user) return false;
      Object.assign(user, patch);
      saveDB(db);
      return true;
    },
    async deleteUser(id){
      const db = loadDB();
      db.users = db.users.filter(u=>u._id!==id);
      saveDB(db);
    },
    async listUsers(){
      return loadDB().users;
    },
    async insertAnswer(doc){
      const answers = loadAnswers();
      answers.push(doc);
      saveAnswers(answers);
    },
    async listAnswers(){
      return loadAnswers();
    },
    async clearAnswers(){
      saveAnswers([]);
    }
  };
}

function makeMongoStore(usersCol, answersCol){
  return {
    async init(){},
    async findUserByUsernameLower(usernameLower){
      return usersCol.findOne({usernameLower});
    },
    async insertUserIfMissing(doc){
      const exists = await usersCol.findOne({_id:doc._id});
      if(!exists) await usersCol.insertOne(doc);
    },
    async insertUser(doc){
      await usersCol.insertOne(doc);
    },
    async updateUser(id, patch){
      const result = await usersCol.updateOne({_id:id}, {$set:patch});
      return result.matchedCount>0;
    },
    async deleteUser(id){
      await usersCol.deleteOne({_id:id});
    },
    async listUsers(){
      return usersCol.find({}).toArray();
    },
    async insertAnswer(doc){
      await answersCol.insertOne(doc);
    },
    async listAnswers(){
      const answers = await answersCol.find({}).sort({timestamp:1}).toArray();
      return answers.map(({_id, ...rest})=>rest);
    },
    async clearAnswers(){
      await answersCol.deleteMany({});
    }
  };
}

let store;

// ─── Hardcoded gebruikers ────────────────────────────────────────────────────
const CLASSES = {
  'Sprinkhanen': ['Dempsy','Sean','Matheo','Ilyas','Wesley','Colin']
};
const TEACHERS = {
  'Jolien': 'Sprinkhanen'
};
const STUDENT_PASSWORD = 'jufjolien';
const ADMIN_PASSWORD   = 'admin123';

function defaultAvatar(){
  return {shirt:0xe8231a,pants:0x2a3a6a,shoes:0x1a1a1a,pet:null};
}

async function initUsers(){
  await store.insertUserIfMissing({ _id:'admin', username:'admin', usernameLower:'admin',
    password:bcrypt.hashSync(ADMIN_PASSWORD,10), role:'admin', klas:'',
    avatar:defaultAvatar(), coins:0, xp:0, createdAt:new Date().toISOString() });

  const teacherHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  for(const [name, klas] of Object.entries(TEACHERS)){
    const id = 'teacher-'+name.toLowerCase();
    await store.insertUserIfMissing({ _id:id, username:name, usernameLower:name.toLowerCase(), klas,
      password:teacherHash, role:'admin', avatar:defaultAvatar(), coins:0, xp:0,
      createdAt:new Date().toISOString() });
  }

  const studentHash = bcrypt.hashSync(STUDENT_PASSWORD, 10);
  for(const [klas, names] of Object.entries(CLASSES)){
    for(const name of names){
      const id = klas.toLowerCase()+'-'+name.toLowerCase();
      await store.insertUserIfMissing({ _id:id, username:name, usernameLower:name.toLowerCase(), klas,
        password:studentHash, role:'student', avatar:defaultAvatar(), coins:0, xp:0,
        createdAt:new Date().toISOString() });
    }
  }
  console.log('✅ Gebruikers gesynchroniseerd');
}

// ─── Express app ─────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req,res)=>{
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

// Middleware: JWT check
function auth(req,res,next){
  const h = req.headers.authorization;
  if(!h) return res.status(401).json({error:'Geen token'});
  try { req.user = jwt.verify(h.split(' ')[1], JWT_SECRET); next(); }
  catch(e){ res.status(401).json({error:'Ongeldig token'}); }
}
function adminOnly(req,res,next){
  if(req.user.role!=='admin') return res.status(403).json({error:'Alleen admin'});
  next();
}

// ─── Klassenlijst (publiek, geen login nodig) ────────────────────────────────
app.get('/api/classes', (req,res)=>{
  const result = {};
  for(const [klas, names] of Object.entries(CLASSES)){
    result[klas] = names;
  }
  res.json(result);
});

// ─── Auth routes ─────────────────────────────────────────────────────────
app.post('/api/login', async (req,res)=>{
  const {username, password} = req.body;
  if(!username||!password) return res.status(400).json({error:'Vul gebruikersnaam en wachtwoord in'});
  const user = await store.findUserByUsernameLower(username.toLowerCase());
  if(!user||!bcrypt.compareSync(password, user.password))
    return res.status(401).json({error:'Verkeerde gebruikersnaam of wachtwoord'});
  const token = jwt.sign({id:user._id, username:user.username, role:user.role}, JWT_SECRET, {expiresIn:'8h'});
  res.json({ token, user:{ id:user._id, username:user.username, role:user.role, avatar:user.avatar, coins:user.coins, xp:user.xp } });
});

// ─── Admin: gebruikers beheren ────────────────────────────────────────────
app.get('/api/users', auth, adminOnly, async (req,res)=>{
  const users = await store.listUsers();
  res.json(users.map(u=>({id:u._id,username:u.username,role:u.role,coins:u.coins,xp:u.xp,createdAt:u.createdAt})));
});

app.post('/api/users', auth, adminOnly, async (req,res)=>{
  const {username, password} = req.body;
  if(!username||!password) return res.status(400).json({error:'Gebruikersnaam en wachtwoord vereist'});
  const existing = await store.findUserByUsernameLower(username.toLowerCase());
  if(existing) return res.status(400).json({error:'Gebruikersnaam bestaat al'});
  const id = username.toLowerCase().replace(/\s+/g,'-') + '-' + Date.now();
  const hash = bcrypt.hashSync(password, 10);
  await store.insertUser({ _id:id, username, usernameLower:username.toLowerCase(), password:hash,
    role:'student', avatar:defaultAvatar(), coins:0, xp:0, createdAt:new Date().toISOString() });
  res.json({ok:true, id, username});
});

app.delete('/api/users/:id', auth, adminOnly, async (req,res)=>{
  if(req.params.id==='admin') return res.status(400).json({error:'Kan admin niet verwijderen'});
  await store.deleteUser(req.params.id);
  res.json({ok:true});
});

app.patch('/api/users/:id/password', auth, adminOnly, async (req,res)=>{
  const {password} = req.body;
  if(!password) return res.status(400).json({error:'Wachtwoord vereist'});
  const hash = bcrypt.hashSync(password, 10);
  const matched = await store.updateUser(req.params.id, {password:hash});
  if(!matched) return res.status(404).json({error:'Gebruiker niet gevonden'});
  res.json({ok:true});
});

// ─── Progress opslaan ────────────────────────────────────────────────────
app.patch('/api/me/progress', auth, async (req,res)=>{
  const {coins, xp, avatar} = req.body;
  const patch = {};
  if(coins!=null) patch.coins = coins;
  if(xp!=null)    patch.xp   = xp;
  if(avatar)      patch.avatar = avatar;
  const matched = await store.updateUser(req.user.id, patch);
  if(!matched) return res.status(404).json({error:'Niet gevonden'});
  res.json({ok:true});
});

// ─── Antwoorden opslaan & ophalen ─────────────────────────────────────────
app.post('/api/answers', auth, async (req,res)=>{
  const { question, zone, correct, timestamp } = req.body;
  await store.insertAnswer({
    userId:    req.user.id,
    username:  req.user.username,
    question:  question || '?',
    zone:      zone || '?',
    correct:   !!correct,
    timestamp: timestamp || new Date().toISOString()
  });
  res.json({ok:true});
});

app.get('/api/answers', auth, adminOnly, async (req,res)=>{
  res.json(await store.listAnswers());
});

app.delete('/api/answers', auth, adminOnly, async (req,res)=>{
  await store.clearAnswers();
  res.json({ok:true});
});

// ─── WebSocket: multiplayer posities ─────────────────────────────────────
const wss = new WebSocket.Server({ server });
const players = new Map(); // ws → playerInfo

wss.on('connection', (ws)=>{
  ws.on('message', (raw)=>{
    let msg;
    try { msg = JSON.parse(raw); } catch(e){ return; }

    if(msg.type==='join'){
      try {
        const user = jwt.verify(msg.token, JWT_SECRET);
        const info = { id:user.id, username:user.username, x:msg.x||0, z:msg.z||0, facing:msg.facing||Math.PI, avatar:msg.avatar||{}, ws };
        players.set(ws, info);
        const others = [];
        players.forEach((p,w)=>{ if(w!==ws) others.push({id:p.id,username:p.username,x:p.x,z:p.z,facing:p.facing,avatar:p.avatar}); });
        ws.send(JSON.stringify({type:'init', players:others}));
        broadcast(ws, {type:'playerJoin', id:user.id, username:user.username, x:info.x, z:info.z, facing:info.facing, avatar:info.avatar});
        console.log(`👤 ${user.username} connected (${players.size} online)`);
      } catch(e){ ws.send(JSON.stringify({type:'error',msg:'Ongeldig token'})); ws.close(); }
    }

    else if(msg.type==='move'){
      const p = players.get(ws);
      if(!p) return;
      p.x = msg.x; p.z = msg.z; p.facing = msg.facing;
      broadcast(ws, {type:'playerMove', id:p.id, x:p.x, z:p.z, facing:p.facing});
    }

    else if(msg.type==='score'){
      const p = players.get(ws);
      if(!p) return;
      broadcast(ws, {type:'playerScore', id:p.id, username:p.username, xp:msg.xp, coins:msg.coins});
    }
  });

  ws.on('close', ()=>{
    const p = players.get(ws);
    if(p){
      console.log(`👋 ${p.username} disconnected`);
      broadcast(ws, {type:'playerLeave', id:p.id});
      players.delete(ws);
    }
  });
});

function broadcast(senderWs, msg){
  const data = JSON.stringify(msg);
  players.forEach((_,ws)=>{
    if(ws!==senderWs && ws.readyState===WebSocket.OPEN) ws.send(data);
  });
}

// ─── Online spelers tellen ────────────────────────────────────────────────
app.get('/api/online', auth, (req,res)=>{
  const list = [];
  players.forEach(p=>list.push({id:p.id, username:p.username}));
  res.json(list);
});

async function start(){
  if(MONGODB_URI){
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db('buloschool');
    store = makeMongoStore(db.collection('users'), db.collection('answers'));
    console.log('💾 Opslag: MongoDB (permanent)');
  } else {
    store = makeFileStore();
    console.log('⚠️  Opslag: lokale bestanden (tijdelijk — gaat verloren bij herstart). Zet MONGODB_URI voor permanente opslag.');
  }
  await initUsers();

  server.listen(PORT, ()=>{
    console.log(`🏫 BuLo Sint-Franciscus server draait op http://localhost:${PORT}`);
    console.log(`📋 Admin panel: http://localhost:${PORT}/admin.html`);
    console.log(`🎮 Spel: http://localhost:${PORT}/`);
  });
}

start().catch(err=>{
  console.error('❌ Kon niet opstarten:', err.message);
  process.exit(1);
});
