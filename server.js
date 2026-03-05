'use strict';
const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const path       = require('path');
const fs         = require('fs');

const JWT_SECRET = 'bulo-sint-franciscus-2025-secret';
const PORT       = process.env.PORT || 3000;
const DB_FILE    = path.join(__dirname, 'users.json');

// ─── Simple JSON "database" ───────────────────────────────────────────────
function loadDB(){
  if(!fs.existsSync(DB_FILE)) return { users: [] };
  try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); } catch(e){ return {users:[]}; }
}
function saveDB(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }

// Maak default admin-account als nog geen users bestaan
(function initDB(){
  const db = loadDB();
  if(!db.users.find(u=>u.username==='admin')){
    const hash = bcrypt.hashSync('admin123', 10);
    db.users.push({ id:'admin', username:'admin', password:hash, role:'admin', avatar:{shirt:0xe8231a,pants:0x2a3a6a,shoes:0x1a1a1a,pet:null}, coins:0, xp:0, createdAt: new Date().toISOString() });
    saveDB(db);
    console.log('✅ Admin aangemaakt: gebruiker=admin wachtwoord=admin123');
  }
})();

// ─── Express app ─────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// ─── Auth routes ─────────────────────────────────────────────────────────
app.post('/api/login', (req,res)=>{
  const {username, password} = req.body;
  if(!username||!password) return res.status(400).json({error:'Vul gebruikersnaam en wachtwoord in'});
  const db = loadDB();
  const user = db.users.find(u=>u.username.toLowerCase()===username.toLowerCase());
  if(!user||!bcrypt.compareSync(password, user.password))
    return res.status(401).json({error:'Verkeerde gebruikersnaam of wachtwoord'});
  const token = jwt.sign({id:user.id, username:user.username, role:user.role}, JWT_SECRET, {expiresIn:'8h'});
  res.json({ token, user:{ id:user.id, username:user.username, role:user.role, avatar:user.avatar, coins:user.coins, xp:user.xp } });
});

// ─── Admin: gebruikers beheren ────────────────────────────────────────────
app.get('/api/users', auth, adminOnly, (req,res)=>{
  const db = loadDB();
  res.json(db.users.map(u=>({id:u.id,username:u.username,role:u.role,coins:u.coins,xp:u.xp,createdAt:u.createdAt})));
});

app.post('/api/users', auth, adminOnly, (req,res)=>{
  const {username, password} = req.body;
  if(!username||!password) return res.status(400).json({error:'Gebruikersnaam en wachtwoord vereist'});
  const db = loadDB();
  if(db.users.find(u=>u.username.toLowerCase()===username.toLowerCase()))
    return res.status(400).json({error:'Gebruikersnaam bestaat al'});
  const id = username.toLowerCase().replace(/\s+/g,'-') + '-' + Date.now();
  const hash = bcrypt.hashSync(password, 10);
  db.users.push({ id, username, password:hash, role:'student', avatar:{shirt:0xe8231a,pants:0x2a3a6a,shoes:0x1a1a1a,pet:null}, coins:0, xp:0, createdAt:new Date().toISOString() });
  saveDB(db);
  res.json({ok:true, id, username});
});

app.delete('/api/users/:id', auth, adminOnly, (req,res)=>{
  if(req.params.id==='admin') return res.status(400).json({error:'Kan admin niet verwijderen'});
  const db = loadDB();
  db.users = db.users.filter(u=>u.id!==req.params.id);
  saveDB(db);
  res.json({ok:true});
});

app.patch('/api/users/:id/password', auth, adminOnly, (req,res)=>{
  const {password} = req.body;
  if(!password) return res.status(400).json({error:'Wachtwoord vereist'});
  const db = loadDB();
  const user = db.users.find(u=>u.id===req.params.id);
  if(!user) return res.status(404).json({error:'Gebruiker niet gevonden'});
  user.password = bcrypt.hashSync(password, 10);
  saveDB(db);
  res.json({ok:true});
});

// ─── Progress opslaan ────────────────────────────────────────────────────
app.patch('/api/me/progress', auth, (req,res)=>{
  const {coins, xp, avatar} = req.body;
  const db = loadDB();
  const user = db.users.find(u=>u.id===req.user.id);
  if(!user) return res.status(404).json({error:'Niet gevonden'});
  if(coins!=null) user.coins = coins;
  if(xp!=null)    user.xp   = xp;
  if(avatar)      user.avatar = avatar;
  saveDB(db);
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
      // Verifieer token
      try {
        const user = jwt.verify(msg.token, JWT_SECRET);
        const info = { id:user.id, username:user.username, x:msg.x||0, z:msg.z||0, facing:msg.facing||Math.PI, avatar:msg.avatar||{}, ws };
        players.set(ws, info);
        // Stuur huidige spelers naar nieuwkomer
        const others = [];
        players.forEach((p,w)=>{ if(w!==ws) others.push({id:p.id,username:p.username,x:p.x,z:p.z,facing:p.facing,avatar:p.avatar}); });
        ws.send(JSON.stringify({type:'init', players:others}));
        // Vertel anderen dat nieuwe speler joined
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

server.listen(PORT, ()=>{
  console.log(`🏫 BuLo Sint-Franciscus server draait op http://localhost:${PORT}`);
  console.log(`📋 Admin panel: http://localhost:${PORT}/admin.html`);
  console.log(`🎮 Spel: http://localhost:${PORT}/`);
});
