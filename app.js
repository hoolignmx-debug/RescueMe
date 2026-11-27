(function(){
'use strict';
var $=function(s){return document.querySelector(s);};
var el=function(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;};
var tick=function(ms){return new Promise(function(r){setTimeout(r,ms);});};
var STEPS=[
  ['Open app','Page loaded'],
  ['Emergency SOS scan','Press the red button'],
  ['Camera opens','Camera or photo file'],
  ['Capture victim’s face','Waiting for a photo'],
  ['Check image quality','Size, light, sharpness, face'],
  ['Extract facial features','Edge directions on a 4×4 grid'],
  ['Create facial embedding','128 values, unit length'],
  ['Collect GPS + timestamp','Location and clock'],
  ['Send secure request','Encrypted before it leaves']
];
var st=STEPS.map(function(){return {s:'todo',d:null,ms:null};});
var T={};
var S={bmp:null,box:null,metrics:null,override:false,emb:null,loc:null,ts:null,src:'manual',clock:null};

function renderSteps(){
  var ol=$('#steps');ol.innerHTML='';
  STEPS.forEach(function(x,i){
    var li=el('li','step '+st[i].s);
    if(st[i].s==='active')li.setAttribute('aria-current','step');
    li.append(el('span','mk',st[i].s==='done'?'✓':st[i].s==='fail'?'!':String(i+1)));
    var b=el('div');b.append(el('div','t',x[0]),el('div','d',st[i].d||x[1]));
    li.append(b);
    if(st[i].ms!=null)li.append(el('span','ms',st[i].ms+' ms'));
    ol.append(li);
  });
}
function act(i,d){T[i]=performance.now();st[i]={s:'active',d:d||null,ms:null};renderSteps();}
function ok(i,d){var ms=T[i]!=null?Math.round(performance.now()-T[i]):null;if(ms!=null&&ms<2)ms=null;st[i]={s:'done',d:d||null,ms:ms};renderSteps();}
function bad(i,d){st[i]={s:'fail',d:d||null,ms:null};renderSteps();}
function show(id,on){$('#'+id).hidden=!on;}
function reveal(id){var n=$('#'+id);n.hidden=false;n.scrollIntoView({block:'nearest'});}

function resetFrom(i){
  for(var j=i;j<9;j++)st[j]={s:'todo',d:null,ms:null};
  if(i<=4){show('p-quality',false);$('#retake').hidden=true;$('#useany').hidden=true;$('#q-sum').textContent='';S.box=null;S.metrics=null;S.override=false;}
  if(i<=5){show('p-feat',false);S.emb=null;$('#enroll').disabled=true;$('#enroll-msg').textContent='Available once a photo has been processed.';}
  if(i<=7){show('p-loc',false);stopClock();S.ts=null;S.loc=null;$('#lock').disabled=false;$('#lat').disabled=false;$('#lon').disabled=false;$('#loc-msg').textContent='';}
  if(i<=8){show('p-send',false);$('#log').innerHTML='';$('#result').hidden=true;$('#req-d').hidden=true;$('#again').hidden=true;$('#send').disabled=false;}
  renderSteps();
}

/* ---------- step 2: SOS ---------- */
$('#sos').addEventListener('click',function(){
  ok(1,'SOS scan started');
  show('p-hero',false);
  act(2);ok(2,'Capture panel is open');
  act(3,'Waiting for a photo');
  reveal('p-capture');
  $('#choose').focus();
});

/* ---------- step 3-4: capture ---------- */
var drop=$('#drop'),fileIn=$('#file');
$('#choose').addEventListener('click',function(){fileIn.click();});
fileIn.addEventListener('change',function(){var f=fileIn.files&&fileIn.files[0];fileIn.value='';handleFile(f);});
['dragenter','dragover'].forEach(function(n){drop.addEventListener(n,function(e){e.preventDefault();drop.classList.add('over');});});
['dragleave','drop'].forEach(function(n){drop.addEventListener(n,function(e){e.preventDefault();drop.classList.remove('over');});});
drop.addEventListener('drop',function(e){var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];handleFile(f);});
window.addEventListener('dragover',function(e){e.preventDefault();});
window.addEventListener('drop',function(e){e.preventDefault();});
document.addEventListener('paste',function(e){
  if($('#p-capture').hidden)return;
  var items=Array.prototype.slice.call((e.clipboardData&&e.clipboardData.items)||[]);
  var it=items.filter(function(i){return i.type.indexOf('image/')===0;})[0];
  if(it)handleFile(it.getAsFile());
});

async function handleFile(f){
  var msg=$('#drop-msg');msg.textContent='';
  if(!f)return;
  if(!/^image\//.test(f.type||'')){msg.textContent='That file is not an image. Choose a JPG, PNG or WebP photo.';return;}
  if(f.size>25*1024*1024){msg.textContent='That photo is over 25 MB. Choose a smaller one.';return;}
  var bmp;
  try{bmp=await createImageBitmap(f);}catch(e){msg.textContent='This browser could not open that image. Try a JPG or PNG.';return;}
  resetFrom(3);
  S.bmp=bmp;
  ok(3,bmp.width+'×'+bmp.height+' photo captured');
  reveal('p-quality');
  act(4,'Measuring');
  await tick(80);
  runQuality();
}


/* ---------- webcam ---------- */
var camStream=null;
function stopCam(){if(camStream){camStream.getTracks().forEach(function(t){t.stop();});camStream=null;}$('#camwrap').hidden=true;}
$('#cam').addEventListener('click',async function(){
  var msg=$('#drop-msg');msg.textContent='';
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){msg.textContent='This browser has no camera access here. Choose a photo file instead.';return;}
  try{
    camStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:false});
    $('#video').srcObject=camStream;$('#camwrap').hidden=false;
  }catch(e){msg.textContent='Camera blocked or not found. Allow camera access, or choose a photo file.';}
});
$('#snap').addEventListener('click',function(){
  var v=$('#video');if(!v.videoWidth){$('#drop-msg').textContent='Camera is still starting. Try again in a second.';return;}
  var c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);
  c.toBlob(function(b){stopCam();handleFile(b);},'image/jpeg',0.92);
});
$('#camoff').addEventListener('click',stopCam);

