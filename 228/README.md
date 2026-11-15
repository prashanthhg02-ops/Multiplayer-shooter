# Neon Arena

A small, server-authoritative multiplayer arena shooter that runs in a browser. Players move around an arena, use cover, and fire at one another in real time.

## Run locally

1. Install [Node.js](https://nodejs.org/) 18 or newer.
2. From this folder, run `npm install`.
3. Run `npm start`.
4. Open [http://localhost:3000](http://localhost:3000). Open another browser tab or device on the same network to join the same match.

Set the `PORT` environment variable to use a different port. The game server listens on all network interfaces; allow the selected port through your firewall if other devices need to connect.

## Controls

- **WASD** or **arrow keys** to move.
- **Mouse** to aim.
- **Hold the left mouse button** to fire.

Movement, shots, hit detection, score, and respawning are handled by the server.
