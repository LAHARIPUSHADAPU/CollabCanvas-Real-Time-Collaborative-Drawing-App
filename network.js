// Transport chain: WebSocket (/ws) → BroadcastChannel → Local echo
export async function initNetwork(selfUser, onEvent){
  const chain = [webSocketTransport, broadcastTransport];
  for (const factory of chain){
    try{ const tr = await factory(selfUser, onEvent); if (tr) return tr; } catch {}
  }
  return localEcho(selfUser, onEvent);
}

function webSocketTransport(self, onEvent){
  return new Promise((resolve, reject)=>{
    const { protocol, host } = window.location;
    const url = (protocol==='https:'?'wss://':'ws://') + host + '/ws';
    const ws = new WebSocket(url);

    const sendRaw = (obj)=> ws.readyState===1 && ws.send(JSON.stringify(obj));
    const send = (type, payload)=> sendRaw({ type, payload });

    ws.onopen = ()=>{
      // presence announce will happen when app sends 'join'
      resolve({ name:'websocket', send, close:()=>ws.close(), ping });
    };
    ws.onerror = ()=> reject('ws error');
    ws.onmessage = (e)=>{
      try {
        const msg = JSON.parse(e.data);
        if (msg?.type === 'evt') onEvent?.(msg.payload);
        if (msg?.type === 'init') onEvent?.({ type: 'init', payload: msg.payload });
      } catch {}
    };

    async function ping(){
      const t0 = performance.now();
      return new Promise((res)=>{
        const handler = (e)=>{
          try{
            const m = JSON.parse(e.data);
            if (m?.type === 'evt' && m.payload?.type === 'pong') {
              ws.removeEventListener('message', handler);
              res(performance.now() - t0);
            }
          } catch {}
        };
        ws.addEventListener('message', handler);
        send('ping', { t0 });
      });
    }
  });
}

function broadcastTransport(self, onEvent){
  const ch = new BroadcastChannel('collab-canvas-v3');
  const send = (type, payload)=> ch.postMessage({ type, payload });
  ch.onmessage = (e)=> onEvent?.(e.data);
  send('presence:join', { user: self });
  const ping = async ()=> 0;
  return Promise.resolve({ name:'broadcast', send, close:()=>ch.close(), ping });
}

function localEcho(self, onEvent){
  const send = (type, payload)=> onEvent?.({ type, payload });
  send('presence:join', { user: self });
  const ping = async ()=> 0;
  return { name:'local', send, close:()=>{}, ping };
}
