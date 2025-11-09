# CollabCanvas — Realtime Whiteboard (Rooms • Persistence • Shapes)

Vanilla JS + Node WebSocket collaborative whiteboard with rooms, persistence, FPS/latency metrics, shapes, text, and images.

## Features
- Rooms via `?room=design`
- Server-side persistence per room (JSON files in `/data`)
- Brush, Eraser, Line, Rect, Circle, Text, Image
- Global Undo/Redo, Clear
- Export PNG, Export/Import JSON
- FPS + latency badges
- BroadcastChannel fallback (open 2 tabs without server)

## Run
```bash
npm install
npm start
# open http://localhost:3000/?room=main
