import { WebSocket } from 'ws';
const ws = new WebSocket(process.argv[2]); let i=0;
const ev = [
 ['send while genuinely offline', '(async()=>{const e=await window.Fellowship.publishMessage("outbox-probe","offline test "+Date.now(),[]);return JSON.stringify({delivered:e._delivered,id:e.id.slice(0,8)});})()'],
 ['queued now', 'String(window.Fellowship.outboxCount())'],
 ['persisted to localStorage', 'String((localStorage.getItem("trinityone.outbox")||"").length > 2)'],
];
ws.on('open',()=>{ws.send(JSON.stringify({id:1,method:'Runtime.enable'}));go();});
function go(){if(i>=ev.length){ws.close();return;}ws.send(JSON.stringify({id:100+i,method:'Runtime.evaluate',params:{expression:ev[i][1],returnByValue:true,awaitPromise:true}}));}
ws.on('message',r=>{const m=JSON.parse(r);if(m.id>=100){const v=m.result&&m.result.result;console.log('  '+ev[i][0]+': '+JSON.stringify(v&&('value' in v?v.value:v.description)));i++;go();}});
ws.on('close',()=>process.exit(0));
