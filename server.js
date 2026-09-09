'use strict';
const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const path       = require('path');
const { MongoClient } = require('mongodb');

const JWT_SECRET   = 'bulo-sint-franciscus-2025-secret';
const PORT         = process.env.PORT || 3000;
const MONGODB_URI  = process.env.MONGODB_URI;

if(!MONGODB_URI){
  console.error('❌ MONGODB_URI ontbreekt. Zet deze environment variable (zie README) voor je de server start.');
  process.exit(1);
}

let usersCol, answersCol;

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

async function insertIfMissing(doc){
  const exists = await usersCol.findOne({_id:doc._id});
  if(!exists) await usersCol.insertOne(doc);
}

async function initDB(){
  await insertIfMissing({ _id:'admin', username:'admin', usernameLower:'admin',
    password:bcrypt.hashSync(ADMIN_PASSWORD,10), role:'admin', klas:'',
    avatar:defaultAvatar(), coins:0, xp:0, createdAt:new Date().toISOString() });

  const teacherHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  for(const [name, klas] of Object.entries(TEACHERS)){
    const id = 'teacher-'+name.toLowerCase();
    await insertIfMissing({ _id:id, username:name, usernameLower:name.toLowerCase(), klas,
      password:teacherHash, role:'admin', avatar:defaultAvatar(), coins:0, xp:0,
      createdAt:new Date().toISOString() });
  }

  const studentHash = bcrypt.hashSync(STUDENT_PASSWORD, 10);
  for(const [klas, names] of Object.entries(CLASSES)){
    for(const name of names){
      const id = klas.toLowerCase()+'-'+name.toLowerCase();
      await insertIfMissing({ _id:id, username:name, usernameLower:name.toLowerCase(), klas,
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
  const user = await usersCol.findOne({usernameLower: username.toLowerCase()});
  if(!user||!bcrypt.compareSync(password, user.password))
    return res.status(401).json({error:'Verkeerde gebruikersnaam of wachtwoord'});
  const token = jwt.sign({id:user._id, username:user.username, role:user.role}, JWT_SECRET, {expiresIn:'8h'});
  res.json({ token, user:{ id:user._id, username:user.username, role:user.role, avatar:user.avatar, coins:user.coins, xp:user.xp } });
});

// ─── Admin: gebruikers beheren ────────────────────────────────────────────
app.get('/api/users', auth, adminOnly, async (req,res)=>{
  const users = await usersCol.find({}).toArray();
  res.json(users.map(u=>({id:u._id,username:u.username,role:u.role,coins:u.coins,xp:u.xp,createdAt:u.createdAt})));
});

app.post('/api/users', auth, adminOnly, async (req,res)=>{
  const {username, password} = req.body;
  if(!username||!password) return res.status(400).json({error:'Gebruikersnaam en wachtwoord vereist'});
  const existing = await usersCol.findOne({usernameLower: username.toLowerCase()});
  if(existing) return res.status(400).json({error:'Gebruikersnaam bestaat al'});
  const id = username.toLowerCase().replace(/\s+/g,'-') + '-' + Date.now();
  const hash = bcrypt.hashSync(password, 10);
  await usersCol.insertOne({ _id:id, username, usernameLower:username.toLowerCase(), password:hash,
    role:'student', avatar:defaultAvatar(), coins:0, xp:0, createdAt:new Date().toISOString() });
  res.json({ok:true, id, username});
});

app.delete('/api/users/:id', auth, adminOnly, async (req,res)=>{
  if(req.params.id==='admin') return res.status(400).json({error:'Kan admin niet verwijderen'});
  await usersCol.deleteOne({_id:req.params.id});
  res.json({ok:true});
});

app.patch('/api/users/:id/password', auth, adminOnly, async (req,res)=>{
  const {password} = req.body;
  if(!password) return res.status(400).json({error:'Wachtwoord vereist'});
  const hash = bcrypt.hashSync(password, 10);
  const result = await usersCol.updateOne({_id:req.params.id}, {$set:{password:hash}});
  if(result.matchedCount===0) return res.status(404).json({error:'Gebruiker niet gevonden'});
  res.json({ok:true});
});

// ─── Progress opslaan ────────────────────────────────────────────────────
app.patch('/api/me/progress', auth, async (req,res)=>{
  const {coins, xp, avatar} = req.body;
  const set = {};
  if(coins!=null) set.coins = coins;
  if(xp!=null)    set.xp   = xp;
  if(avatar)      set.avatar = avatar;
  const result = await usersCol.updateOne({_id:req.user.id}, {$set:set});
  if(result.matchedCount===0) return res.status(404).json({error:'Niet gevonden'});
  res.json({ok:true});
});

// ─── Antwoorden opslaan & ophalen ─────────────────────────────────────────
app.post('/api/answers', auth, async (req,res)=>{
  const { question, zone, correct, timestamp } = req.body;
  await answersCol.insertOne({
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
  const answers = await answersCol.find({}).sort({timestamp:1}).toArray();
  res.json(answers.map(({_id, ...rest})=>rest));
});

app.delete('/api/answers', auth, adminOnly, async (req,res)=>{
  await answersCol.deleteMany({});
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
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('buloschool');
  usersCol = db.collection('users');
  answersCol = db.collection('answers');
  await initDB();

  server.listen(PORT, ()=>{
    console.log(`🏫 BuLo Sint-Franciscus server draait op http://localhost:${PORT}`);
    console.log(`📋 Admin panel: http://localhost:${PORT}/admin.html`);
    console.log(`🎮 Spel: http://localhost:${PORT}/`);
  });
}

start().catch(err=>{
  console.error('❌ Kon niet verbinden met de database:', err.message);
  process.exit(1);
});