/* ---------- step 5: quality ---------- */
function gray(img){
  var d=img.data,n=img.width*img.height,g=new Float32Array(n);
  for(var i=0;i<n;i++)g[i]=0.299*d[4*i]+0.587*d[4*i+1]+0.114*d[4*i+2];
  return g;
}
var WORD={ok:'Pass',warn:'Check',bad:'Fail',na:'Not checked'};
async function runQuality(){
  var bmp=S.bmp,max=512,sc=Math.min(1,max/Math.max(bmp.width,bmp.height));
  var w=Math.max(1,Math.round(bmp.width*sc)),h=Math.max(1,Math.round(bmp.height*sc));
  var c=$('#photo');c.width=w;c.height=h;
  var x=c.getContext('2d',{willReadFrequently:true});x.drawImage(bmp,0,0,w,h);
  var g=gray(x.getImageData(0,0,w,h)),n=g.length,i,y,xx;
  var sum=0;for(i=0;i<n;i++)sum+=g[i];
  var mean=sum/n,vs=0;for(i=0;i<n;i++){var dv=g[i]-mean;vs+=dv*dv;}
  var sd=Math.sqrt(vs/n);
  var ls=0,lss=0,cnt=0;
  for(y=1;y<h-1;y++)for(xx=1;xx<w-1;xx++){var k=y*w+xx,l=4*g[k]-g[k-1]-g[k+1]-g[k-w]-g[k+w];ls+=l;lss+=l*l;cnt++;}
  var lv=cnt?lss/cnt-Math.pow(ls/cnt,2):0;
  var minSide=Math.min(bmp.width,bmp.height);
  var faces=null;
  if('FaceDetector' in window){
    try{faces=await new window.FaceDetector({fastMode:true,maxDetectedFaces:5}).detect(c);}catch(e){faces=null;}
  }
  var checks=[];
  checks.push({label:'Resolution',value:minSide+' px short side',level:minSide<240?'bad':minSide<400?'warn':'ok',
    note:minSide<240?'Too small to read facial detail. Use a larger photo.':minSide<400?'Usable, but a larger photo is better.':'Enough detail.'});
  var lightLvl=mean<45||mean>215?'bad':mean<70||mean>195?'warn':'ok';
  checks.push({label:'Lighting',value:'mean '+Math.round(mean)+' / 255',level:lightLvl,
    note:mean<70?'Too dark. Add light or use the flash.':mean>195?'Too bright. Move out of direct light.':'Even exposure.'});
  checks.push({label:'Contrast',value:'spread '+Math.round(sd),level:sd<15?'bad':sd<30?'warn':'ok',
    note:sd<30?'Flat image. Check for glare, fog or a covered lens.':'Good tonal range.'});
  checks.push({label:'Sharpness',value:'score '+Math.round(lv),level:lv<15?'bad':lv<40?'warn':'ok',
    note:lv<40?'Looks blurry. Hold steady and retake.':'Edges are crisp.'});
  var faceStatus='not_checked';
  if(faces===null){
    checks.push({label:'Face present',value:'not checked',level:'na',note:'This browser has no built-in face detector, so only image quality was checked.'});
  }else if(!faces.length){
    faceStatus='none';
    checks.push({label:'Face present',value:'none found',level:'bad',note:'No face in the photo. Center the face and retake.'});
  }else{
    var big=faces.slice().sort(function(a,b){return b.boundingBox.width*b.boundingBox.height-a.boundingBox.width*a.boundingBox.height;})[0];
    var bb=big.boundingBox;S.box={x:bb.x,y:bb.y,width:bb.width,height:bb.height};
    var frac=bb.width/w;faceStatus=faces.length>1?'multiple':'one';
    var lvl=frac<0.15||faces.length>1?'warn':'ok';
    checks.push({label:'Face present',value:faces.length+' found, '+Math.round(frac*100)+'% of width',level:lvl,
      note:faces.length>1?'Several faces. The largest one is used.':frac<0.15?'Face is small in the frame. Move closer.':'Face found and centered for the crop.'});
  }
  S.metrics={mean:mean,sd:sd,lv:lv,minSide:minSide,faceStatus:faceStatus};
  var ul=$('#checks');ul.innerHTML='';
  checks.forEach(function(ch){
    var li=el('li','lvl-'+ch.level);
    li.append(el('span','dot'));
    var m=el('div');m.append(el('span',null,ch.label+' '),el('span','cv',ch.value));
    li.append(m,el('span','vd',WORD[ch.level]),el('div','cn',ch.note));
    ul.append(li);
  });
  var fails=checks.filter(function(c){return c.level==='bad';}),warns=checks.filter(function(c){return c.level==='warn';});
  var sum$=$('#q-sum');
  if(fails.length){
    sum$.textContent='Quality check failed: '+fails.map(function(c){return c.label.toLowerCase();}).join(', ')+'.';
    bad(4,'Failed: '+fails.map(function(c){return c.label.toLowerCase();}).join(', '));
    $('#retake').hidden=false;$('#useany').hidden=false;
    return;
  }
  sum$.textContent=warns.length?'Passed with warnings. Scan will continue.':'Passed. Scan will continue.';
  ok(4,warns.length?'Passed with warnings':'Passed');
  toFeatures();
}
$('#retake').addEventListener('click',function(){
  resetFrom(3);act(3,'Waiting for a photo');$('#choose').focus();$('#p-capture').scrollIntoView({block:'nearest'});
});
$('#useany').addEventListener('click',function(){
  S.override=true;$('#retake').hidden=true;$('#useany').hidden=true;
  ok(4,'Used despite failures');toFeatures();
});

