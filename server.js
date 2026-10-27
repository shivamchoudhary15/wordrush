const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 12;
const MAX_GUESSES = 6;
const INTERMISSION_MS = 8000;

// ---------- Word lists & Dictionary Loading ----------
const ANSWERS_MODULE = require('./answers.js');

const VALID_BY_LEN = {
  4: new Set(ANSWERS_MODULE.getWords(4)),
  5: new Set(ANSWERS_MODULE.getWords(5)),
  6: new Set(ANSWERS_MODULE.getWords(6)),
  7: new Set(ANSWERS_MODULE.getWords(7)),
};

try {
  const allWords = require('an-array-of-english-words');
  for (const w of allWords) {
    const l = w.length;
    if (l >= 4 && l <= 7 && /^[a-z]+$/.test(w)) {
      VALID_BY_LEN[l].add(w);
    }
  }
} catch (e) {
  console.warn('an-array-of-english-words missing; using curated words.');
}

console.log(`Loaded dictionary: ${VALID_BY_LEN[4].size} 4-letter, ${VALID_BY_LEN[5].size} 5-letter, ${VALID_BY_LEN[6].size} 6-letter, ${VALID_BY_LEN[7].size} 7-letter words.`);

// ---------- Online API Helpers (Word Fetching & Dictionary Validation) ----------
function fetchJsonWithTimeout(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'WordRush/2.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function getSecretWord(targetLen) {
  const len = targetLen >= 4 && targetLen <= 7 ? targetLen : 5;

  // Try online Random Word API or Datamuse API
  const endpoints = [
    `https://random-word-api.herokuapp.com/word?length=${len}`,
    `https://api.datamuse.com/words?sp=${'?'.repeat(len)}&max=60`
  ];

  for (const url of endpoints) {
    try {
      const data = await fetchJsonWithTimeout(url, 1500);
      if (Array.isArray(data) && data.length > 0) {
        let candidateList = [];
        if (typeof data[0] === 'string') {
          candidateList = data;
        } else if (data[0] && typeof data[0].word === 'string') {
          candidateList = data.map(x => x.word);
        }
        const validCandidates = candidateList
          .map(w => w.toLowerCase().trim())
          .filter(w => new RegExp(`^[a-z]{${len}}$`).test(w) && (VALID_BY_LEN[len]?.has(w) || ANSWERS_MODULE.getWords(len).includes(w)));

        if (validCandidates.length > 0) {
          const chosen = validCandidates[crypto.randomInt(validCandidates.length)];
          console.log(`[API] Fetched secret word: ${chosen} (${len} letters)`);
          return chosen;
        }
      }
    } catch (e) {}
  }

  // Fallback to high-frequency curated words
  const pool = ANSWERS_MODULE.getWords(len);
  return pool[crypto.randomInt(pool.length)];
}

async function getWordDefinition(word) {
  try {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const data = await fetchJsonWithTimeout(url, 2000);
    if (Array.isArray(data) && data.length > 0) {
      const entry = data[0];
      const meaning = entry.meanings?.[0];
      const phonetics = entry.phonetic || entry.phonetics?.[0]?.text || '';
      if (meaning) {
        const pos = meaning.partOfSpeech || 'noun';
        const def = meaning.definitions?.[0]?.definition || '';
        const example = meaning.definitions?.[0]?.example || '';
        return {
          word,
          pos,
          phonetics,
          definition: def,
          example,
        };
      }
    }
  } catch (e) {}
  return null;
}

async function isValidGuess(word, len) {
  if (typeof word !== 'string' || word.length !== len || !/^[a-z]+$/.test(word)) return false;

  // 1. Instant local check (covers 73,000+ words)
  if (VALID_BY_LEN[len] && VALID_BY_LEN[len].has(word)) return true;

  // 2. Check Free Dictionary API online
  try {
    const dictUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const data = await fetchJsonWithTimeout(dictUrl, 1200);
    if (Array.isArray(data) && data.length > 0 && data[0].word) {
      if (VALID_BY_LEN[len]) VALID_BY_LEN[len].add(word);
      return true;
    }
  } catch (e) {}

  // 3. Check Datamuse API online
  try {
    const dmUrl = `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&max=1`;
    const dmData = await fetchJsonWithTimeout(dmUrl, 1200);
    if (Array.isArray(dmData) && dmData.length > 0 && dmData[0].word.toLowerCase() === word) {
      if (VALID_BY_LEN[len]) VALID_BY_LEN[len].add(word);
      return true;
    }
  } catch (e) {}

  return false;
}

