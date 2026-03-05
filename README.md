# BuLo Sint-Franciscus 3D School — Multiplayer Server

## 🚀 Snel online zetten via Render.com (gratis)

### Stap 1 — GitHub repository aanmaken
1. Ga naar https://github.com → "New repository"
2. Naam: `bulo-3d-school`
3. **Private** aanvinken (voor de veiligheid)
4. Klik "Create repository"
5. Upload alle bestanden uit deze map (of gebruik GitHub Desktop)

### Stap 2 — Deployen op Render
1. Ga naar https://render.com → Sign up (gratis, geen creditcard)
2. Klik "New +" → "Web Service"
3. Koppel je GitHub account → kies `bulo-3d-school`
4. Render detecteert automatisch de `render.yaml`
5. Klik "Create Web Service"
6. Na ~2 minuten krijg je een URL zoals: `https://bulo-3d-school.onrender.com`

### Stap 3 — Admin login
- Ga naar: `https://jouw-url.onrender.com`
- Login: **admin** / wachtwoord: **admin123**
- ⚠️ Verander het admin-wachtwoord meteen!
- Maak accounts aan voor leerlingen

### Leerlingen toevoegen
Via het admin panel (`/admin.html`):
- **Individueel**: vul naam + wachtwoord in
- **Bulk**: plak lijst in formaat `jan:wachtwoord1` (één per lijn)

## 📁 Bestandsstructuur
```
bulo-server/
├── server.js          # Backend: login, WebSocket, API
├── package.json
├── render.yaml        # Render deployment config
├── users.json         # Automatisch aangemaakt (gebruikers)
└── public/
    ├── index.html     # Loginpagina
    ├── admin.html     # Beheerpaneel
    └── game.html      # Het 3D spel
```

## 🔒 Beveiliging
- Wachtwoorden worden versleuteld opgeslagen (bcrypt)
- Sessies verlopen na 8 uur
- WebSocket-verbindingen vereisen geldig token

## ⚠️ Let op bij Render gratis tier
- Server "slaapt" na 15 minuten inactiviteit
- Eerste request na slaap duurt ~30 seconden
- Voor school gebruik: zet server wakker vóór de les (open de URL)
- Upgrade naar Starter ($7/maand) voor altijd-aan

## 🛠️ Lokaal testen
```bash
npm install
node server.js
# Open http://localhost:3000
```