/* ---------- steps 6-7: features and embedding ---------- */
function hexA(hex,a){
  hex=(hex||'#D6311C').trim().replace('#','');
  if(hex.length===3)hex=hex.split('').map(function(c){return c+c;}).join('');
  var n=parseInt(hex,16);return 'rgba('+(n>>16&255)+','+(n>>8&255)+','+(n&255)+','+a+')';
}
function computeFeatures(){
  var c=$('#photo'),w=c.width,h=c.height,sw,sx,sy;
  if(S.box){sw=Math.max(S.box.width,S.box.height)*1.4;sx=S.box.x+S.box.width/2-sw/2;sy=S.box.y+S.box.height/2-sw/2;}
  else{sw=Math.min(w,h)*0.8;sx=(w-sw)/2;sy=(h-sw)/2;}
  sw=Math.min(sw,w,h);sx=Math.max(0,Math.min(sx,w-sw));sy=Math.max(0,Math.min(sy,h-sw));
  var t=document.createElement('canvas');t.width=t.height=64;
  var tx=t.getContext('2d',{willReadFrequently:true});tx.drawImage(c,sx,sy,sw,sw,0,0,64,64);
  var g=gray(tx.getImageData(0,0,64,64)),hist=new Float32Array(128),energy=new Float32Array(16);
  for(var y=1;y<63;y++)for(var x=1;x<63;x++){
    var i=y*64+x,gx=g[i+1]-g[i-1],gy=g[i+64]-g[i-64],mag=Math.sqrt(gx*gx+gy*gy);
    var ang=Math.atan2(gy,gx),bin=Math.floor((ang+Math.PI)/(2*Math.PI)*8)%8;
    var cell=Math.floor(y/16)*4+Math.floor(x/16);
    hist[cell*8+bin]+=mag;energy[cell]+=mag;
  }
  var v=new Float32Array(128),mean=0,k;
  for(k=0;k<128;k++){v[k]=Math.sqrt(hist[k]);mean+=v[k];}
  mean/=128;var norm=0;
  for(k=0;k<128;k++){v[k]-=mean;norm+=v[k]*v[k];}
  norm=Math.sqrt(norm);
  if(norm<1e-6)return null;
  for(k=0;k<128;k++)v[k]/=norm;
  drawMap(t,hist,energy);
  return Array.prototype.slice.call(v);
}
function drawMap(t,hist,energy){
  var f=$('#fmap'),x=f.getContext('2d'),accent=getComputedStyle(document.documentElement).getPropertyValue('--accent');
  x.imageSmoothingEnabled=true;x.clearRect(0,0,256,256);x.drawImage(t,0,0,256,256);
  var maxE=Math.max.apply(null,Array.prototype.slice.call(energy))||1,cell,b;
  for(cell=0;cell<16;cell++){
    var cx=(cell%4)*64,cy=Math.floor(cell/4)*64;
    x.fillStyle=hexA(accent,0.5*energy[cell]/maxE);x.fillRect(cx,cy,64,64);
    var mh=0;for(b=0;b<8;b++)mh=Math.max(mh,hist[cell*8+b]);mh=mh||1;
    var mx=cx+32,my=cy+32;
    [[3,'rgba(0,0,0,0.55)'],[1.5,'#fff']].forEach(function(s){
      x.lineWidth=s[0];x.strokeStyle=s[1];x.beginPath();
      for(var q=0;q<8;q++){var a=(q+0.5)/8*2*Math.PI-Math.PI,len=hist[cell*8+q]/mh*26;x.moveTo(mx,my);x.lineTo(mx+len*Math.cos(a),my+len*Math.sin(a));}
      x.stroke();
    });
  }
  x.lineWidth=1;x.strokeStyle='rgba(255,255,255,0.55)';x.beginPath();
  for(var l=1;l<4;l++){x.moveTo(l*64,0);x.lineTo(l*64,256);x.moveTo(0,l*64);x.lineTo(256,l*64);}
  x.stroke();
}
function drawBars(v){
  var box=$('#bars');box.innerHTML='';
  var mn=Math.min.apply(null,v),mx=Math.max.apply(null,v),r=(mx-mn)||1;
  v.forEach(function(val){var i=document.createElement('i');i.style.height=(4+96*(val-mn)/r)+'%';box.append(i);});
}
async function toFeatures(){
  act(5,'Reading edge directions');
  reveal('p-feat');
  await tick(300);
  var vec=computeFeatures();
  if(!vec){
    bad(5,'No edges found in the crop');
    $('#q-sum').textContent='The photo has no usable detail. Retake it.';
    $('#retake').hidden=false;
    return;
  }
  ok(5,'16 cells × 8 directions');
  act(6,'Normalizing');
  await tick(240);
  S.emb=vec;drawBars(vec);
  var nrm=Math.sqrt(vec.reduce(function(a,b){return a+b*b;},0));
  $('#e-stats').textContent='dim 128 · L2 norm '+nrm.toFixed(3)+' · first six: '+vec.slice(0,6).map(function(q){return q.toFixed(3);}).join(', ');
  ok(6,'128 values, unit length');
  $('#enroll').disabled=false;$('#enroll-msg').textContent='Enroll this scan as a demo patient, then scan the same photo again to test matching.';
  act(7,'Waiting for you to lock time and location');
  reveal('p-loc');startClock();
}

