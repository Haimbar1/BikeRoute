const $=id=>document.getElementById(id);
const map=L.map('map',{zoomControl:false}).setView([32.08,34.78],13);
const layers={
  'רחובות':L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'}),
  'אופניים':L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap © CyclOSM'}),
  'טופוגרפית':L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{maxZoom:17,attribution:'© OpenStreetMap © OpenTopoMap'}),
  'לוויין':L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'})
};
let baseName='רחובות';try{baseName=localStorage.getItem('base')||baseName}catch{}
(layers[baseName]||layers['רחובות']).addTo(map);
L.control.layers(layers,null,{position:'topleft'}).addTo(map);
map.on('baselayerchange',e=>{try{localStorage.setItem('base',e.name)}catch{}});

let route=null,routeLayer=null,meMarker=null,trail=L.polyline([],{color:'#f59e0b',weight:5}).addTo(map);
let watchId=null,following=true,wakeLock=null,timer=null,S=null;
const msg=t=>$('msg').textContent=t||'';

/* ---------- geo helpers ---------- */
const R=6371000,rad=d=>d*Math.PI/180;
function hav(a,b){
  const dLa=rad(b[0]-a[0]),dLo=rad(b[1]-a[1]);
  const x=Math.sin(dLa/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

/* ---------- GPX ---------- */
function parseGPX(text){
  const xml=new DOMParser().parseFromString(text,'application/xml');
  let pts=[...xml.getElementsByTagName('trkpt')];
  if(!pts.length)pts=[...xml.getElementsByTagName('rtept')];
  if(!pts.length)throw new Error('לא נמצאו נקודות ב-GPX');
  const ll=[],ele=[];
  pts.forEach(p=>{
    ll.push([+p.getAttribute('lat'),+p.getAttribute('lon')]);
    const e=p.getElementsByTagName('ele')[0];
    ele.push(e?+e.textContent:NaN);
  });
  return buildRoute(ll,ele);
}
function buildRoute(ll,ele){
  let last=ele.find(v=>!isNaN(v))||0;
  for(let i=0;i<ele.length;i++){if(isNaN(ele[i]))ele[i]=last;else last=ele[i];}
  const sm=ele.map((_,i)=>{let s=0,n=0;for(let k=-2;k<=2;k++){const v=ele[i+k];if(v!==undefined){s+=v;n++}}return s/n;});
  const cum=[0],gain=[0];
  for(let i=1;i<ll.length;i++){
    cum.push(cum[i-1]+hav(ll[i-1],ll[i]));
    gain.push(gain[i-1]+Math.max(0,sm[i]-sm[i-1]));
  }
  return{ll,ele:sm,cum,gain,total:cum[cum.length-1],totalGain:gain[gain.length-1]};
}
function showRoute(r){
  route=r;
  if(routeLayer)routeLayer.remove();
  routeLayer=L.layerGroup([
    L.polyline(r.ll,{color:'#ef4444',weight:6,opacity:.85}),
    L.circleMarker(r.ll[0],{radius:8,color:'#fff',fillColor:'#16a34a',fillOpacity:1}),
    L.circleMarker(r.ll[r.ll.length-1],{radius:8,color:'#fff',fillColor:'#111',fillOpacity:1})
  ]).addTo(map);
  map.fitBounds(L.latLngBounds(r.ll),{padding:[60,20]});
  $('left').textContent=(r.total/1000).toFixed(1);
  $('climbleft').textContent=Math.round(r.totalGain);
  msg(`מסלול: ${(r.total/1000).toFixed(1)} ק"מ, טיפוס ${Math.round(r.totalGain)} מ'`);
}
/* ---------- route library (IndexedDB) ---------- */
const db=new Promise((res,rej)=>{
  const q=indexedDB.open('bike',1);
  q.onupgradeneeded=()=>q.result.createObjectStore('routes',{keyPath:'id',autoIncrement:true});
  q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);
});
const tx=async(mode,fn)=>{
  const s=(await db).transaction('routes',mode).objectStore('routes');
  return new Promise((res,rej)=>{const q=fn(s);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});
};
const saveRoute=(name,route)=>tx('readwrite',s=>s.add({name,added:Date.now(),route}));
const listRoutes=()=>tx('readonly',s=>s.getAll());
const getRoute=id=>tx('readonly',s=>s.get(id));
const delRoute=id=>tx('readwrite',s=>s.delete(id));
const lastId=()=>{try{return +localStorage.getItem('lastRoute')||0}catch{return 0}};
const setLast=id=>{try{localStorage.setItem('lastRoute',id)}catch{}};

$('file').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{
    const r=parseGPX(await f.text());showRoute(r);
    setLast(await saveRoute(f.name.replace(/\.(gpx|xml)$/i,''),r));
  }catch(err){msg(err.message)}
  e.target.value='';
};
async function renderLib(){
  const items=(await listRoutes()).sort((a,b)=>b.added-a.added),box=$('list');
  box.innerHTML=items.length?'':'<div class="empty">אין מסלולים שמורים. טען קובץ GPX.</div>';
  items.forEach(it=>{
    const d=document.createElement('div');d.className='item';
    const n=document.createElement('div');n.className='name';
    n.textContent=it.name;
    const sm=document.createElement('small');
    sm.textContent=`${(it.route.total/1000).toFixed(1)} ק"מ · ${Math.round(it.route.totalGain)} מ' טיפוס`;
    n.appendChild(sm);
    const open=document.createElement('button');open.className='btn primary';open.textContent='פתח';
    open.onclick=()=>{showRoute(it.route);setLast(it.id);$('sheet').hidden=true};
    const gpx=document.createElement('button');gpx.className='btn';gpx.textContent='GPX';
    gpx.onclick=()=>downloadGPX(it.name,it.route);
    const del=document.createElement('button');del.className='btn del';del.textContent='מחק';
    del.onclick=async()=>{if(confirm(`למחוק את "${it.name}"?`)){await delRoute(it.id);renderLib()}};
    d.append(n,open,gpx,del);box.appendChild(d);
  });
}
function downloadGPX(name,r){
  const esc=s=>s.replace(/[<&>]/g,'');
  const pts=r.ll.map((p,i)=>`<trkpt lat="${p[0]}" lon="${p[1]}"><ele>${r.ele[i].toFixed(1)}</ele></trkpt>`).join('\n');
  const x=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="BikeRoute" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(name)}</name><trkseg>\n${pts}\n</trkseg></trk></gpx>`;
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([x],{type:'application/gpx+xml'}));
  a.download=name+'.gpx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

/* ---------- route creator ---------- */
let cr=null;
async function snap(a,b,mode){
  if(mode==='line')return[a,b];
  const host=mode==='bike'?'routing.openstreetmap.de/routed-bike':'router.project-osrm.org';
  try{
    const r=await(await fetch(`https://${host}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`)).json();
    return r.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]);
  }catch{msg('הניתוב נכשל, משתמש בקו ישר');return[a,b]}
}
function crRedraw(){
  const all=cr.legs.flatMap(l=>l.coords||[]);
  cr.line.setLatLngs(all);
  const ready=cr.legs.every(l=>l.coords);
  let len=0;for(let i=1;i<all.length;i++)len+=hav(all[i-1],all[i]);
  $('crInfo').textContent=cr.pts.length?`${cr.pts.length} נקודות · ${(len/1000).toFixed(1)} ק"מ${ready?'':' (מחשב...)'}`:'הקש על המפה כדי להוסיף נקודות';
}
function crAdd(e){
  const p=[e.latlng.lat,e.latlng.lng];
  const m=L.marker(p,{icon:L.divIcon({className:'',html:`<div class="pt">${cr.pts.length+1}</div>`,iconSize:[22,22]})}).addTo(cr.layer);
  if(cr.pts.length){
    const leg={coords:null};cr.legs.push(leg);
    snap(cr.pts[cr.pts.length-1],p,$('crMode').value).then(c=>{leg.coords=c;if(cr)crRedraw()});
  }
  cr.pts.push(p);cr.markers.push(m);crRedraw();
}
function crReset(){
  cr.layer.clearLayers();cr.line=L.polyline([],{color:'#2563eb',weight:6}).addTo(cr.layer);
  cr.pts=[];cr.legs=[];cr.markers=[];crRedraw();
}
function startCreate(){
  $('sheet').hidden=true;$('creator').hidden=false;$('bar').hidden=true;
  document.body.classList.add('creating');
  cr={layer:L.layerGroup().addTo(map)};crReset();
  following=false;$('follow').classList.remove('on');
  map.on('click',crAdd);
}
function exitCreate(){
  map.off('click',crAdd);cr.layer.remove();cr=null;
  $('creator').hidden=true;$('bar').hidden=false;document.body.classList.remove('creating');
}
$('newRoute').onclick=startCreate;
$('crExit').onclick=exitCreate;
$('crClear').onclick=crReset;
$('crUndo').onclick=()=>{
  if(!cr.pts.length)return;
  cr.pts.pop();cr.layer.removeLayer(cr.markers.pop());
  if(cr.legs.length)cr.legs.pop();
  crRedraw();
};
async function elevations(pts){
  const out=[];
  for(let i=0;i<pts.length;i+=100){
    const s=pts.slice(i,i+100);
    const u=`https://api.open-meteo.com/v1/elevation?latitude=${s.map(p=>p[0].toFixed(5)).join(',')}&longitude=${s.map(p=>p[1].toFixed(5)).join(',')}`;
    out.push(...(await(await fetch(u)).json()).elevation);
  }
  return out;
}
$('crSave').onclick=async()=>{
  if(cr.pts.length<2)return msg('צריך לפחות 2 נקודות');
  if(!cr.legs.every(l=>l.coords))return msg('המתן, המסלול עדיין מחושב');
  const name=(prompt('שם למסלול:')||'').trim();
  if(!name)return;
  msg('שומר...');
  let ll=cr.legs.flatMap(l=>l.coords);
  const step=Math.max(1,Math.ceil(ll.length/400));
  ll=ll.filter((_,i)=>i%step===0||i===ll.length-1);
  let ele;
  try{ele=await elevations(ll)}catch{ele=ll.map(()=>0);msg('נתוני גובה לא זמינים, נשמר בלי גובה')}
  const r=buildRoute(ll,ele);
  const id=await saveRoute(name,r);setLast(id);
  exitCreate();showRoute(r);
};
$('lib').onclick=async()=>{await renderLib();$('sheet').hidden=false};
$('sheetClose').onclick=()=>$('sheet').hidden=true;
(async()=>{
  try{
    // migrate the old single saved route
    const old=localStorage.getItem('route');
    if(old){setLast(await saveRoute('מסלול שמור',JSON.parse(old)));localStorage.removeItem('route')}
    const id=lastId();if(id){const it=await getRoute(id);if(it)showRoute(it.route)}
  }catch{}
})();

