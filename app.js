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
let turns=[],climbs=[],turnMarker=null;
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
  turns=findTurns(r);climbs=findClimbs(r);hideGuidance();
  msg(`מסלול: ${(r.total/1000).toFixed(1)} ק"מ, טיפוס ${Math.round(r.totalGain)} מ' · ${turns.length} פניות, ${climbs.length} עליות`);
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
const bearing=(a,b)=>Math.atan2(Math.sin(rad(b[1]-a[1]))*Math.cos(rad(b[0])),
  Math.cos(rad(a[0]))*Math.sin(rad(b[0]))-Math.sin(rad(a[0]))*Math.cos(rad(b[0]))*Math.cos(rad(b[1]-a[1])))*180/Math.PI;
// Match the rider to a route point. Out-and-back routes pass the same road twice, so follow progress
// (search only near the last match) and, when re-acquiring, prefer the direction of travel.
function nearest(p,heading){
  const L=route.ll,cum=route.cum,n=L.length,cosL=Math.cos(rad(p[0]));
  const d2=i=>{const dy=L[i][0]-p[0],dx=(L[i][1]-p[1])*cosL;return dy*dy+dx*dx};
  const meters=d=>Math.sqrt(d)*111000;
  const scan=(a,b)=>{let bi=a,bd=Infinity;for(let i=a;i<=b;i++){const d=d2(i);if(d<bd){bd=d;bi=i}}return{i:bi,d:bd}};
  if(S.idx!=null){
    let lo=S.idx,hi=S.idx;
    while(lo>0&&cum[S.idx]-cum[lo]<300)lo--;
    while(hi<n-1&&cum[hi]-cum[S.idx]<800)hi++;
    const w=scan(lo,hi);
    if(meters(w.d)<80){S.idx=w.i;return{i:w.i,d:hav(p,L[w.i])}}
  }
  const g=scan(0,n-1),lim=meters(g.d)+30;
  let pick=null,first=null;
  for(let i=0;i<n-1;i++){
    if(meters(d2(i))>lim)continue;
    if(first==null)first=i;
    if(heading!=null&&!isNaN(heading)){
      const diff=Math.abs(((bearing(L[i],L[Math.min(n-1,i+3)])-heading+540)%360)-180);
      if(diff<90){pick=i;break}
    }
  }
  const i=pick!=null?pick:(first!=null?first:g.i);
  S.idx=i;return{i,d:hav(p,L[i])};
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
    const n=nearest(p,c.speed>1.5?c.heading:null);
    $('left').textContent=Math.max(0,(route.total-route.cum[n.i])/1000).toFixed(1);
    $('climbleft').textContent=Math.round(route.totalGain-route.gain[n.i]);
    // grade over ~150m ahead (~150m behind near the end), smoothed
    let a=n.i,b=n.i;
    while(b<route.ll.length-1&&route.cum[b]-route.cum[n.i]<150)b++;
    if(route.cum[b]-route.cum[a]<50)while(a>0&&route.cum[n.i]-route.cum[a]<150)a--;
    const run=route.cum[b]-route.cum[a];
    if(run>=50){
      const g=(route.ele[b]-route.ele[a])/run*100;
      S.grade=S.grade==null?g:S.grade*.7+g*.3;
      $('grade').textContent=S.grade.toFixed(1);
    }else $('grade').textContent='--';
    $('warn').hidden=n.d<OFF_ROUTE;
    updateGuidance(n.i);
  }
  if(following)map.setView(p,Math.max(map.getZoom(),16),{animate:true});
}
/* ---------- guidance: off-route alert, next turn, next climb ---------- */
const OFF_ROUTE=400;   // meters from the route before the "off route" alert
const fmtD=m=>m<1000?`${Math.max(10,Math.round(m/10)*10)} מ'`:`${(m/1000).toFixed(1)} ק"מ`;

// A turn = heading change of 55°+ between the 40m before and the 40m after a point.
function findTurns(r){
  const L=r.ll,cum=r.cum,n=L.length,raw=[];
  for(let i=1;i<n-1;i++){
    let a=i;while(a>0&&cum[i]-cum[a]<40)a--;
    let b=i;while(b<n-1&&cum[b]-cum[i]<40)b++;
    if(cum[i]-cum[a]<20||cum[b]-cum[i]<20)continue;
    const d=((bearing(L[i],L[b])-bearing(L[a],L[i])+540)%360)-180;
    if(Math.abs(d)>=55)raw.push({i,d});
  }
  const out=[];
  raw.forEach(t=>{           // merge neighbours within 50m, keep the sharpest
    const last=out[out.length-1];
    if(last&&cum[t.i]-cum[last.i]<50){if(Math.abs(t.d)>Math.abs(last.d))out[out.length-1]=t}
    else out.push(t);
  });
  return out.map(t=>({cum:cum[t.i],d:t.d,ll:L[t.i],i:t.i}));
}
function turnInfo(d){
  const a=Math.abs(d);
  if(a>150)return{arrow:'↩',text:'פרסה'};
  return{arrow:d>0?'↱':'↰',text:`${a>110?'פנייה חדה':a>80?'פנייה':'פנייה קלה'} ${d>0?'ימינה':'שמאלה'}`};
}