/* ---------- step 8: location and time ---------- */
function fmtTime(d){return d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'medium'});}
function paintClock(d){$('#clock').textContent=fmtTime(d);$('#clock-iso').textContent=d.toISOString()+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone;}
function startClock(){stopClock();paintClock(new Date());S.clock=setInterval(function(){paintClock(new Date());},1000);}
function stopClock(){if(S.clock){clearInterval(S.clock);S.clock=null;}}
$('#lat').addEventListener('input',function(){S.src='manual';});
$('#lon').addEventListener('input',function(){S.src='manual';});
$('#geo').addEventListener('click',function(){
  var m=$('#loc-msg');
  var fail=function(){m.textContent='This preview blocks device location. Type the coordinates instead.';};
  if(!navigator.geolocation){fail();return;}
  m.textContent='Asking the browser for your location…';
  try{
    navigator.geolocation.getCurrentPosition(function(p){
      $('#lat').value=p.coords.latitude.toFixed(5);$('#lon').value=p.coords.longitude.toFixed(5);S.src='device';
      m.textContent='Location set from the device, accurate to about '+Math.round(p.coords.accuracy)+' m.';
    },fail,{timeout:8000,maximumAge:60000});
  }catch(e){fail();}
});
function coord(v,min,max){v=v.trim();if(v==='')return null;var n=Number(v);return(!isFinite(n)||n<min||n>max)?NaN:n;}
$('#lock').addEventListener('click',function(){
  var la=coord($('#lat').value,-90,90),lo=coord($('#lon').value,-180,180),m=$('#loc-msg');
  if((la!==la)||(lo!==lo)||((la===null)!==(lo===null))){
    m.textContent='Enter a latitude from -90 to 90 and a longitude from -180 to 180, or leave both empty.';return;
  }
  S.ts=new Date();stopClock();paintClock(S.ts);
  S.loc=la===null?null:{lat:la,lon:lo,source:S.src};
  $('#lock').disabled=true;$('#lat').disabled=true;$('#lon').disabled=true;
  m.textContent=S.loc?'Locked.':'Locked without a location. The request will go without GPS.';
  ok(7,S.loc?la.toFixed(4)+', '+lo.toFixed(4)+' at '+S.ts.toLocaleTimeString():'Time locked, no location');
  act(8,'Ready to send');
  reveal('p-send');
  $('#send').focus();
});

