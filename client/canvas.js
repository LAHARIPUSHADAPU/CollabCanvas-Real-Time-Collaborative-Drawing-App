// Drawing + history + cursors + shapes/text/image + persistence hooks

export function initCanvas({ canvas, cursorLayer, user, network, ui, roomId, onLatency, onFps }){
  const ctx = canvas.getContext('2d');
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d');

  const state = {
    tool: 'brush',         // brush | eraser | line | rect | circle | text | image
    color: ui.color.value,
    size: Number(ui.size.value),
    drawing: false,
    strokeId: null,
    startPoint: null,      // for shapes/line/text anchor
    points: [],            // current freehand stroke points [{x,y,size}]
    history: [],           // list of ops
    undone: [],
    users: new Map(),
    cursors: new Map(),
  };

  // ---------- UI wiring ----------
  const toggleGroup = [ui.brushBtn, ui.eraserBtn, ui.lineBtn, ui.rectBtn, ui.circleBtn, ui.textBtn];
  function setTool(t){
    state.tool = t;
    toggleGroup.forEach(btn => btn.classList.toggle('active', btn && btn.id === `tool-${t}`));
    toggleGroup.forEach(btn => btn && btn.setAttribute('aria-pressed', String(btn.classList.contains('active'))));
  }
  ui.brushBtn.onclick = ()=> setTool('brush');
  ui.eraserBtn.onclick = ()=> setTool('eraser');
  ui.lineBtn.onclick = ()=> setTool('line');
  ui.rectBtn.onclick = ()=> setTool('rect');
  ui.circleBtn.onclick = ()=> setTool('circle');
  ui.textBtn.onclick = ()=> setTool('text');
  ui.imageBtn.onclick = ()=> ui.imageInput.click();

  ui.color.oninput = (e)=> { state.color = e.target.value; user.color = state.color; };
  ui.size.oninput = (e)=> { state.size = Number(e.target.value); ui.sizeVal.textContent = String(state.size); };
  ui.sizeVal.textContent = String(state.size);

  ui.undo.onclick = undo;
  ui.redo.onclick = redo;
  ui.clear.onclick = clearAll;

  ui.exportPng.onclick = exportPNG;
  ui.exportJson.onclick = exportJSON;
  ui.importJson.onchange = importJSON;

  window.addEventListener('keydown',(e)=>{
    const k = e.key.toLowerCase();
    if ((e.ctrlKey||e.metaKey) && k==='z'){ e.preventDefault(); undo(); }
    if ((e.ctrlKey||e.metaKey) && k==='y'){ e.preventDefault(); redo(); }
    if (k==='b') setTool('brush');
    if (k==='e') setTool('eraser');
    if (k==='l') setTool('line');
    if (k==='r') setTool('rect');
    if (k==='c') setTool('circle');
    if (k==='t') setTool('text');
  });

  // ---------- HiDPI resize ----------
  function resize(){
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    off.width = canvas.width; off.height = canvas.height;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    offCtx.setTransform(dpr,0,0,dpr,0,0);
    rebuild();
  }
  window.addEventListener('resize', resize);
  requestAnimationFrame(resize);

  // ---------- Rendering ----------
  function strokeTo(ctx2d, path, style){
    if (!path || path.length === 0) return;
    ctx2d.lineCap = ctx2d.lineJoin = 'round';
    ctx2d.lineWidth = style.size;
    if (style.tool === 'eraser'){ ctx2d.globalCompositeOperation = 'destination-out'; ctx2d.strokeStyle = '#000'; }
    else { ctx2d.globalCompositeOperation = 'source-over'; ctx2d.strokeStyle = style.color; }

    ctx2d.beginPath();
    const pts = path;
    if (pts.length < 3){
      ctx2d.moveTo(pts[0].x, pts[0].y);
      for (let i=1;i<pts.length;i++) ctx2d.lineTo(pts[i].x, pts[i].y);
      ctx2d.stroke();
      ctx2d.globalCompositeOperation = 'source-over';
      return;
    }
    ctx2d.moveTo(pts[0].x, pts[0].y);
    for (let i=1; i<pts.length-2; i++){
      const p0=pts[i-1], p1=pts[i], p2=pts[i+1], p3=pts[i+2];
      const cp1x = p1.x + (p2.x - p0.x)/6, cp1y = p1.y + (p2.y - p0.y)/6;
      const cp2x = p2.x - (p3.x - p1.x)/6, cp2y = p2.y - (p3.y - p1.y)/6;
      ctx2d.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx2d.stroke();
    ctx2d.globalCompositeOperation = 'source-over';
  }

  function drawShape(ctx2d, op){
    const { tool, color, size } = op;
    ctx2d.lineWidth = size;
    ctx2d.strokeStyle = color;
    ctx2d.fillStyle = color;
    ctx2d.globalCompositeOperation = 'source-over';

    if (tool === 'line'){
      const { x1,y1,x2,y2 } = op;
      ctx2d.beginPath(); ctx2d.moveTo(x1,y1); ctx2d.lineTo(x2,y2); ctx2d.stroke();
    } else if (tool === 'rect'){
      const { x, y, w, h } = op;
      ctx2d.strokeRect(x, y, w, h);
    } else if (tool === 'circle'){
      const { cx, cy, r } = op;
      ctx2d.beginPath(); ctx2d.arc(cx, cy, r, 0, Math.PI*2); ctx2d.stroke();
    } else if (tool === 'text'){
      const { x, y, text } = op;
      ctx2d.font = `${Math.max(12, size*3)}px system-ui, Arial`;
      ctx2d.fillText(text, x, y);
    } else if (tool === 'image'){
      // image op stores a dataURL
      const { x, y, w, h, src } = op;
      const img = new Image();
      img.onload = ()=> ctx2d.drawImage(img, x, y, w, h);
      img.src = src;
    }
  }

  function commit(op){
    state.history.push(op);
    state.undone.length = 0;
    drawOp(offCtx, op);
    drawFrame();
    persistLocal();
  }

  function drawOp(ctx2d, op){
    if (op.kind === 'stroke') strokeTo(ctx2d, op.path, op);
    else if (op.kind === 'shape' || op.kind === 'text' || op.kind === 'image') drawShape(ctx2d, op);
  }

  function rebuild(){
    offCtx.clearRect(0,0,off.width,off.height);
    for (const op of state.history) drawOp(offCtx, op);
    drawFrame();
  }

  function drawFrame(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(off, 0, 0);
    // live preview for shapes/lines
    if (state.drawing){
      if (state.tool==='brush' || state.tool==='eraser'){
        if (state.points.length) strokeTo(ctx, state.points, currentStyle());
      } else if (state.startPoint) {
        previewShape(ctx);
      }
    }
  }

  function currentStyle(){ return { tool: state.tool, color: state.color, size: state.size }; }

  // ---------- Pointer handling ----------
  const wrap = canvas.parentElement;
  wrap.addEventListener('pointerdown', onDown);
  wrap.addEventListener('pointermove', onMove);
  wrap.addEventListener('pointerup', onUp);
  wrap.addEventListener('pointercancel', onUp);
  wrap.addEventListener('pointerleave', ()=> moveCursor(user.id, user.name, user.color, -9999, -9999));

  function localPos(e){
    const r = canvas.getBoundingClientRect();
    return { x:(e.clientX - r.left), y:(e.clientY - r.top) };
  }

  function onDown(e){
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = localPos(e);
    moveCursor(user.id, user.name, user.color, p.x, p.y);

    if (state.tool==='brush' || state.tool==='eraser'){
      state.drawing = true; state.points = []; state.strokeId = crypto.randomUUID();
      pushPoint(p.x, p.y, e.pressure && e.pressure>0 ? e.pressure : 0.5);
      rafTick();
    } else if (state.tool==='text'){
      const text = prompt('Enter text:');
      if (text){
        const op = { kind:'text', tool:'text', color: state.color, size: state.size, x:p.x, y:p.y, text, id:crypto.randomUUID(), userId:user.id };
        commit(op);
        network.send('op:commit', op);
      }
    } else if (state.tool==='image'){
      ui.imageInput.onchange = (ev)=>{
        const file = ev.target.files[0];
        if (!file) return;
        const img = new Image();
        img.onload = ()=>{
          const w = Math.min(img.width, canvas.width/dpr);
          const h = w * (img.height / img.width);
          const op = { kind:'image', tool:'image', color: state.color, size: state.size, x: p.x, y: p.y, w, h, src: img.src, id: crypto.randomUUID(), userId: user.id };
          commit(op);
          network.send('op:commit', op);
          ui.imageInput.value = '';
        };
        img.src = URL.createObjectURL(file);
      };
      ui.imageInput.click();
    } else {
      // shapes & line
      state.drawing = true;
      state.startPoint = p;
    }
  }

  function onMove(e){
    const p = localPos(e);
    moveCursor(user.id, user.name, user.color, p.x, p.y);
    network.send('cursor', { userId:user.id, name:user.name, color:user.color, p });
    if (!state.drawing) return;

    if (state.tool==='brush' || state.tool==='eraser'){
      const press = e.pressure && e.pressure>0 ? e.pressure : 0.5;
      pushPoint(p.x, p.y, press);
    } else {
      // shapes preview
      rafTick();
    }
  }

  function onUp(){
    if (!state.drawing) return;

    if (state.tool==='brush' || state.tool==='eraser'){
      state.drawing = false;
      const op = { kind:'stroke', id: state.strokeId, userId: user.id, ...currentStyle(), path: state.points.slice() };
      state.points = []; state.strokeId = null;
      commit(op);
      network.send('op:commit', op);
    } else if (state.startPoint) {
      const op = finalizeShape(state.startPoint);
      state.startPoint = null; state.drawing = false;
      if (op){
        commit(op);
        network.send('op:commit', op);
      }
    }
  }

  function pushPoint(x,y,pressure){
    const size = state.tool==='eraser' ? state.size : Math.max(1, state.size * (0.7 + pressure*0.6));
    state.points.push({ x, y, size });
    rafTick();
  }

  function previewShape(ctx2d){
    const a = state.startPoint;
    const b = currentMousePos();
    if (!a || !b) return;

    const style = { color: state.color, size: state.size, tool: state.tool };
    ctx2d.save();
    ctx2d.strokeStyle = style.color; ctx2d.lineWidth = style.size; ctx2d.setLineDash([6,6]);

    if (state.tool==='line'){
      ctx2d.beginPath(); ctx2d.moveTo(a.x,a.y); ctx2d.lineTo(b.x,b.y); ctx2d.stroke();
    } else if (state.tool==='rect'){
      const { x,y,w,h } = rectFromPoints(a,b);
      ctx2d.strokeRect(x,y,w,h);
    } else if (state.tool==='circle'){
      const { cx, cy, r } = circleFromPoints(a,b);
      ctx2d.beginPath(); ctx2d.arc(cx,cy,r,0,Math.PI*2); ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function finalizeShape(a){
    const b = currentMousePos();
    if (!b) return null;
    const base = { kind:'shape', id: crypto.randomUUID(), userId: user.id, color: state.color, size: state.size, tool: state.tool };

    if (state.tool==='line'){
      return { ...base, x1:a.x, y1:a.y, x2:b.x, y2:b.y };
    } else if (state.tool==='rect'){
      const { x,y,w,h } = rectFromPoints(a,b);
      return { ...base, x, y, w, h };
    } else if (state.tool==='circle'){
      const { cx, cy, r } = circleFromPoints(a,b);
      return { ...base, cx, cy, r };
    }
    return null;
  }

  function rectFromPoints(a,b){
    const x = Math.min(a.x,b.x), y = Math.min(a.y,b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    return { x,y,w,h };
  }
  function circleFromPoints(a,b){
    const cx = (a.x + b.x)/2, cy = (a.y + b.y)/2;
    const r = Math.hypot(b.x - a.x, b.y - a.y)/2;
    return { cx, cy, r };
  }
  function currentMousePos(){ /* tracked by cursor move */
    const el = state.cursors.get(user.id);
    if (!el) return null;
    return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
  }

  // ---------- Undo/Redo/Clear ----------
  function undo(){
    if (!state.history.length) return;
    const op = state.history.pop();
    state.undone.push(op);
    rebuild();
    persistLocal();
    network.send('op:undo', { opId: op.id, by: user.id });
  }
  function redo(){
    if (!state.undone.length) return;
    const op = state.undone.pop();
    state.history.push(op);
    rebuild();
    persistLocal();
    network.send('op:redo', { opId: op.id, by: user.id });
  }
  function clearAll(){
    state.history.length = 0; state.undone.length = 0;
    offCtx.clearRect(0,0,off.width,off.height);
    drawFrame();
    persistLocal();
    network.send('op:clear', { by: user.id });
  }

  // ---------- Presence & cursors ----------
  function upsertUser(u){ state.users.set(u.id, u); renderUsers(); }
  function removeUser(id){ state.users.delete(id); removeCursor(id); renderUsers(); }
  function renderUsers(){
    const ul = ui.userList; ul.innerHTML = '';
    for (const u of state.users.values()){
      const li = document.createElement('li');
      const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = u.color; li.appendChild(sw);
      const name = document.createElement('span'); name.textContent = u.name + (u.id===user.id?' (you)':''); li.appendChild(name);
      ul.appendChild(li);
    }
  }
  function moveCursor(id, name, color, x, y){
    let el = state.cursors.get(id);
    if (!el){ el = document.createElement('div'); el.className = 'remote-cursor'; el.innerHTML = `<span class="dot"></span><span class="label"></span>`; cursorLayer.appendChild(el); state.cursors.set(id, el); }
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.querySelector('.dot').style.background = color;
    el.querySelector('.label').textContent = name;
  }
  function removeCursor(id){ const el = state.cursors.get(id); if (el){ el.remove(); state.cursors.delete(id);} }

  // ---------- Networking events ----------
  function handleRemoteEvent(msg){
    const { type, payload } = msg;

    if (type === 'init') {
      // initial history from server
      state.history = payload || [];
      state.undone = [];
      rebuild();
      persistLocal();
      return;
    }

    switch(type){
      case 'presence:join': upsertUser(payload.user); break;
      case 'presence:leave': removeUser(payload.userId); break;
      case 'cursor': {
        const { userId, name, color, p } = payload; moveCursor(userId, name, color, p.x, p.y); if (!state.users.has(userId)) upsertUser({ id:userId, name, color }); break;
      }
      case 'op:commit': {
        const op = payload; state.history.push(op); drawOp(offCtx, op); drawFrame(); persistLocal(); break;
      }
      case 'op:undo': {
        const idx = state.history.findIndex(o=>o.id===payload.opId);
        if (idx>=0){ const [op]=state.history.splice(idx,1); state.undone.push(op); }
        else { state.history.pop(); }
        rebuild(); persistLocal(); break;
      }
      case 'op:redo': {
        if (state.undone.length){ const op = state.undone.pop(); state.history.push(op); rebuild(); persistLocal(); }
        break;
      }
      case 'op:clear': { state.history.length = 0; state.undone.length = 0; rebuild(); persistLocal(); break; }
      case 'ping': { network.send('pong', { t0: payload.t0 }); break; }
    }
  }

  // ---------- Export / Import ----------
  function exportPNG(){
    const a = document.createElement('a');
    a.download = `collabcanvas-${roomId}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  }
  function exportJSON(){
    const a = document.createElement('a');
    const blob = new Blob([JSON.stringify(state.history, null, 2)], { type: 'application/json' });
    a.href = URL.createObjectURL(blob);
    a.download = `collabcanvas-${roomId}.json`;
    a.click();
  }
  function importJSON(e){
    const file = e.target.files[0]; if (!file) return;
    const fr = new FileReader();
    fr.onload = ()=>{
      try{
        const ops = JSON.parse(fr.result);
        state.history = Array.isArray(ops) ? ops : [];
        state.undone = [];
        rebuild(); persistLocal();
        // Broadcast as clear + re-commit (optional). Here we keep local only.
      } catch(err){ alert('Invalid JSON'); }
      ui.importJson.value = '';
    };
    fr.readAsText(file);
  }

  // ---------- Local persistence fallback (per room) ----------
  const LS_KEY = `collabcanvas-history:${roomId}`;
  function persistLocal(){
    try { localStorage.setItem(LS_KEY, JSON.stringify(state.history)); } catch {}
  }
  // If server didn't send init (e.g., Broadcast mode), load from local
  if (!state.history.length){
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      if (Array.isArray(saved) && saved.length){ state.history = saved; rebuild(); }
    } catch {}
  }

  // ---------- RAF / metrics ----------
  let raf=null; function rafTick(){ if (raf) return; raf = requestAnimationFrame(()=>{ raf=null; drawFrame(); }); }
  (function fpsLoop(){
    let frames=0, last=performance.now();
    (function tick(){
      frames++; const now=performance.now();
      if (now - last >= 1000){ onFps?.(frames); frames=0; last=now; }
      requestAnimationFrame(tick);
    })();
  })();
  (function pingLoop(){
    (async ()=>{ try{ const ms = await network.ping(); onLatency?.(ms); } catch { onLatency?.(-1); } })();
    setInterval(async ()=>{ try{ const ms = await network.ping(); onLatency?.(ms); } catch { onLatency?.(-1); } }, 1500);
  })();

  // Public API
  return { handleRemoteEvent, upsertUser };
}
