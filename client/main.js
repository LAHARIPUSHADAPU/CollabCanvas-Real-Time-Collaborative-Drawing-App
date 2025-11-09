import { initCanvas } from './canvas.js';
import { initNetwork } from './network.js';

// Pick room from URL (?room=xyz)
const params = new URLSearchParams(window.location.search);
const roomId = params.get('room') || 'main';
document.getElementById('room-name').textContent = `CollabCanvas — ${roomId}`;
document.title = `CollabCanvas — ${roomId}`;

// Generate a friendly user
const user = (()=> {
  const id = crypto.randomUUID();
  const animals = ['Fox','Panda','Otter','Lynx','Koala','Hawk','Koi','Swan','Seal','Lark'];
  const name = 'User-' + animals[Math.floor(Math.random()*animals.length)] + '-' + Math.floor(Math.random()*1000);
  const color = document.getElementById('color').value;
  return { id, name, color };
})();

const ui = {
  brushBtn: document.getElementById('tool-brush'),
  eraserBtn: document.getElementById('tool-eraser'),
  lineBtn: document.getElementById('tool-line'),
  rectBtn: document.getElementById('tool-rect'),
  circleBtn: document.getElementById('tool-circle'),
  textBtn: document.getElementById('tool-text'),
  imageBtn: document.getElementById('tool-image'),
  imageInput: document.getElementById('imageInput'),

  color: document.getElementById('color'),
  size: document.getElementById('size'),
  sizeVal: document.getElementById('size-val'),

  undo: document.getElementById('undo'),
  redo: document.getElementById('redo'),
  clear: document.getElementById('clear'),

  exportPng: document.getElementById('export-png'),
  exportJson: document.getElementById('export-json'),
  importJson: document.getElementById('import-json'),

  userList: document.getElementById('user-list'),
  transport: document.getElementById('transport'),
  latency: document.getElementById('latency'),
  fps: document.getElementById('fps'),
  metrics: document.getElementById('metrics'),
};

const net = await initNetwork(user, (evt)=> canvas.handleRemoteEvent(evt));
ui.transport.textContent = net.name;
ui.transport.classList.toggle('badge', true);

// Join room on the wire
net.send('join', { roomId });

const canvas = initCanvas({
  canvas: document.getElementById('canvas'),
  cursorLayer: document.getElementById('cursor-layer'),
  user,
  network: net,
  ui,
  roomId,
  onLatency: (ms)=> {
    const text = (ms>=0? ms.toFixed(0): '—') + ' ms';
    ui.latency.textContent = text;
    ui.metrics.textContent = `${ui.fps.textContent.replace(' fps','')} fps • ${text}`;
  },
  onFps: (fps)=> {
    const text = fps>0? fps.toFixed(0) + ' fps' : '— fps';
    ui.fps.textContent = text;
    ui.metrics.textContent = `${text} • ${ui.latency.textContent}`;
  }
});

// Presence
canvas.upsertUser(user);