/* ---------- step 9: secure request and mock backend ---------- */
var recs=[];
function loadRecs(){try{var r=JSON.parse(localStorage.getItem('mrai_records_v1')||'[]');if(Array.isArray(r))recs=r;}catch(e){}}
function saveRecs(){try{localStorage.setItem('mrai_records_v1',JSON.stringify(recs));}catch(e){}}
function renderRecs(){
  var ul=$('#recs');ul.innerHTML='';$('#rec-n').textContent=String(recs.length);
  if(!recs.length){ul.append(el('li','empty','No records yet. Capture a photo, wait for the embedding, then enroll it here.'));return;}
  recs.forEach(function(r){
    var li=document.createElement('li');
    var box=el('div');box.append(el('div','rn',r.name),el('div','rm',r.blood+(r.contact?' · '+r.contact:'')));
    var b=el('button','btn ghost sm','Remove');b.type='button';b.setAttribute('aria-label','Remove '+r.name);
    b.addEventListener('click',function(){recs=recs.filter(function(q){return q.id!==r.id;});saveRecs();renderRecs();});
    li.append(box,b);ul.append(li);
  });
}
$('#enroll-form').addEventListener('submit',function(e){
  e.preventDefault();
  var msg=$('#enroll-msg'),name=$('#name').value.trim();
  if(!S.emb){msg.textContent='Capture and process a photo first.';return;}
  if(!name){msg.textContent='Enter a name.';return;}
  recs.push({id:(crypto.randomUUID?crypto.randomUUID():String(Date.now())),name:name,blood:$('#blood').value,notes:$('#notes').value.trim(),contact:$('#contact').value.trim(),emb:S.emb.map(function(v){return +v.toFixed(5);}),created:Date.now()});
  saveRecs();renderRecs();
  $('#name').value='';$('#notes').value='';$('#contact').value='';$('#blood').value='Unknown';
  msg.textContent='Enrolled '+name+'. Use Scan another person and load the same photo to test a match.';
});
function addLog(t){$('#log').append(el('li',null,'✓ '+t));}
function hex(u8,n){return Array.prototype.slice.call(u8,0,n).map(function(b){return b.toString(16).padStart(2,'0');}).join('');}
function matchRecs(v){
  var best=null;
  recs.forEach(function(r){var s=0;for(var i=0;i<128;i++)s+=v[i]*r.emb[i];if(!best||s>best.s)best={s:s,r:r};});
  return best;
}
function dlRow(dl,k,v){dl.append(el('dt',null,k),el('dd',null,v));}
function renderResult(best){
  var box=$('#result');box.innerHTML='';box.hidden=false;
  var cls,title,sim=best?best.s:0;
  if(!best){cls='none';title='No records to compare';}
  else if(sim>=0.9){cls='ok';title='Match found';}
  else if(sim>=0.75){cls='warn';title='Possible match, confirm in person';}
  else{cls='none';title='No match';}
  box.className='result '+cls;
  box.append(el('h3',null,title));
  if(!best){box.append(el('p',null,'The demo database is empty. Enroll a record below, then scan the same photo again.'));return title;}
  var dl=document.createElement('dl');
  dlRow(dl,'Similarity',sim.toFixed(3)+' (match at 0.90 or higher)');
  if(cls!=='none'){
    dlRow(dl,'Name',best.r.name);dlRow(dl,'Blood group',best.r.blood);
    dlRow(dl,'Allergies and notes',best.r.notes||'None recorded');
    dlRow(dl,'Emergency contact',best.r.contact||'None recorded');
  }else{
    dl.append(el('dt',null,'Result'),el('dd',null,'The closest record scored below 0.75, so no details are shown.'));
  }
  box.append(dl);
  return title;
}
$('#send').addEventListener('click',async function(){
  var btn=$('#send');btn.disabled=true;$('#log').innerHTML='';$('#result').hidden=true;$('#req-d').hidden=true;$('#again').hidden=true;
  act(8,'Encrypting and sending');
  try{
    var m=S.metrics;
    var payload={
      request_id:(crypto.randomUUID?crypto.randomUUID():String(Date.now())),schema:1,
      captured_at:S.ts.toISOString(),time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,
      location:S.loc,
      embedding:{model:'demo-gradient-histogram-128',dim:128,values:S.emb.map(function(v){return +v.toFixed(4);})},
      quality:{min_side_px:m.minSide,brightness:Math.round(m.mean),contrast:Math.round(m.sd),sharpness:Math.round(m.lv),face_check:m.faceStatus,used_despite_failures:S.override}
    };
    var json=JSON.stringify(payload);
    addLog('Payload built, '+(json.length/1024).toFixed(1)+' KB, no photo inside');await tick(220);
    var key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
    var iv=crypto.getRandomValues(new Uint8Array(12));
    var ct=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},key,new TextEncoder().encode(json));
    addLog('Encrypted with AES-256-GCM, '+(ct.byteLength/1024).toFixed(1)+' KB, starts '+hex(new Uint8Array(ct),6));await tick(220);
    var dig=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',ct)),32);
    addLog('SHA-256 of ciphertext '+dig.slice(0,16)+'…');await tick(220);
    var back=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:iv},key,ct)));
    addLog('Backend decrypted and verified the request');await tick(220);
    var best=recs.length?matchRecs(back.embedding.values):null;
    addLog('Compared with '+recs.length+' record'+(recs.length===1?'':'s'));
    var title=renderResult(best);
    var pretty=JSON.stringify(payload,null,2).replace(/\[\s+([-\d.,e\s]+?)\s+\]/g,function(a,b){return '['+b.replace(/\s+/g,' ')+']';});
    $('#req').textContent=pretty;$('#req-d').hidden=false;$('#copy').dataset.json=json;
    $('#again').hidden=false;
    ok(8,title);
    $('#result').scrollIntoView({block:'nearest'});
  }catch(e){
    bad(8,'Send failed: '+((e&&e.message)||'unknown error'));
    addLog('Failed. Try again.');btn.disabled=false;
  }
});
$('#copy').addEventListener('click',function(){
  var b=$('#copy'),txt=b.dataset.json||'';
  var fallback=function(){var r=document.createRange();r.selectNodeContents($('#req'));var s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent='Selected, press Ctrl+C';};
  try{navigator.clipboard.writeText(txt).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy JSON';},1500);},fallback);}catch(e){fallback();}
});
$('#again').addEventListener('click',function(){
  resetFrom(1);S.bmp=null;
  show('p-capture',false);show('p-hero',true);
  act(1,'Press the red button to begin');
  $('#drop-msg').textContent='';
  $('#sos').focus();window.scrollTo(0,0);
});

/* ---------- init ---------- */
loadRecs();renderRecs();
st[0]={s:'done',d:'App is ready',ms:null};
act(1,'Press the red button to begin');
})();