// ---------- Static File Server ----------
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const parsed = req.url.split('?')[0];
  let safePath = path.normalize(parsed).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '') safePath = '/index.html';
  const filePath = path.join(__dirname, 'public', safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
});

const wss = new WebSocketServer({ server });

// ---------- Game Logic ----------
const rooms = new Map();

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function scorePattern(guess, answer) {
  const len = answer.length;
  const res = Array(len).fill('b');
  const counts = {};
  for (let i = 0; i < len; i++) {
    if (guess[i] === answer[i]) res[i] = 'g';
    else counts[answer[i]] = (counts[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < len; i++) {
    if (res[i] !== 'g' && counts[guess[i]] > 0) {
      res[i] = 'y';
      counts[guess[i]]--;
    }
  }
  return res.join('');
}

function validateHardMode(prevGuesses, nextWord, len) {
  for (const prev of prevGuesses) {
    for (let i = 0; i < len; i++) {
      if (prev.pattern[i] === 'g' && nextWord[i] !== prev.word[i]) {
        return `Letter #${i + 1} must be '${prev.word[i].toUpperCase()}'`;
      }
    }
    for (let i = 0; i < len; i++) {
      if (prev.pattern[i] === 'y' && !nextWord.includes(prev.word[i])) {
        return `Guess must contain '${prev.word[i].toUpperCase()}'`;
      }
    }
  }
  return null;
}

function cleanAvatar(av) {
  const colors = ['#f6c343','#4fa8f6','#f472b6','#4ade80','#fb923c','#a855f7','#f87171','#2dd4bf','#818cf8','#f59e0b','#e879f9','#10b981'];
  const eyes = ['normal','happy','wink','cool','hearts','shock','angry','derp','sleepy'];
  const mouths = ['smile','grin','tongue','laugh','straight','sad','surprised'];
  const hats = ['none','crown','party','beanie','cowboy','halo','headphones','flower','glasses'];

  if (!av || typeof av !== 'object') {
    return { color: colors[0], eyes: 'normal', mouth: 'smile', hat: 'none' };
  }
  return {
    color: colors.includes(av.color) ? av.color : colors[0],
    eyes: eyes.includes(av.eyes) ? av.eyes : 'normal',
    mouth: mouths.includes(av.mouth) ? av.mouth : 'smile',
    hat: hats.includes(av.hat) ? av.hat : 'none',
  };
}

function createRoom(isPublic = false) {
  const room = {
    code: makeCode(),
    hostId: null,
    players: new Map(),
    phase: 'lobby',
    settings: {
      rounds: 3,
      time: 120,
      wordLength: 5, // 4, 5, 6, 7, or 'random'
      isPublic,
      hardMode: false,
      sharedIntel: true,
      enableHints: true,
      maxPlayers: MAX_PLAYERS,
      customWords: []
    },
    round: 0,
    word: null,
    wordLength: 5,
    clue: null,
    endsAt: 0,
    nextAt: 0,
    timer: null,
    used: new Set(),
    discoveredSpots: [null, null, null, null, null],
    knownLetters: new Map(),
  };
  rooms.set(room.code, room);
  return room;
}

function cleanName(name) {
  const n = String(name || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16);
  return n || 'Player' + crypto.randomInt(100, 999);
}

function addPlayer(room, ws, name, avatar) {
  let finalName = cleanName(name);
  const names = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  let base = finalName, i = 2;
  while (names.has(finalName.toLowerCase())) finalName = `${base.slice(0, 13)}${i++}`;

  const p = {
    id: crypto.randomUUID().slice(0, 8),
    name: finalName,
    avatar: cleanAvatar(avatar),
    ws,
    score: 0,
    guesses: [],
    solved: false,
    done: room.phase === 'playing' || room.phase === 'roundEnd',
    typingLen: 0,
    roundPoints: 0,
    connected: true,
  };
  room.players.set(p.id, p);
  if (!room.hostId) room.hostId = p.id;
  ws.playerId = p.id;
  ws.roomCode = room.code;
  return p;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function msLeft(room) {
  if (room.phase === 'playing') return Math.max(0, room.endsAt - Date.now());
  if (room.phase === 'roundEnd') return Math.max(0, room.nextAt - Date.now());
  return 0;
}

function viewFor(room, p) {
  const reveal = room.phase === 'roundEnd' || room.phase === 'over';
  const sharedIntel = room.settings.sharedIntel !== false;
  const len = room.wordLength || (room.word ? room.word.length : 5);

  return {
    type: 'state',
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    wordLength: len,
    clue: room.clue || null,
    settings: room.settings,
    msLeft: msLeft(room),
    you: p.id,
    word: reveal ? room.word : null,
    me: p.guesses,
    discoveredSpots: room.discoveredSpots || Array(len).fill(null),
    knownLetters: [...(room.knownLetters ? room.knownLetters.values() : [])],
    players: [...room.players.values()].map((q) => ({
      id: q.id,
      name: q.name,
      avatar: q.avatar,
      score: q.score,
      connected: q.connected,
      solved: q.solved,
      done: q.done,
      typingLen: q.typingLen || 0,
      roundPoints: q.roundPoints,
      patterns: q.guesses.map((g) => g.pattern),
      guessIntel: q.guesses.map((g) => ({
        pattern: g.pattern,
        letters: (reveal || sharedIntel)
          ? g.word.split('').map((ch, idx) => {
              if (reveal) return ch.toUpperCase();
              if (g.pattern[idx] === 'g' || g.pattern[idx] === 'y') return ch.toUpperCase();
              return null;
            })
          : null,
        fullWord: reveal ? g.word : null,
      })),
      words: reveal ? q.guesses.map((g) => g.word) : null,
    })),
  };
}

function broadcast(room) {
  for (const p of room.players.values()) if (p.connected) send(p.ws, viewFor(room, p));
}

function say(room, text, name = null) {
  for (const p of room.players.values()) {
    if (!p.connected) continue;
    send(p.ws, { type: 'chat', name, text, system: !name });
  }
}

async function startRound(room) {
  clearTimeout(room.timer);

  // Determine round word length
  let len = 5;
  if (room.settings.wordLength === 'random') {
    const lengths = [4, 5, 6, 7];
    len = lengths[crypto.randomInt(lengths.length)];
  } else {
    len = parseInt(room.settings.wordLength) || 5;
    if (len < 4 || len > 7) len = 5;
  }

  // Check if host supplied custom words
  if (room.settings.customWords && room.settings.customWords.length > 0) {
    const unused = room.settings.customWords.filter(w => !room.used.has(w));
    const pool = unused.length > 0 ? unused : room.settings.customWords;
    room.word = pool[crypto.randomInt(pool.length)];
    len = room.word.length;
  } else {
    // Fetch secret word via API or curated pool
    room.word = await getSecretWord(len);
  }

  room.wordLength = len;
  room.used.add(room.word);
  room.round += 1;
  room.phase = 'playing';
  room.endsAt = Date.now() + room.settings.time * 1000;
  room.discoveredSpots = Array(len).fill(null);
  room.knownLetters = new Map();
  room.clue = null;

  // Asynchronously fetch dictionary definition clue
  getWordDefinition(room.word).then(defObj => {
    if (defObj && defObj.definition) {
      const masked = defObj.definition.replace(new RegExp(room.word, 'gi'), '_____');
      room.clue = {
        pos: defObj.pos,
        phonetics: defObj.phonetics,
        definition: masked,
        example: defObj.example ? defObj.example.replace(new RegExp(room.word, 'gi'), '_____') : ''
      };
      broadcast(room);
    }
  });

  for (const p of room.players.values()) {
    p.guesses = [];
    p.solved = false;
    p.roundPoints = 0;
    p.typingLen = 0;
    p.done = !p.connected;
  }

  room.timer = setTimeout(() => endRound(room), room.settings.time * 1000);
  say(room, `Round ${room.round} of ${room.settings.rounds} — crack the ${len}-letter word!`);
  broadcast(room);
}

function endRound(room) {
  if (room.phase !== 'playing') return;
  clearTimeout(room.timer);
  for (const p of room.players.values()) p.done = true;
  const last = room.round >= room.settings.rounds;
  room.phase = last ? 'over' : 'roundEnd';
  say(room, `The word was ${room.word.toUpperCase()}.`);
  if (last) {
    room.nextAt = 0;
  } else {
    room.nextAt = Date.now() + INTERMISSION_MS;
    room.timer = setTimeout(() => startRound(room), INTERMISSION_MS);
  }
  broadcast(room);
}

function checkAllDone(room) {
  if (room.phase !== 'playing') return;
  const active = [...room.players.values()].filter((p) => p.connected);
  if (active.length && active.every((p) => p.done)) endRound(room);
}

async function handleGuess(room, p, raw) {
  if (room.phase !== 'playing' || p.done) return;
  const word = String(raw || '').toLowerCase().trim();
  const len = room.wordLength || 5;

  if (word.length !== len || !/^[a-z]+$/.test(word)) {
    return send(p.ws, { type: 'invalid', msg: `Needs ${len} letters` });
  }

  const valid = await isValidGuess(word, len);
  if (!valid) {
    return send(p.ws, { type: 'invalid', msg: 'Not in dictionary' });
  }

  if (room.settings.hardMode && p.guesses.length > 0) {
    const hardError = validateHardMode(p.guesses, word, len);
    if (hardError) return send(p.ws, { type: 'invalid', msg: hardError });
  }

  const pattern = scorePattern(word, room.word);
  p.guesses.push({ word, pattern });
  p.typingLen = 0;

  // Track shared discoveries
  const newSpots = [];
  const newYellows = [];

  if (room.settings.sharedIntel !== false) {
    for (let i = 0; i < len; i++) {
      const ch = word[i].toUpperCase();
      if (pattern[i] === 'g') {
        if (!room.discoveredSpots[i]) {
          const spotInfo = {
            pos: i,
            letter: ch,
            finderId: p.id,
            finderName: p.name,
            finderAvatar: p.avatar,
          };
          room.discoveredSpots[i] = spotInfo;
          newSpots.push(spotInfo);
        }
      } else if (pattern[i] === 'y') {
        if (!room.knownLetters.has(ch)) {
          const letInfo = {
            letter: ch,
            finderId: p.id,
            finderName: p.name,
            finderAvatar: p.avatar,
          };
          room.knownLetters.set(ch, letInfo);
          newYellows.push(letInfo);
        }
      }
    }
  }

  // Award scout bonus points for first-time discoveries
  let scoutBonus = 0;
  if (newSpots.length > 0) scoutBonus += newSpots.length * 25;
  if (newYellows.length > 0) scoutBonus += newYellows.length * 10;

  if (pattern === 'g'.repeat(len)) {
    const attempts = p.guesses.length;
    const timeBonus = Math.round((msLeft(room) / (room.settings.time * 1000)) * 100);
    p.roundPoints = 100 + (MAX_GUESSES - attempts) * 40 + timeBonus + scoutBonus;
    p.score += p.roundPoints;
    p.solved = true;
    p.done = true;
    say(room, `🎉 ${p.name} solved it in ${attempts} ${attempts === 1 ? 'guess' : 'guesses'}! (+${p.roundPoints})`);
  } else {
    if (scoutBonus > 0) {
      p.score += scoutBonus;
      p.roundPoints += scoutBonus;
    }

    // Announcements
    for (const s of newSpots) {
      say(room, `🎯 ${p.name} placed letter #${s.pos + 1}: '${s.letter}'! (+25 scout pts)`);
    }
    for (const y of newYellows) {
      say(room, `💡 ${p.name} found that '${y.letter}' is in the word! (+10 scout pts)`);
    }

    // Check if player is close
    const greenCount = (pattern.match(/g/g) || []).length;
    const yellowCount = (pattern.match(/y/g) || []).length;
    const totalMatches = greenCount + yellowCount;

    if (greenCount >= len - 1) {
      send(p.ws, { type: 'close', msg: `🔥 So close! ${greenCount} letters in exact spots!` });
      say(room, `💡 ${p.name} is super close!`);
    } else if (totalMatches >= len - 1) {
      send(p.ws, { type: 'close', msg: `🔥 ${totalMatches} letters matched!` });
      say(room, `💡 ${p.name} is close!`);
    }

    if (p.guesses.length >= MAX_GUESSES) {
      p.done = true;
      say(room, `${p.name} ran out of guesses.`);
    }
  }

  broadcast(room);
  checkAllDone(room);
}

function removePlayer(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const p = room.players.get(ws.playerId);
  if (!p) return;
  p.connected = false;
  if (room.phase === 'lobby') room.players.delete(p.id);
  else p.done = true;

  const connected = [...room.players.values()].filter((q) => q.connected);
  if (!connected.length) {
    clearTimeout(room.timer);
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === p.id) {
    room.hostId = connected[0].id;
    say(room, `${connected[0].name} is now the host.`);
  }
  say(room, `${p.name} left.`);
  broadcast(room);
  checkAllDone(room);
}

function joinRoom(ws, room, name, avatar) {
  const max = room.settings.maxPlayers || MAX_PLAYERS;
  const activeCount = [...room.players.values()].filter((p) => p.connected).length;
  if (activeCount >= max) return send(ws, { type: 'error', msg: 'Room is full' });
  const p = addPlayer(room, ws, name, avatar);
  say(room, `${p.name} joined.`);
  broadcast(room);
}

function getPublicRooms() {
  const list = [];
  for (const r of rooms.values()) {
    if (!r.settings.isPublic || r.phase === 'over') continue;
    const host = r.players.get(r.hostId);
    const activeCount = [...r.players.values()].filter((p) => p.connected).length;
    if (activeCount === 0) continue;
    list.push({
      code: r.code,
      hostName: host ? host.name : 'Unknown',
      hostAvatar: host ? host.avatar : null,
      playerCount: activeCount,
      maxPlayers: r.settings.maxPlayers || MAX_PLAYERS,
      round: r.round,
      rounds: r.settings.rounds,
      wordLength: r.settings.wordLength || 5,
      phase: r.phase,
      hardMode: !!r.settings.hardMode,
      sharedIntel: r.settings.sharedIntel !== false,
    });
  }
  return list;
}

// ---------- WebSocket handling ----------
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    const room = rooms.get(ws.roomCode);
    const player = room && room.players.get(ws.playerId);

    switch (msg.type) {
      case 'create': {
        if (room) removePlayer(ws);
        const r = createRoom(false);
        joinRoom(ws, r, msg.name, msg.avatar);
        break;
      }
      case 'join': {
        if (room) removePlayer(ws);
        const code = String(msg.code || '').toUpperCase().trim();
        const r = rooms.get(code);
        if (!r) return send(ws, { type: 'error', msg: 'Room not found' });
        joinRoom(ws, r, msg.name, msg.avatar);
        break;
      }
      case 'quick': {
        if (room) removePlayer(ws);
        let r = [...rooms.values()].find(
          (x) => x.settings.isPublic && x.phase === 'lobby' && x.players.size < (x.settings.maxPlayers || MAX_PLAYERS)
        );
        if (!r) {
          r = [...rooms.values()].find(
            (x) => x.settings.isPublic && x.phase !== 'over' && x.players.size < (x.settings.maxPlayers || MAX_PLAYERS)
          );
        }
        if (!r) r = createRoom(true);
        joinRoom(ws, r, msg.name, msg.avatar);
        break;
      }
      case 'listRooms': {
        send(ws, { type: 'roomList', rooms: getPublicRooms() });
        break;
      }
      case 'leave': {
        if (room) {
          removePlayer(ws);
          ws.roomCode = null;
          ws.playerId = null;
        }
        send(ws, { type: 'left' });
        break;
      }
      case 'typing': {
        if (!room || !player || room.phase !== 'playing' || player.done) return;
        const maxLen = room.wordLength || 5;
        const len = Math.max(0, Math.min(maxLen, parseInt(msg.len) || 0));
        player.typingLen = len;
        for (const q of room.players.values()) {
          if (q.connected && q.id !== player.id) {
            send(q.ws, { type: 'typing', id: player.id, len });
          }
        }
        break;
      }
      case 'reaction': {
        if (!room || !player) return;
        const emoji = String(msg.emoji || '').slice(0, 4);
        if (!emoji) return;
        for (const q of room.players.values()) {
          if (q.connected) send(q.ws, { type: 'reaction', id: player.id, name: player.name, emoji });
        }
        break;
      }
      case 'settings': {
        if (!room || room.phase !== 'lobby' || room.hostId !== player.id) return;
        const rounds = Math.min(10, Math.max(1, parseInt(msg.rounds) || 3));
        const time = Math.min(300, Math.max(30, parseInt(msg.time) || 120));
        const maxPlayers = Math.min(20, Math.max(2, parseInt(msg.maxPlayers) || 12));
        const hardMode = !!msg.hardMode;
        const sharedIntel = msg.sharedIntel !== false;
        const enableHints = msg.enableHints !== false;

        let wordLength = msg.wordLength === 'random' ? 'random' : (parseInt(msg.wordLength) || 5);
        if (wordLength !== 'random' && (wordLength < 4 || wordLength > 7)) wordLength = 5;

        let customWords = [];
        if (Array.isArray(msg.customWords)) {
          customWords = msg.customWords
            .map((w) => String(w || '').toLowerCase().trim())
            .filter((w) => /^[a-z]{4,7}$/.test(w));
        }
        room.settings = {
          rounds,
          time,
          wordLength,
          isPublic: !!msg.isPublic,
          hardMode,
          sharedIntel,
          enableHints,
          maxPlayers,
          customWords: [...new Set(customWords)],
        };
        broadcast(room);
        break;
      }
      case 'start': {
        if (!room || room.hostId !== player.id) return;
        if (room.phase !== 'lobby') return;
        room.round = 0;
        room.used.clear();
        for (const p of room.players.values()) p.score = 0;
        await startRound(room);
        break;
      }
      case 'again': {
        if (!room || room.hostId !== player.id || room.phase !== 'over') return;
        room.phase = 'lobby';
        room.round = 0;
        room.word = null;
        room.clue = null;
        room.discoveredSpots = [null, null, null, null, null];
        room.knownLetters = new Map();
        for (const [id, p] of room.players) {
          if (!p.connected) room.players.delete(id);
          else { p.guesses = []; p.done = false; p.solved = false; p.roundPoints = 0; p.score = 0; p.typingLen = 0; }
        }
        say(room, 'Back in the lobby.');
        broadcast(room);
        break;
      }
      case 'guess': {
        if (!room || !player) return;
        await handleGuess(room, player, msg.word);
        break;
      }
      case 'chat': {
        if (!room || !player) return;
        let text = String(msg.text || '').trim().slice(0, 200);
        if (!text) return;

        // Anti-spoiler censoring while round is active
        if (room.phase === 'playing' && room.word) {
          const secret = room.word.toLowerCase();
          const cleanText = text.toLowerCase().replace(/[^a-z]/g, '');

          // If the player hasn't solved yet and accidentally typed the secret word into chat
          if (!player.solved && cleanText === secret) {
            await handleGuess(room, player, secret);
            send(ws, { type: 'chat', text: '💡 (Submitted your secret word guess from chat!)', system: true });
            return;
          }

          // Censor any occurrences of the secret word (including spaced-out or hyphenated variants)
          const maskStr = '*'.repeat(secret.length);
          const spoilerRegex = new RegExp(secret.split('').join('[\\s\\-_.]*'), 'gi');
          if (spoilerRegex.test(text)) {
            text = text.replace(spoilerRegex, maskStr);
            send(ws, { type: 'chat', text: '⚠️ Secret word was masked to prevent spoilers in chat.', system: true });
          }
        }

        say(room, text, player.name);
        break;
      }
    }
  });

  ws.on('close', () => removePlayer(ws));
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log(`WordRush running at http://localhost:${PORT}`));
