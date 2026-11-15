const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { WebSocket, WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const ARENA = { width: 1600, height: 1000 };
const PLAYER_RADIUS = 18;
const PLAYER_SPEED = 260;
const BULLET_SPEED = 760;
const BULLET_DAMAGE = 34;
const FIRE_COOLDOWN = 260;
const RESPAWN_DELAY = 1200;
const COLORS = ["#55e6c1", "#ff6b8a", "#ffd166", "#7aa2ff", "#c792ea", "#ff9f43"];
const WALLS = [
  { x: 350, y: 180, width: 90, height: 270 },
  { x: 1160, y: 180, width: 90, height: 270 },
  { x: 350, y: 550, width: 90, height: 270 },
  { x: 1160, y: 550, width: 90, height: 270 },
  { x: 680, y: 330, width: 240, height: 70 },
  { x: 680, y: 600, width: 240, height: 70 },
];

const indexPath = path.join(__dirname, "index.html");
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (request.method !== "GET" || (pathname !== "/" && pathname !== "/index.html")) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  fs.readFile(indexPath, (error, content) => {
    if (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Unable to load the game.");
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 2048 });
const players = new Map();
const bullets = [];
let nextColor = 0;
let previousTick = Date.now();

function randomSpawn() {
  const points = [
    { x: 150, y: 150 }, { x: 800, y: 150 }, { x: 1450, y: 150 },
    { x: 150, y: 850 }, { x: 800, y: 850 }, { x: 1450, y: 850 },
    { x: 520, y: 500 }, { x: 1080, y: 500 },
  ];
  return points[Math.floor(Math.random() * points.length)];
}

function sanitizeName(value) {
  if (typeof value !== "string") return "Ranger";
  const name = value.replace(/[<>]/g, "").trim().slice(0, 16);
  return name || "Ranger";
}

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcast(payload) {
  const serialized = JSON.stringify(payload);
  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(serialized);
  }
}

function collidesWithWall(x, y, radius) {
  return WALLS.some((wall) =>
    x + radius > wall.x &&
    x - radius < wall.x + wall.width &&
    y + radius > wall.y &&
    y - radius < wall.y + wall.height
  );
}

function spawnPlayer(player) {
  const spawn = randomSpawn();
  player.x = spawn.x;
  player.y = spawn.y;
  player.hp = 100;
  player.respawnAt = 0;
  player.input = { up: false, down: false, left: false, right: false, shoot: false };
}

wss.on("connection", (socket) => {
  const id = crypto.randomUUID();
  const player = {
    id,
    name: "Ranger",
    color: COLORS[nextColor++ % COLORS.length],
    x: 0,
    y: 0,
    angle: 0,
    hp: 100,
    kills: 0,
    deaths: 0,
    input: { up: false, down: false, left: false, right: false, shoot: false },
    lastShot: 0,
    respawnAt: 0,
  };
  spawnPlayer(player);
  players.set(socket, player);
  send(socket, { type: "welcome", id, arena: ARENA, walls: WALLS });

  socket.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;

    if (message.type === "join") {
      player.name = sanitizeName(message.name);
      return;
    }
    if (message.type !== "input" || !message.input || typeof message.input !== "object") return;

    const input = message.input;
    for (const key of ["up", "down", "left", "right", "shoot"]) {
      player.input[key] = input[key] === true;
    }
    if (Number.isFinite(input.angle)) player.angle = input.angle;
  });

  socket.on("close", () => {
    players.delete(socket);
  });
});

function update(deltaSeconds, now) {
  for (const player of players.values()) {
    if (player.respawnAt) {
      if (now >= player.respawnAt) spawnPlayer(player);
      continue;
    }

    let dx = Number(player.input.right) - Number(player.input.left);
    let dy = Number(player.input.down) - Number(player.input.up);
    const length = Math.hypot(dx, dy) || 1;
    dx = (dx / length) * PLAYER_SPEED * deltaSeconds;
    dy = (dy / length) * PLAYER_SPEED * deltaSeconds;

    const nextX = Math.max(PLAYER_RADIUS, Math.min(ARENA.width - PLAYER_RADIUS, player.x + dx));
    if (!collidesWithWall(nextX, player.y, PLAYER_RADIUS)) player.x = nextX;
    const nextY = Math.max(PLAYER_RADIUS, Math.min(ARENA.height - PLAYER_RADIUS, player.y + dy));
    if (!collidesWithWall(player.x, nextY, PLAYER_RADIUS)) player.y = nextY;

    if (player.input.shoot && now - player.lastShot >= FIRE_COOLDOWN) {
      player.lastShot = now;
      bullets.push({
        ownerId: player.id,
        x: player.x + Math.cos(player.angle) * (PLAYER_RADIUS + 8),
        y: player.y + Math.sin(player.angle) * (PLAYER_RADIUS + 8),
        vx: Math.cos(player.angle) * BULLET_SPEED,
        vy: Math.sin(player.angle) * BULLET_SPEED,
        expiresAt: now + 1300,
      });
    }
  }

  for (let index = bullets.length - 1; index >= 0; index--) {
    const bullet = bullets[index];
    bullet.x += bullet.vx * deltaSeconds;
    bullet.y += bullet.vy * deltaSeconds;

    if (
      now >= bullet.expiresAt ||
      bullet.x < 0 || bullet.x > ARENA.width ||
      bullet.y < 0 || bullet.y > ARENA.height ||
      collidesWithWall(bullet.x, bullet.y, 3)
    ) {
      bullets.splice(index, 1);
      continue;
    }

    let hit = false;
    for (const victim of players.values()) {
      if (victim.id === bullet.ownerId || victim.respawnAt) continue;
      if (Math.hypot(victim.x - bullet.x, victim.y - bullet.y) > PLAYER_RADIUS + 3) continue;

      victim.hp -= BULLET_DAMAGE;
      hit = true;
      if (victim.hp <= 0) {
        victim.deaths++;
        const shooter = [...players.values()].find((candidate) => candidate.id === bullet.ownerId);
        if (shooter) shooter.kills++;
        victim.hp = 0;
        victim.respawnAt = now + RESPAWN_DELAY;
        broadcast({
          type: "elimination",
          killer: shooter ? shooter.name : "Unknown",
          victim: victim.name,
        });
      }
      break;
    }
    if (hit) bullets.splice(index, 1);
  }
}

setInterval(() => {
  const now = Date.now();
  const deltaSeconds = Math.min((now - previousTick) / 1000, 0.1);
  previousTick = now;
  update(deltaSeconds, now);
  broadcast({
    type: "state",
    players: [...players.values()].map(({ input, lastShot, respawnAt, ...visible }) => ({
      ...visible,
      respawning: Boolean(respawnAt),
    })),
    bullets: bullets.map(({ ownerId, x, y }) => ({ ownerId, x, y })),
  });
}, 50);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Neon Arena is running at http://localhost:${PORT}`);
});