/* ---------- ride ---------- */
const fmtT=s=>{
  s=Math.floor(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;
  return h?`${h}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`:`${m}:${String(x).padStart(2,'0')}`;
};
function nearest(p){
  let bi=0,bd=Infinity;
  for(let i=0;i<route.ll.length;i++){
    const dy=route.ll[i][0]-p[0],dx=(route.ll[i][1]-p[1])*Math.cos(rad(p[0]));
    const d=dy*dy+dx*dx;if(d<bd){bd=d;bi=i}
  }
  return{i:bi,d:hav(p,route.ll[bi])};
}
function onPos(pos){
  const c=pos.coords,p=[c.latitude,c.longitude];
  if(c.accuracy>50)return msg('אות GPS חלש...');
  msg();
  if(!meMarker)meMarker=L.marker(p,{icon:L.divIcon({className:'',html:'<div class="me"></div>',iconSize:[18,18]}),zIndexOffset:1000}).addTo(map);
  meMarker.setLatLng(p);
  if(S.last){
    const d=hav(S.last,p);
    if(d>3){S.dist+=d;trail.addLatLng(p);}            // ignore GPS jitter
    if(c.altitude!=null){                              // climb with 3m hysteresis
      S.altSm=S.altSm==null?c.altitude:S.altSm*.8+c.altitude*.2;
      if(S.altRef==null)S.altRef=S.altSm;
      const df=S.altSm-S.altRef;
      if(df>=3){S.climb+=df;S.altRef=S.altSm}else if(df<=-3)S.altRef=S.altSm;
    }
  }
  S.last=p;
  const kmh=c.speed!=null&&c.speed>=0?c.speed*3.6:0;
  $('speed').textContent=kmh.toFixed(1);
  $('dist').textContent=(S.dist/1000).toFixed(1);
  $('climb').textContent=Math.round(S.climb);
  if(route){
    const n=nearest(p);
    $('left').textContent=Math.max(0,(route.total-route.cum[n.i])/1000).toFixed(1);
    $('climbleft').textContent=Math.round(route.totalGain-route.gain[n.i]);
    let j=n.i;while(j<route.ll.length-1&&route.cum[j]-route.cum[n.i]<60)j++;   // grade over next ~60m
    const run=route.cum[j]-route.cum[n.i];
    $('grade').textContent=run>20?((route.ele[j]-route.ele[n.i])/run*100).toFixed(1):'--';
    $('warn').hidden=n.d<60;
  }
  if(following)map.setView(p,Math.max(map.getZoom(),16),{animate:true});
}
async function startRide(){
  if(!navigator.geolocation)return msg('אין תמיכה ב-GPS');
  S={dist:0,climb:0,altSm:null,altRef:null,last:null,t0:Date.now()};
  trail.setLatLngs([]);
  watchId=navigator.geolocation.watchPosition(onPos,e=>msg('שגיאת GPS: '+e.message),{enableHighAccuracy:true,maximumAge:0,timeout:20000});
  timer=setInterval(()=>$('time').textContent=fmtT((Date.now()-S.t0)/1000),1000);
  try{wakeLock=await navigator.wakeLock.request('screen')}catch{}
  $('go').textContent='סיים רכיבה';$('go').classList.add('stop');
}
function stopRide(){
  navigator.geolocation.clearWatch(watchId);watchId=null;clearInterval(timer);
  try{wakeLock&&wakeLock.release()}catch{}
  $('go').textContent='התחל רכיבה';$('go').classList.remove('stop');
  msg(`סיכום: ${(S.dist/1000).toFixed(2)} ק"מ, ${Math.round(S.climb)} מ' טיפוס, ${$('time').textContent}`);
}
$('go').onclick=()=>watchId==null?startRide():stopRide();
document.addEventListener('visibilitychange',async()=>{
  if(document.visibilityState==='visible'&&watchId!=null){try{wakeLock=await navigator.wakeLock.request('screen')}catch{}}
});
$('follow').onclick=()=>{following=!following;$('follow').classList.toggle('on',following)};
map.on('dragstart',()=>{following=false;$('follow').classList.remove('on')});

/* ---------- Bluetooth heart rate (Garmin HR broadcast / any BLE HR strap) ---------- */
async function connectHR(){
  if(!navigator.bluetooth)return msg('Web Bluetooth נתמך רק ב-Chrome באנדרואיד (לא באייפון)');
  try{
    const dev=await navigator.bluetooth.requestDevice({filters:[{services:['heart_rate']}]});
    dev.addEventListener('gattserverdisconnected',()=>{$('hr').textContent='--';$('ble').classList.remove('on');msg('הדופק התנתק')});
    const srv=await dev.gatt.connect();
    const ch=await(await srv.getPrimaryService('heart_rate')).getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged',e=>{
      const v=e.target.value;
      $('hr').textContent=v.getUint8(0)&1?v.getUint16(1,true):v.getUint8(1);
    });
    await ch.startNotifications();
    $('ble').classList.add('on');msg('דופק מחובר: '+(dev.name||''));
  }catch(e){msg('חיבור נכשל: '+e.message)}
}
$('ble').onclick=connectHR;

if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