// A climb = sustained rise (2.5m per 100m) that gains 15m+ over 200m+, ending at its peak.
function findClimbs(r){
  const step=25,m=Math.floor(r.total/step)+1,e=[];
  if(r.cum.length<2||m<10)return[];
  let j=0;
  for(let k=0;k<m;k++){
    const d=k*step;while(j<r.cum.length-2&&r.cum[j+1]<d)j++;
    const c0=r.cum[j],c1=r.cum[j+1],t=c1>c0?Math.min(1,Math.max(0,(d-c0)/(c1-c0))):0;
    e.push(r.ele[j]+(r.ele[j+1]-r.ele[j])*t);
  }
  const s=e.map((_,k)=>{let a=0,c=0;for(let q=-2;q<=2;q++)if(e[k+q]!==undefined){a+=e[k+q];c++}return a/c});
  const out=[];let k=0;
  while(k<m-4){
    if(s[k+4]-s[k]<2.5){k++;continue}
    let st=k,back=0;while(st>0&&back<8&&s[st-1]<s[st]-0.3){st--;back++}
    let peak=k,q=k;
    while(q<m-1&&s[q]>s[peak]-6){if(s[q]>=s[peak])peak=q;q++}
    const gain=s[peak]-s[st],len=(peak-st)*step;
    if(gain>=15&&len>=200){
      let mx=0;for(let z=st;z+4<=peak;z++)mx=Math.max(mx,s[z+4]-s[z]);
      out.push({startCum:st*step,endCum:peak*step,gain,len,avg:gain/len*100,max:mx,prof:s.slice(st,peak+1)});
      k=peak+1;
    }else k=Math.max(k+1,st+1);
  }
  return out;
}
function drawClimb(c,pos){
  const cv=$('climbCv'),ctx=cv.getContext('2d'),dpr=window.devicePixelRatio||1;
  const W=cv.clientWidth,H=cv.clientHeight;if(!W||!H)return;
  cv.width=W*dpr;cv.height=H*dpr;ctx.scale(dpr,dpr);
  const p=c.prof,n=p.length,min=Math.min(...p),max=Math.max(...p),rng=Math.max(1,max-min);
  const x=k=>k/(n-1)*W,y=v=>H-2-(v-min)/rng*(H-16);
  for(let k=0;k<n-1;k++){
    const a=Math.max(0,k-2),b=Math.min(n-1,k+2);
    const g=Math.max(0,(p[b]-p[a])/((b-a)*25)*100);
    ctx.fillStyle=`hsl(${120-Math.min(g,12)/12*120},75%,45%)`;
    ctx.beginPath();ctx.moveTo(x(k),H);ctx.lineTo(x(k),y(p[k]));ctx.lineTo(x(k+1)+0.5,y(p[k+1]));ctx.lineTo(x(k+1)+0.5,H);ctx.closePath();ctx.fill();
  }
  if(pos>=c.startCum){
    const px=Math.min(1,(pos-c.startCum)/(c.endCum-c.startCum))*W;
    ctx.fillStyle='#fff';ctx.fillRect(px-1,0,2,H);
  }
  ctx.fillStyle='#fff';ctx.font='11px system-ui';
  ctx.textAlign='left';ctx.fillText(`${Math.round(max)} מ'`,4,11);
  ctx.textAlign='right';ctx.fillText(`${(c.len/1000).toFixed(1)} ק"מ`,W-4,11);
}
function hideGuidance(){
  $('turn').hidden=true;$('climbCard').hidden=true;document.body.classList.remove('hasclimb');
  if(turnMarker){turnMarker.remove();turnMarker=null}
}
function updateGuidance(i){
  const pos=route.cum[i],el=$('turn'),t=turns.find(t=>t.cum>pos+10);
  el.hidden=false;
  if(t){
    const inf=turnInfo(t.d),key=t.i+inf.arrow;
    el.textContent=`${inf.arrow} ${inf.text} בעוד ${fmtD(t.cum-pos)}`;
    if(!turnMarker||turnMarker._key!==key){
      if(turnMarker)turnMarker.remove();
      turnMarker=L.marker(t.ll,{icon:L.divIcon({className:'',html:`<div class="tm">${inf.arrow}</div>`,iconSize:[34,34]}),interactive:false,zIndexOffset:500}).addTo(map);
      turnMarker._key=key;
    }
  }else{
    el.textContent=`🏁 סוף המסלול בעוד ${fmtD(Math.max(0,route.total-pos))}`;
    if(turnMarker){turnMarker.remove();turnMarker=null}
  }
  const c=climbs.find(c=>c.endCum>pos+10),card=$('climbCard');
  if(!c){card.hidden=true;document.body.classList.remove('hasclimb');return}
  card.hidden=false;document.body.classList.add('hasclimb');
  $('climbTxt').textContent=pos<c.startCum?`עלייה בעוד ${fmtD(c.startCum-pos)}`:`בעלייה · נותרו ${fmtD(c.endCum-pos)} לפסגה`;
  $('climbTxt2').textContent=`אורך ${(c.len/1000).toFixed(1)} ק"מ · +${Math.round(c.gain)} מ' · ממוצע ${c.avg.toFixed(1)}% · מקס' ${c.max.toFixed(0)}%`;
  drawClimb(c,pos);
}

async function startRide(){
  if(!navigator.geolocation)return msg('אין תמיכה ב-GPS');
  S={dist:0,climb:0,altSm:null,altRef:null,last:null,idx:null,grade:null,t0:Date.now()};
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
  hideGuidance();$('warn').hidden=true;
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

// keep the screen upright (works when installed to the home screen; ignored in a plain browser tab)
const lockPortrait=()=>{try{screen.orientation.lock('portrait').catch(()=>{})}catch{}};
lockPortrait();
$('go').addEventListener('click',lockPortrait);

if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
