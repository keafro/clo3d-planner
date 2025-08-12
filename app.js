/* CLO3D Pro AI — Kianoush — v2.0
 * امنیت: AES-GCM + PBKDF2(300k) + قفل ۵ تلاش + تاخیر افزایشی
 * PIN پیش‌فرض: 4068 (بعد از ورود عوضش کن)
 */
(async function(){
  // ====== Config ======
  const DEFAULT_PIN = '4068';
  const STORAGE_CIPHER_KEY = 'clo3d_ai_cipher_v2';
  const PBKDF2_ITER = 300000; // 300k
  const THEME_AUTO_DAY = { start:7, end:19 };
  const IDLE_MINUTES = 6;
  const WEEKLY_TARGET = 5;
  const REVIEW_OFFSETS = [1,3,7,14,30];
  const LOCK_MAX_TRIES = 5;

  // Worker (اختیاری). اگر Worker نداری، خالی بگذار تا از data/ خوانده شود.
  const WORKER_BASE = ""; // مثل: "https://YOUR_WORKER_SUBDOMAIN.workers.dev"

  // ====== Utils ======
  const $ = s=>document.querySelector(s);
  const pad=n=>String(n).padStart(2,'0');
  const toISO = d => new Date(d.getFullYear(),d.getMonth(),d.getDate()).toISOString().slice(0,10);
  const today = new Date();
  function normalizePin(pinRaw){
    const map={'۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9','٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'};
    return (pinRaw||'').split('').map(ch=> map[ch] ?? ch).join('').replace(/\s+/g,'');
  }

  // ====== Crypto (WebCrypto) ======
  async function getKeyFromPin(pin, salt){
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      {name:'PBKDF2', salt, iterations: PBKDF2_ITER, hash:'SHA-256'},
      baseKey,
      {name:'AES-GCM', length:256},
      false,
      ['encrypt','decrypt']
    );
  }
  async function encryptJSON(obj, pin){
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const key  = await getKeyFromPin(pin, salt);
    const data = enc.encode(JSON.stringify(obj));
    const ct   = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data);
    const payload = { iv: btoa(String.fromCharCode(...iv)), salt: btoa(String.fromCharCode(...salt)), data: btoa(String.fromCharCode(...new Uint8Array(ct))) };
    return JSON.stringify(payload);
  }
  async function decryptJSON(cipherText, pin){
    const dec = new TextDecoder();
    const payload = JSON.parse(cipherText);
    const iv = new Uint8Array([...atob(payload.iv)].map(c=>c.charCodeAt(0)));
    const salt = new Uint8Array([...atob(payload.salt)].map(c=>c.charCodeAt(0)));
    const ct = new Uint8Array([...atob(payload.data)].map(c=>c.charCodeAt(0)));
    const key = await getKeyFromPin(pin, salt);
    const pt  = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct);
    return JSON.parse(dec.decode(pt));
  }

  // ====== Models ======
  const DEFAULT_TASKS = [
    { key:'watch',    title:'تماشای کامل ویدئو (35min)', start:'', end:'', status:'not_started', note:'' },
    { key:'watch_do', title:'تماشا + اجرا همزمان (45min)', start:'', end:'', status:'not_started', note:'' },
    { key:'do_alone', title:'اجرای بدون ویدئو (30–40min)', start:'', end:'', status:'not_started', note:'' }
  ];
  const TEMPLATES = {
    learn: n => [
      { key:'watch',    title:`تماشای جلسه ${n||''} (35min)`.trim(), start:'', end:'', status:'not_started', note:'' },
      { key:'watch_do', title:`همراه اجرا جلسه ${n||''} (45min)`.trim(), start:'', end:'', status:'not_started', note:'' },
      { key:'do_alone', title:`اجرای مستقل جلسه ${n||''} (30–40min)`.trim(), start:'', end:'', status:'not_started', note:'' },
    ],
    produce: ()=> [
      { key:'produce1', title:'ساخت لباس کامل از صفر (60–90min)', start:'', end:'', status:'not_started', note:'' },
      { key:'render',   title:'رندر + متریال (30–45min)',          start:'', end:'', status:'not_started', note:'' },
      { key:'publish',  title:'انتشار ArtStation/LinkedIn (15min)',start:'', end:'', status:'not_started', note:'' },
    ],
    review: ()=> [
      { key:'fix',     title:'مرور و رفع اشکال دو کار اخیر (40min)', start:'', end:'', status:'not_started', note:'' },
      { key:'texture', title:'تمرین متریال/تکسچر (30min)',            start:'', end:'', status:'not_started', note:'' },
      { key:'notes',   title:'ثبت نکات و چک‌لیست هفته (15min)',       start:'', end:'', status:'not_started', note:'' },
    ]
  };
  const SCIENCE_QUOTES = [
    "مرور فاصله‌مند: 1/3/7/14/30 روز—به جای مرور فشرده، پایداری حافظه بالاتر می‌رود.",
    "برای Flow چالش را ~5٪ بالاتر از مهارت فعلی انتخاب کن.",
    "قصد اجرایی: اگر ساعت 22 شد، جلسه بعد را شروع می‌کنم.",
    "بعد از هر جلسه 3 نکته بنویس؛ بازخورد فوری انگیزه را بالا می‌برد.",
    "۲ دقیقه شروع کن—شروع کوچک مقاومت ذهنی را می‌شکند."
  ];

  function makeStore(){
    const start = new Date(); start.setHours(0,0,0,0);
    const days = {};
    for(let i=0;i<180;i++){
      const d = new Date(start); d.setDate(start.getDate()+i);
      const key = toISO(d);
      days[key] = { date:key, tasks: DEFAULT_TASKS.map(t=>({...t})), custom:[], note:'', logs:[], reviews:[] };
    }
    return {
      version:2,
      start: toISO(start),
      settings: { pin: DEFAULT_PIN, theme:'auto', weeklyTarget: WEEKLY_TARGET },
      lock: { tries:0, nextAt:0 },
      days
    };
  }

  // ====== Secure Storage ======
  let store=null, currentPin=null;
  async function loadVault(pin){
    const cipher = localStorage.getItem(STORAGE_CIPHER_KEY);
    if(!cipher){ store = makeStore(); currentPin = pin || DEFAULT_PIN; await saveVault(); return true; }
    try{ store = await decryptJSON(cipher, pin); currentPin=pin; return true; }catch(e){ return false; }
  }
  async function saveVault(){
    const cipher = await encryptJSON(store, currentPin || DEFAULT_PIN);
    localStorage.setItem(STORAGE_CIPHER_KEY, cipher);
  }
  async function resetVault(){ localStorage.removeItem(STORAGE_CIPHER_KEY); }

  // ====== DOM refs ======
  const todayLabel = $('#todayLabel');
  const selectedDate = $('#selectedDate');
  const mainTasks = $('#mainTasks');
  const taskList = $('#taskList');
  const dayNote = $('#dayNote');
  const saveNoteBtn = $('#saveNoteBtn');
  const addCustomBtn = $('#addCustomBtn');
  const customTitle = $('#customTitle');
  const customStart = $('#customStart');
  const historyEl = $('#history');
  const exportCsvBtn = $('#exportCsvBtn');
  const backupBtn = $('#backupBtn');
  const importBtn = $('#importBtn');
  const importFile = $('#importFile');
  const searchNotesBtn = $('#searchNotesBtn');
  const themeToggle = $('#themeToggle');
  const quickPom = $('#quickPom');
  const quickAdd = $('#quickAdd');
  // lock
  const lockOverlay = $('#lockOverlay');
  const unlockBtn = $('#unlockBtn');
  const pinInput = $('#pinInput');
  const resetVaultBtn = $('#resetVaultBtn');
  const lockMsg = $('#lockMsg');
  // pomodoro
  const pomStart = $('#pomStart');
  const pomPause = $('#pomPause');
  const pomReset = $('#pomReset');
  const pomTimer = $('#pomTimer');
  const pomStateEl = $('#pomState');
  const pomCycles = $('#pomCycles');
  const pomWork = $('#pomWork');
  const pomShort = $('#pomShort');
  const pomLong = $('#pomLong');
  const focusState = $('#focusState');
  // stats/review/science/agent
  const chartCanvas = $('#progressChart'); const chartCtx = chartCanvas.getContext('2d');
  const statsSummary = $('#statsSummary'); const streakDays = $('#streakDays'); const weeklyGoalText = $('#weeklyGoalText');
  const recalcStats = $('#recalcStats'); const enableNoti = $('#enableNoti');
  const reviewList = $('#reviewList'); const scienceMsg = $('#scienceMsg'); const agentBox = $('#agentBox');
  // security
  const changePinBtn = $('#changePinBtn'); const newPin = $('#newPin');

  // ====== Theme ======
  function applyAutoTheme(){
    const hr = new Date().getHours();
    const light = hr>=THEME_AUTO_DAY.start && hr<THEME_AUTO_DAY.end;
    document.body.classList.toggle('light', light);
  }
  function setTheme(mode){ if(mode==='auto') applyAutoTheme(); else document.body.classList.toggle('light', mode==='light'); }

  // ====== App State ======
  let currentDate = toISO(new Date());
  let pom = { interval:null, remaining:0, mode:'work', running:false, completed:0 };
  let lastActivityTS = Date.now();

  // Idle detector
  ['mousemove','keydown','click','touchstart'].forEach(evt=> document.addEventListener(evt,()=> lastActivityTS=Date.now()));
  setInterval(()=> { const mins=(Date.now()-lastActivityTS)/60000; if(mins>=IDLE_MINUTES) notify('وقفه طولانی شد','اگر آماده‌ای ۲ دقیقه شروع کن.'); }, 60000);

  // Notifications
  async function askNoti(){ try{ const p=await Notification.requestPermission(); return p==='granted'; }catch(e){ return false; } }
  function notify(title, body){ if('Notification' in window && Notification.permission==='granted'){ new Notification(title,{body}); } }

  // Logs
  function addLog(text, meta=null, when=null){ const day=ensureDay(currentDate); const time = when || (new Date()).toLocaleTimeString('fa-IR'); day.logs.push({ text, time, meta: meta? (meta.title||''): '' }); saveVault(); }

  // Days
  function ensureDay(dateStr){ if(!store.days[dateStr]) store.days[dateStr] = { date:dateStr, tasks: DEFAULT_TASKS.map(t=>({...t})), custom:[], note:'', logs:[], reviews:[] }; return store.days[dateStr]; }

  // Status visuals
  function iconFor(st){ return st==='done'?'✅':st==='in_progress'?'🟡':st==='skipped'?'⏭️':'🟥'; }
  function statusPill(st){ if(st==='done')return `<span class="status-pill st-done">انجام‌شده</span>`; if(st==='in_progress')return `<span class="status-pill st-prog">درحال انجام</span>`; if(st==='skipped')return `<span class="status-pill st-skip">کنار گذاشته</span>`; return `<span class="status-pill st-not">انجام‌نشده</span>`; }

  // Render
  function renderDay(dateStr){
    currentDate = dateStr; selectedDate.value=dateStr;
    const day = ensureDay(dateStr);
    $('#dayTitle').textContent = `برنامه روز — ${dateStr}`;
    todayLabel.textContent = toISO(new Date());

    mainTasks.innerHTML=''; day.tasks.forEach((t,idx)=> mainTasks.appendChild(createTaskEditor(day,t,idx)));
    taskList.innerHTML=''; const all = day.tasks.concat(day.custom||[]);
    all.forEach((t,i)=>{
      const el=document.createElement('div'); el.className='task';
      el.innerHTML = `
        <div class="left">
          <div><strong>${iconFor(t.status)} ${t.title}</strong></div>
          <div class="small muted">${statusPill(t.status)} · ${t.start||''}${t.end? ' → '+t.end : ''}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
          <select class="statusSelect">
            <option value="not_started">انجام‌نشده</option>
            <option value="in_progress">درحال انجام</option>
            <option value="done">انجام‌شده</option>
            <option value="skipped">کنار گذاشته</option>
          </select>
          ${i>=day.tasks.length?'<button class="ghost removeBtn">حذف</button>':''}
        </div>`;
      const sel=el.querySelector('.statusSelect'); sel.value=t.status||'not_started';
      sel.addEventListener('change', e=>{ t.status=e.target.value; if(t.status==='done'){ addLog(`${t.title} — انجام شد`); maybeScheduleReviewsFromTitle(t.title); } saveAll(true); });
      const rm=el.querySelector('.removeBtn'); if(rm){ rm.addEventListener('click',()=>{ if(confirm('حذف؟')){ day.custom.splice(i-day.tasks.length,1); saveAll(true); } }); }
      taskList.appendChild(el);
    });

    dayNote.value = day.note||'';
    renderLogs(day.logs||[]);
    drawChart(); updateStreakAndWeekly();
    renderReviewsDue();
    scienceMsg.textContent = SCIENCE_QUOTES[(Math.floor(Date.now()/86400000) % SCIENCE_QUOTES.length)];
  }

  function createTaskEditor(day,t,idx){
    const row=document.createElement('div'); row.className='task';
    row.innerHTML=`
      <div class="left">
        <div><strong>${iconFor(t.status)} ${t.title}</strong></div>
        <div class="small muted">شروع: <input class="startInput input smallInput" data-idx="${idx}" type="time" value="${t.start||''}"></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
        <input class="endInput input smallInput" data-idx="${idx}" placeholder="پایان (مثال: 22:10)" value="${t.end||''}">
        <select class="statusSelect input smallInput" data-idx="${idx}">
          <option value="not_started">انجام‌نشده</option>
          <option value="in_progress">درحال انجام</option>
          <option value="done">انجام‌شده</option>
          <option value="skipped">کنار گذاشته</option>
        </select>
        <button class="ghost editBtn">ویرایش عنوان</button>
      </div>`;
    const sel=row.querySelector('.statusSelect'); sel.value=t.status||'not_started';
    sel.addEventListener('change',e=>{ t.status=e.target.value; if(t.status==='done'){ addLog(`${t.title} — انجام شد`); maybeScheduleReviewsFromTitle(t.title); } saveAll(true); });
    row.querySelector('.startInput').addEventListener('change',e=>{ t.start=e.target.value; addLog(`${t.title} — شروع ${t.start}`); saveAll(true); });
    row.querySelector('.endInput').addEventListener('blur',e=>{ t.end=e.target.value; if(t.end) addLog(`${t.title} — پایان ${t.end}`); saveAll(true); });
    row.querySelector('.editBtn').addEventListener('click',()=>{ const n=prompt('عنوان جدید:', t.title); if(n!==null){ t.title=n; saveAll(true); } });
    return row;
  }

  function renderLogs(logs){
    historyEl.innerHTML=''; if(!logs||logs.length===0){ historyEl.innerHTML='<li class="historyItem muted">لاگی ثبت نشده</li>'; return; }
    logs.slice().reverse().forEach(l=>{ const li=document.createElement('li'); li.className='historyItem'; li.innerHTML=`<div><strong>${l.text}</strong></div><div class="small muted">${l.time} · ${l.meta||''}</div>`; historyEl.appendChild(li); });
  }

  // Templates
  $('#applyTemplate').addEventListener('click', ()=>{ const key=$('#templateSelect').value; const sn=$('#templateSession').value.trim(); const day=ensureDay(currentDate); day.tasks = (TEMPLATES[key]||(()=>DEFAULT_TASKS))(sn); addLog(`قالب روز: ${key}${sn? ' #'+sn:''}`); saveAll(true); });

  // Notes/Custom/Logs
  saveNoteBtn.addEventListener('click', ()=>{ const d=ensureDay(currentDate); d.note=dayNote.value; saveAll(true); alert('یادداشت ذخیره شد'); });
  addCustomBtn.addEventListener('click', ()=>{ const title=customTitle.value.trim(); if(!title) return alert('عنوان وارد کن'); const start=customStart.value||''; const d=ensureDay(currentDate); d.custom.push({ key:'custom_'+Date.now(), title, start, end:'', status:'not_started', note:'' }); customTitle.value=''; customStart.value=''; saveAll(true); });
  $('#addManualLog').addEventListener('click', ()=>{ const t=$('#manualTime').value || (new Date()).toLocaleTimeString('fa-IR'); const txt=$('#manualText').value.trim(); if(!txt) return alert('شرح وارد کن'); addLog(txt,null,t); $('#manualTime').value=''; $('#manualText').value=''; saveAll(true); });
  $('#searchNotesBtn').addEventListener('click', ()=>{ const q=prompt('جستجو در یادداشت/لاگ:'); if(!q) return; const res=[]; for(const d in store.days){ const day=store.days[d]; if((day.note||'').includes(q)) res.push(`${d} — NOTE: ${day.note}`); (day.logs||[]).forEach(l=>{ if(l.text.includes(q)) res.push(`${d} — LOG: ${l.text}`); }); } alert(res.length? res.slice(0,50).join('\n') : 'یافت نشد'); });

  // Pomodoro + Focus lock
  const audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  function beep(freq=880,dur=0.18){ try{ const o=audioCtx.createOscillator(), g=audioCtx.createGain(); o.type='sine'; o.frequency.value=freq; o.connect(g); g.connect(audioCtx.destination); g.gain.value=0.0001; o.start(); g.gain.exponentialRampToValueAtTime(0.08, audioCtx.currentTime+0.01); setTimeout(()=>{ g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime+0.05); o.stop(audioCtx.currentTime+0.06); }, dur*1000);}catch(e){} }
  function updatePom(){ const mm=Math.floor(pom.remaining/60), ss=pom.remaining%60; pomTimer.textContent=`${pad(mm)}:${pad(ss)}`; pomStateEl.textContent=pom.mode==='work'?'کار':(pom.mode==='short'?'استراحت کوتاه':'استراحت بلند'); pomCycles.textContent=pom.completed; focusState.textContent = pom.running? 'روشن':'خاموش'; document.querySelectorAll('button, input, select, textarea').forEach(el=>{ if(el.closest('.pomControls')) return; if(pom.running) el.disabled = el.classList.contains('btn')? false: true; else el.disabled=false; }); }
  function startPom(){ if(pom.running) return; if(pom.remaining<=0){ if(pom.mode==='work') pom.remaining=parseInt(pomWork.value||25)*60; else if(pom.mode==='short') pom.remaining=parseInt(pomShort.value||5)*60; else pom.remaining=parseInt(pomLong.value||15)*60; } pom.running=true; pom.interval=setInterval(()=>{ pom.remaining--; if(pom.remaining<=0){ clearInterval(pom.interval); pom.running=false; beep(); try{ if('Notification' in window && Notification.permission==='granted'){ const title=(pom.mode==='work')?'پایان کار 🎯':'پایان استراحت ⏱'; const body=(pom.mode==='work')?'آفرین! برو استراحت کوتاه.':'وقت کار دوباره است.'; new Notification(title,{body}); } }catch(e){} if(pom.mode==='work'){ pom.completed++; addLog('پومودورو: پایان کار'); pom.mode=(pom.completed%4===0)?'long':'short'; } else pom.mode='work'; startPom(); } updatePom(); },1000); }
  function pausePom(){ if(pom.interval) clearInterval(pom.interval); pom.running=false; pom.interval=null; updatePom(); }
  function resetPom(){ pausePom(); pom.mode='work'; pom.remaining=parseInt(pomWork.value||25)*60; pom.completed=0; updatePom(); }
  $('#pomStart').addEventListener('click', startPom); $('#pomPause').addEventListener('click', pausePom); $('#pomReset').addEventListener('click', resetPom); quickPom.addEventListener('click', startPom);

  // Reviews
  function maybeScheduleReviewsFromTitle(title){ const m=title.match(/جلسه\s+(\d+)/); if(!m) return; const n=+m[1]; REVIEW_OFFSETS.forEach(off=>{ const dt=new Date(currentDate); dt.setDate(dt.getDate()+off); const key=toISO(dt); const day=ensureDay(key); day.reviews.push({ session:n, due:key }); }); }
  function renderReviewsDue(){ const day=ensureDay(currentDate); const due=day.reviews||[]; reviewList.innerHTML = due.length? due.map(r=>`- مرور جلسه ${r.session}`).join('<br>') : '<div class="muted">مروری ثبت نشده</div>'; }

  // Stats
  function isDayDone(k){ const d=store.days[k]; if(!d) return false; const all=(d.tasks||[]).concat(d.custom||[]); return all.some(t=>t.status==='done'); }
  function calcStreak(){ let s=0; const d=new Date(); for(;;){ const k=toISO(d); if(isDayDone(k)){ s++; d.setDate(d.getDate()-1);}else break; } return s; }
  function calcWeekly(){ const now=new Date(), day=now.getDay(); const st=new Date(now); st.setDate(now.getDate()-day); let done=0; for(let i=0;i<7;i++){ const k=toISO(new Date(st.getFullYear(),st.getMonth(),st.getDate()+i)); if(isDayDone(k)) done++; } return {done,target:store.settings.weeklyTarget||WEEKLY_TARGET}; }
  function drawChart(){ const labels=[], data=[]; for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); const k=toISO(d); labels.push(k.slice(5)); const day=store.days[k]; let mins=0; if(day){ const all=(day.tasks||[]).concat(day.custom||[]); all.forEach(t=>{ if(t.start&&t.end){ const m=t.end.match(/(\d{1,2}):(\d{2})/), s=t.start.match(/(\d{1,2}):(\d{2})/); if(m&&s){ const em=+m[1]*60+ +m[2], sm=+s[1]*60+ +s[2]; if(em>sm) mins+= (em-sm); } } else { if(/35min/.test(t.title)) mins+=35; else if(/45min/.test(t.title)) mins+=45; else if(/30–40min|30-40min/.test(t.title)) mins+=35; else if(/60–90min|60-90min/.test(t.title)) mins+=75; } }); } data.push(Math.round(mins/60)); } const ctx=chartCtx; const w=chartCanvas.width=chartCanvas.clientWidth; const h=chartCanvas.height=chartCanvas.clientHeight; ctx.clearRect(0,0,w,h); ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(40,10); ctx.lineTo(40,h-20); ctx.lineTo(w-10,h-20); ctx.stroke(); const barW=(w-60)/labels.length; data.forEach((v,i)=>{ const x=45+i*barW; const barH=((h-40)*v)/6; ctx.fillStyle='rgba(124,58,237,0.9)'; ctx.fillRect(x,h-20-barH,barW*0.7,barH); ctx.fillStyle='rgba(255,255,255,0.8)'; ctx.font='12px sans-serif'; ctx.fillText(labels[i],x,h-5); ctx.fillText(v+'h',x,h-25-barH<10?10:h-25-barH); }); const avg=Math.round(data.reduce((a,b)=>a+b,0)/data.length); statsSummary.textContent=`میانگین ساعت تمرین ۷ روز: ${avg}h`; }
  function updateStreakAndWeekly(){ streakDays.textContent=calcStreak(); const w=calcWeekly(); weeklyGoalText.textContent=`${w.done}/${w.target}`; }

  // Export/Import
  exportCsvBtn.addEventListener('click', ()=>{ const rows=[['date','task','start','end','status','note','log_time','log_text']]; for(const d in store.days){ const day=store.days[d]; const all=(day.tasks||[]).concat(day.custom||[]); all.forEach(t=> rows.push([d,t.title,t.start||'',t.end||'',t.status||'',(t.note||'').replace(/[\r\n]+/g,' '),'',''])); (day.logs||[]).forEach(l=> rows.push([d,'','','','','',l.time,l.text])); } const csv=rows.map(r=> r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n'); const blob=new Blob([csv],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`clo3d_export_${toISO(new Date())}.csv`; a.click(); URL.revokeObjectURL(url); });
  backupBtn.addEventListener('click', async ()=>{ const cipher=localStorage.getItem(STORAGE_CIPHER_KEY)||''; const blob=new Blob([cipher],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`clo3d_backup_${toISO(new Date())}.json`; a.click(); URL.revokeObjectURL(url); });
  importBtn.addEventListener('click',()=> importFile.click());
  importFile.addEventListener('change', e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>{ localStorage.setItem(STORAGE_CIPHER_KEY, ev.target.result); alert('پشتیبان وارد شد. صفحه را رفرش کن و با PIN درست وارد شو.'); }; r.readAsText(f); });

  // Theme toggle
  themeToggle.addEventListener('click', ()=>{ const s=store.settings; s.theme = (s.theme==='auto'?'dark':(s.theme==='dark'?'light':'auto')); setTheme(s.theme); saveAll(true); });

  // Quick buttons
  quickAdd.addEventListener('click', ()=>{ const title=prompt('عنوان کار/جلسه:'); if(!title) return; const d=ensureDay(currentDate); d.custom.push({ key:'custom_'+Date.now(), title, start:'', end:'', status:'not_started', note:'' }); saveAll(true); });
  enableNoti.addEventListener('click', async ()=>{ const ok=await askNoti(); alert(ok?'اعلان‌ها فعال شد ✅':'اجازه صادر نشد'); });
  recalcStats.addEventListener('click', ()=>{ updateStreakAndWeekly(); drawChart(); alert('آمار به‌روز شد'); });

  // Change PIN
  changePinBtn.addEventListener('click', async ()=>{ const np=normalizePin(newPin.value||''); if(!/^\d{4,6}$/.test(np)) return alert('PIN باید ۴ تا ۶ رقم باشد'); store.settings.pin=np; currentPin=np; newPin.value=''; await saveAll(true); alert('PIN جدید ذخیره شد'); });

  // Save helper
  async function saveAll(justUI=false){ await saveVault(); renderDay(currentDate); }

  // ====== AI Agent (Worker یا data/) ======
  async function loadAgent(){
    try{
      let data;
      if(WORKER_BASE){
        const [scan,rec,draft] = await Promise.all([
          fetch(`${WORKER_BASE}/api/scan`).then(r=>r.json()),
          fetch(`${WORKER_BASE}/api/recommend`).then(r=>r.json()),
          fetch(`${WORKER_BASE}/api/draft`).then(r=>r.json())
        ]);
        data = { opportunities: scan.opportunities||[], trends: scan.trends||[], posts: (draft.posts||[]) , plan: rec };
      } else {
        const [opps,trends,prompts] = await Promise.all([
          fetch('data/opportunities.json').then(r=>r.json()),
          fetch('data/trends.json').then(r=>r.json()),
          fetch('data/prompts.json').then(r=>r.json())
        ]);
        data = { opportunities: opps||[], trends: trends||[], posts: (prompts||[]).posts || prompts || [], plan: { date: toISO(new Date()), tasks: ['جلسه Clo3D + اجرا','یک رندر تمیز','یک پست LinkedIn'] } };
      }
      renderAgent(data);
    }catch(e){
      agentBox.textContent = 'Agent در دسترس نیست (Worker یا data پیدا نشد).';
    }
  }
  function renderAgent({opportunities=[],trends=[],posts=[],plan}){
    agentBox.innerHTML = `
      <div class="row">برنامهٔ امروز:</div>
      <ol>${(plan?.tasks||[]).map(t=>`<li>${t}</li>`).join('')}</ol>
      <div class="row">فرصت‌ها:</div>
      <ul style="max-height:240px;overflow:auto;margin:0;padding-right:18px">
        ${opportunities.slice(0,12).map(o=>`<li style="margin:6px 0"><a href="${o.link}" target="_blank">${o.title}</a><span class="small muted"> — ${o.source} · score ${o.score||'-'}</span></li>`).join('')}
      </ul>
      <div class="row">ترندها:</div>
      <div class="small" style="display:flex;flex-wrap:wrap;gap:6px">${(trends||[]).slice(0,16).map(t=>`<span class="status-pill st-prog">#${t.term||t}</span>`).join('')}</div>
      <div class="row">پیش‌نویس پست:</div>
      <ul>${(posts||[]).map(p=>`<li><strong>${p.platform||p.type||'Post'}:</strong> ${p.text}</li>`).join('')}</ul>
    `;
  }

  // ====== Login / Lock with rate-limit ======
  let lockTimer=null;
  function lockWait(ms){ return new Promise(r=> setTimeout(r,ms)); }

  unlockBtn.addEventListener('click', async ()=>{
    const now = Date.now();
    if(store && store.lock && store.lock.nextAt && now < store.lock.nextAt){
      const sec = Math.ceil((store.lock.nextAt - now)/1000);
      lockMsg.textContent = `لطفاً ${sec}s صبر کن...`;
      return;
    }
    const pin = normalizePin(pinInput.value) || DEFAULT_PIN;
    lockMsg.textContent = 'در حال بررسی...';

    const cipher = localStorage.getItem(STORAGE_CIPHER_KEY);
    if(!cipher){
      store = makeStore(); currentPin=pin; await saveVault();
      lockOverlay.hidden=true; $('#app').hidden=false; initApp(); return;
    }
    try{
      const ok = await loadVault(pin);
      if(ok){
        store.lock = { tries:0, nextAt:0 }; await saveVault();
        lockOverlay.hidden=true; $('#app').hidden=false; initApp();
      } else throw new Error('bad pin');
    }catch(e){
      if(!store){ store = makeStore(); }
      store.lock.tries = (store.lock.tries||0) + 1;
      const tries = store.lock.tries;
      const delayMs = tries>=LOCK_MAX_TRIES ? Math.min(30000 * (tries-LOCK_MAX_TRIES+1), 5*60*1000) : 0; // تا ۵ دقیقه
      store.lock.nextAt = Date.now() + delayMs;
      await saveVault();
      lockMsg.textContent = tries>=LOCK_MAX_TRIES ? `PIN اشتباه. صبر کن ${Math.ceil(delayMs/1000)}s.` : 'PIN اشتباه است.';
    }
  });

  resetVaultBtn.addEventListener('click', async ()=>{
    if(!confirm('کل داده‌ها پاک شوند؟')) return;
    await resetVault();
    lockMsg.textContent = 'پاک شد. PIN را وارد کن تا شروع کنیم.';
  });

  // ====== Init App ======
  function registerSW(){ if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{});} }
  function initApp(){
    setTheme(store.settings.theme); if(store.settings.theme==='auto') setInterval(applyAutoTheme,60*1000);
    selectedDate.value=currentDate; selectedDate.addEventListener('change', ()=> renderDay(selectedDate.value));
    renderDay(currentDate); resetPom(); registerSW(); loadAgent();
  }

  // Keyboard submit
  pinInput.addEventListener('keyup', e=>{ if(e.key==='Enter') unlockBtn.click(); });

  // ready
  $('#todayLabel').textContent = toISO(new Date());
})();
