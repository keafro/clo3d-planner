/* Clo3D Planner — نسخه کامل برای کیانوش */
(function(){
  // ===== Utils =====
  const pad = n => String(n).padStart(2,'0');
  const today = new Date();
  const toISO = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0,10);
  const STORAGE_KEY = 'clo3d_complete_v1';

  // ===== DOM =====
  const todayLabel = document.getElementById('todayLabel');
  const selectedDate = document.getElementById('selectedDate');
  const mainTasks = document.getElementById('mainTasks');
  const taskList = document.getElementById('taskList');
  const dayNote = document.getElementById('dayNote');
  const saveNoteBtn = document.getElementById('saveNoteBtn');
  const addCustomBtn = document.getElementById('addCustomBtn');
  const customTitle = document.getElementById('customTitle');
  const customStart = document.getElementById('customStart');
  const historyEl = document.getElementById('history');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const backupBtn = document.getElementById('backupBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const addManualLog = document.getElementById('addManualLog');
  const manualTime = document.getElementById('manualTime');
  const manualText = document.getElementById('manualText');
  const searchNotesBtn = document.getElementById('searchNotesBtn');
  const themeToggle = document.getElementById('themeToggle');

  // Chart
  const chartCanvas = document.getElementById('progressChart');
  const chartCtx = chartCanvas.getContext('2d');

  // ===== Pomodoro =====
  const pomStart = document.getElementById('pomStart');
  const pomPause = document.getElementById('pomPause');
  const pomReset = document.getElementById('pomReset');
  const pomTimer = document.getElementById('pomTimer');
  const pomStateEl = document.getElementById('pomState');
  const pomCycles = document.getElementById('pomCycles');
  const pomWork = document.getElementById('pomWork');
  const pomShort = document.getElementById('pomShort');
  const pomLong = document.getElementById('pomLong');

  // ===== Defaults =====
  const DEFAULT_TASKS = [
    { key:'watch', title:'تماشای کامل ویدئو (35min)', start:'', end:'', status:'not_started', note:'' },
    { key:'watch_do', title:'تماشا + اجرا همزمان (45min)', start:'', end:'', status:'not_started', note:'' },
    { key:'do_alone', title:'اجرای بدون ویدئو (30–40min)', start:'', end:'', status:'not_started', note:'' }
  ];

  // ===== State =====
  let store = null;
  let currentDate = toISO(today);
  let pom = { interval:null, remaining:0, mode:'work', running:false, completed:0 };

  // Audio beep
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  function beep(freq=880, dur=0.18){
    try{
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type='sine'; o.frequency.value=freq; o.connect(g); g.connect(audioCtx.destination);
      g.gain.value=0.0001; o.start();
      g.gain.exponentialRampToValueAtTime(0.08, audioCtx.currentTime + 0.01);
      setTimeout(()=>{ g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05); o.stop(audioCtx.currentTime + 0.06); }, dur*1000);
    }catch(e){}
  }

  // ===== Storage =====
  function makeStore(){
    const start = new Date(); start.setHours(0,0,0,0);
    const days = {};
    for(let i=0;i<180;i++){
      const d = new Date(start); d.setDate(start.getDate()+i);
      const key = toISO(d);
      days[key] = { date:key, tasks: DEFAULT_TASKS.map(t=>({...t})), custom:[], note:'', logs:[] };
    }
    return { start: toISO(start), days };
  }
  function loadStore(){
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){ try{ store = JSON.parse(raw); }catch(e){ store = makeStore(); saveStore(); } }
    else { store = makeStore(); saveStore(); }
  }
  function saveStore(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
  function ensureDay(dateStr){
    if(!store.days[dateStr]) store.days[dateStr] = { date:dateStr, tasks:DEFAULT_TASKS.map(t=>({...t})), custom:[], note:'', logs:[] };
    return store.days[dateStr];
  }

  // ===== UI =====
  function init(){
    todayLabel.textContent = toISO(new Date());
    selectedDate.value = currentDate;
    attachEvents();
    renderDay(currentDate);
    registerSW();
    drawChart();
  }

  function renderDay(dateStr){
    currentDate = dateStr;
    selectedDate.value = dateStr;
    const day = ensureDay(dateStr);

    // three main tasks editor
    mainTasks.innerHTML = '';
    day.tasks.forEach((t, idx)=> mainTasks.appendChild(createTaskRow(t, idx)));

    // list all tasks (main + custom)
    renderTaskList();
    dayNote.value = day.note || '';
    renderLogs(day.logs || []);
    drawChart();
  }

  function createTaskRow(t, idx){
    const row = document.createElement('div'); row.className='task';
    row.innerHTML = `
      <div class="left">
        <div><strong>${t.title}</strong></div>
        <div class="small muted">شروع: <input class="startInput" data-idx="${idx}" type="time" value="${t.start||''}"></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
        <input class="endInput" data-idx="${idx}" placeholder="پایان (مثال: 22:10)" value="${t.end||''}">
        <select class="statusSelect" data-idx="${idx}">
          <option value="not_started">انجام‌نشده</option>
          <option value="in_progress">درحال انجام</option>
          <option value="done">انجام‌شده</option>
          <option value="skipped">کنار گذاشته</option>
        </select>
        <button class="ghost editBtn">ویرایش عنوان</button>
      </div>
    `;
    const sel = row.querySelector('.statusSelect'); sel.value = t.status || 'not_started';
    sel.addEventListener('change', e=>{ t.status=e.target.value; saveStore(); if(t.status==='done') addLog(`${t.title} — انجام شد`); renderTaskList(); drawChart(); });
    row.querySelector('.startInput').addEventListener('change', e=>{ t.start=e.target.value; saveStore(); if(t.start) addLog(`${t.title} — شروع ${t.start}`); });
    row.querySelector('.endInput').addEventListener('blur', e=>{ t.end=e.target.value; saveStore(); if(t.end) addLog(`${t.title} — پایان ${t.end}`); });
    row.querySelector('.editBtn').addEventListener('click', ()=>{ const n=prompt('عنوان جدید:', t.title); if(n!==null){ t.title=n; saveStore(); renderDay(currentDate);} });
    return row;
  }

  function renderTaskList(){
    const day = ensureDay(currentDate);
    taskList.innerHTML = '';
    const all = day.tasks.concat(day.custom||[]);
    all.forEach((t, i)=>{
      const el = document.createElement('div'); el.className='task';
      el.innerHTML = `
        <div class="left">
          <div><strong>${t.title}</strong></div>
          <div class="small muted">${t.start||''} · ${t.end||''}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
          <select class="statusSelect">
            <option value="not_started">انجام‌نشده</option>
            <option value="in_progress">درحال انجام</option>
            <option value="done">انجام‌شده</option>
            <option value="skipped">کنار گذاشته</option>
          </select>
          ${i >= day.tasks.length ? '<button class="ghost removeBtn">حذف</button>' : ''}
        </div>
      `;
      const sel = el.querySelector('.statusSelect'); sel.value=t.status||'not_started';
      sel.addEventListener('change', e=>{ t.status=e.target.value; saveStore(); if(t.status==='done') addLog(`${t.title} — انجام شد`); drawChart(); });
      const removeBtn = el.querySelector('.removeBtn');
      if(removeBtn){ removeBtn.addEventListener('click', ()=>{
        if(confirm('حذف شود؟')){ day.custom.splice(i - day.tasks.length,1); saveStore(); renderDay(currentDate); }
      });}
      taskList.appendChild(el);
    });
  }

  // Logs
  function renderLogs(logs){
    historyEl.innerHTML = '';
    if(!logs || logs.length===0){ historyEl.innerHTML = '<li class="historyItem muted">هیچ لاگی ثبت نشده</li>'; return; }
    logs.slice().reverse().forEach(l=>{
      const li=document.createElement('li'); li.className='historyItem';
      li.innerHTML = `<div><strong>${l.text}</strong></div><div class="small muted">${l.time} · ${l.meta||''}</div>`;
      historyEl.appendChild(li);
    });
  }
  function addLog(text, meta=null, when=null){
    const day = ensureDay(currentDate);
    const time = when || (new Date()).toLocaleTimeString('fa-IR');
    day.logs.push({ text, time, meta: meta? (meta.title||'') : '' });
    saveStore(); renderLogs(day.logs);
  }

  // Events
  function attachEvents(){
    selectedDate.addEventListener('change', ()=> renderDay(selectedDate.value));
    saveNoteBtn.addEventListener('click', ()=>{ const d=ensureDay(currentDate); d.note=dayNote.value; saveStore(); alert('یادداشت ذخیره شد'); });
    addCustomBtn.addEventListener('click', ()=>{
      const title=customTitle.value.trim(); if(!title) return alert('عنوان وارد کن');
      const start=customStart.value||'';
      const d=ensureDay(currentDate); d.custom.push({ key:'custom_'+Date.now(), title, start, end:'', status:'not_started', note:'' });
      saveStore(); customTitle.value=''; customStart.value=''; renderDay(currentDate);
    });
    addManualLog.addEventListener('click', ()=>{
      const t = manualTime.value || (new Date()).toLocaleTimeString('fa-IR');
      const txt = manualText.value.trim(); if(!txt) return alert('شرح وارد کن');
      addLog(txt, null, t); manualTime.value=''; manualText.value='';
    });
    exportCsvBtn.addEventListener('click', exportCSV);
    backupBtn.addEventListener('click', downloadBackup);
    importBtn.addEventListener('click', ()=> importFile.click());
    importFile.addEventListener('change', handleImport);
    searchNotesBtn.addEventListener('click', searchNotes);
    themeToggle.addEventListener('click', ()=> document.body.classList.toggle('light'));
    document.addEventListener('keydown', e=> { if(e.key==='p' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); startPom(); }});
  }

  // Backup/Import/CSV
  function downloadBackup(){
    const blob=new Blob([JSON.stringify(store,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download=`clo3d_backup_${toISO(new Date())}.json`; a.click(); URL.revokeObjectURL(url);
  }
  function handleImport(e){
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader(); r.onload=ev=>{
      try{
        const data=JSON.parse(ev.target.result);
        if(!data.days) return alert('پشتیبان معتبر نیست');
        if(!confirm('جایگزینی داده‌های فعلی؟')) return;
        store=data; saveStore(); renderDay(currentDate); alert('پشتیبان وارد شد');
      }catch(err){ alert('خطا در خواندن فایل'); }
    }; r.readAsText(f);
  }
  function exportCSV(){
    const rows=[['date','task','start','end','status','note','log_time','log_text']];
    for(const d in store.days){
      const day=store.days[d]; const all=(day.tasks||[]).concat(day.custom||[]);
      all.forEach(t=> rows.push([d,t.title,t.start||'',t.end||'',t.status||'',(t.note||'').replace(/[\r\n]+/g,' '),'','']));
      (day.logs||[]).forEach(l=> rows.push([d,'','','','','',l.time,l.text]));
    }
    const csv = rows.map(r=> r.map(c=> `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=`clo3d_export_${toISO(new Date())}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  // Search notes/logs
  function searchNotes(){
    const q = prompt('عبارت جستجو در یادداشت/لاگ:'); if(!q) return;
    const res=[];
    for(const d in store.days){
      const day=store.days[d];
      if((day.note||'').includes(q)) res.push(`${d} — NOTE: ${day.note}`);
      (day.logs||[]).forEach(l=> { if(l.text.includes(q)) res.push(`${d} — LOG: ${l.text}`); });
    }
    alert(res.length ? res.slice(0,30).join('\n') : 'یافت نشد');
  }

  // Stats (last 7 days)
  function drawChart(){
    const labels=[], data=[];
    for(let i=6;i>=0;i--){
      const d=new Date(); d.setDate(d.getDate()-i);
      const key=toISO(d); labels.push(key.slice(5));
      const day=store.days[key]; if(!day){ data.push(0); continue; }
      const all=(day.tasks||[]).concat(day.custom||[]);
      const done=all.filter(t=>t.status==='done').length;
      const pct=all.length? Math.round(done/all.length*100) : 0;
      data.push(pct);
    }
    const ctx=chartCtx; const w=chartCanvas.width=chartCanvas.clientWidth; const h=chartCanvas.height=chartCanvas.clientHeight;
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.moveTo(40,10); ctx.lineTo(40,h-20); ctx.lineTo(w-10,h-20); ctx.stroke();
    const barW=(w-60)/labels.length;
    data.forEach((v,i)=>{
      const x=45+i*barW; const barH=((h-40)*v)/100;
      ctx.fillStyle='rgba(124,58,237,0.9)'; ctx.fillRect(x,h-20-barH,barW*0.7,barH);
      ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.font='12px sans-serif'; ctx.fillText(labels[i],x,h-5);
      ctx.fillText(v+'%',x,h-25-barH<10?10:h-25-barH);
    });
    const avg=Math.round(data.reduce((a,b)=>a+b,0)/data.length);
    document.getElementById('statsSummary').textContent = `میانگین تکمیل ۷ روز: ${avg}%`;
  }

  // Theme
  // (برای سادگی فقط کلاس روشن/تاریک)
  // می‌تونی بعداً استایل تم روشن اضافه کنی
  // document.body.classList.toggle('light') با دکمه تم انجام می‌شود.

  // Pomodoro
  function updatePom(){ const mm=Math.floor(pom.remaining/60), ss=pom.remaining%60; pomTimer.textContent=`${pad(mm)}:${pad(ss)}`; document.getElementById('pomState').textContent=pom.mode==='work'?'کار':(pom.mode==='short'?'استراحت کوتاه':'استراحت بلند'); pomCycles.textContent=pom.completed; }
  function startPom(){
    if(pom.running) return;
    if(pom.remaining<=0){
      if(pom.mode==='work') pom.remaining=parseInt(pomWork.value||25)*60;
      else if(pom.mode==='short') pom.remaining=parseInt(pomShort.value||5)*60;
      else pom.remaining=parseInt(pomLong.value||15)*60;
    }
    pom.running=true;
    pom.interval=setInterval(()=>{
      pom.remaining--;
      if(pom.remaining<=0){
        clearInterval(pom.interval); pom.running=false; beep();
        if(pom.mode==='work'){ pom.completed++; pom.mode = (pom.completed%4===0)?'long':'short'; addLog('پایان جلسه کار (پومودورو)'); }
        else pom.mode='work';
        startPom();
      }
      updatePom();
    },1000);
  }
  function pausePom(){ if(pom.interval) clearInterval(pom.interval); pom.running=false; pom.interval=null; updatePom(); }
  function resetPom(){ pausePom(); pom.mode='work'; pom.remaining=parseInt(pomWork.value||25)*60; pom.completed=0; updatePom(); }
  document.getElementById('pomStart').addEventListener('click', startPom);
  document.getElementById('pomPause').addEventListener('click', pausePom);
  document.getElementById('pomReset').addEventListener('click', resetPom);

  // SW
  function registerSW(){
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('sw.js').catch(()=>{});
    }
  }

  // Start
  loadStore();
  todayLabel.textContent = toISO(new Date());
  selectedDate.value = currentDate;
  attachEvents();
  renderDay(currentDate);
  resetPom();

  // expose for debug if needed
  window._planner = { store, saveStore };
})();
/* Clo3D Planner — نسخه کامل برای کیانوش */
(function(){
  // ===== Utils =====
  const pad = n => String(n).padStart(2,'0');
  const today = new Date();
  const toISO = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0,10);
  const STORAGE_KEY = 'clo3d_complete_v1';

  // ===== DOM =====
  const todayLabel = document.getElementById('todayLabel');
  const selectedDate = document.getElementById('selectedDate');
  const mainTasks = document.getElementById('mainTasks');
  const taskList = document.getElementById('taskList');
  const dayNote = document.getElementById('dayNote');
  const saveNoteBtn = document.getElementById('saveNoteBtn');
  const addCustomBtn = document.getElementById('addCustomBtn');
  const customTitle = document.getElementById('customTitle');
  const customStart = document.getElementById('customStart');
  const historyEl = document.getElementById('history');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const backupBtn = document.getElementById('backupBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const addManualLog = document.getElementById('addManualLog');
  const manualTime = document.getElementById('manualTime');
  const manualText = document.getElementById('manualText');
  const searchNotesBtn = document.getElementById('searchNotesBtn');
  const themeToggle = document.getElementById('themeToggle');

  // Chart
  const chartCanvas = document.getElementById('progressChart');
  const chartCtx = chartCanvas.getContext('2d');

  // ===== Pomodoro =====
  const pomStart = document.getElementById('pomStart');
  const pomPause = document.getElementById('pomPause');
  const pomReset = document.getElementById('pomReset');
  const pomTimer = document.getElementById('pomTimer');
  const pomStateEl = document.getElementById('pomState');
  const pomCycles = document.getElementById('pomCycles');
  const pomWork = document.getElementById('pomWork');
  const pomShort = document.getElementById('pomShort');
  const pomLong = document.getElementById('pomLong');

  // ===== Defaults =====
  const DEFAULT_TASKS = [
    { key:'watch', title:'تماشای کامل ویدئو (35min)', start:'', end:'', status:'not_started', note:'' },
    { key:'watch_do', title:'تماشا + اجرا همزمان (45min)', start:'', end:'', status:'not_started', note:'' },
    { key:'do_alone', title:'اجرای بدون ویدئو (30–40min)', start:'', end:'', status:'not_started', note:'' }
  ];

  // ===== State =====
  let store = null;
  let currentDate = toISO(today);
  let pom = { interval:null, remaining:0, mode:'work', running:false, completed:0 };

  // Audio beep
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  function beep(freq=880, dur=0.18){
    try{
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type='sine'; o.frequency.value=freq; o.connect(g); g.connect(audioCtx.destination);
      g.gain.value=0.0001; o.start();
      g.gain.exponentialRampToValueAtTime(0.08, audioCtx.currentTime + 0.01);
      setTimeout(()=>{ g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05); o.stop(audioCtx.currentTime + 0.06); }, dur*1000);
    }catch(e){}
  }

  // ===== Storage =====
  function makeStore(){
    const start = new Date(); start.setHours(0,0,0,0);
    const days = {};
    for(let i=0;i<180;i++){
      const d = new Date(start); d.setDate(start.getDate()+i);
      const key = toISO(d);
      days[key] = { date:key, tasks: DEFAULT_TASKS.map(t=>({...t})), custom:[], note:'', logs:[] };
    }
    return { start: toISO(start), days };
  }
  function loadStore(){
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){ try{ store = JSON.parse(raw); }catch(e){ store = makeStore(); saveStore(); } }
    else { store = makeStore(); saveStore(); }
  }
  function saveStore(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
  function ensureDay(dateStr){
    if(!store.days[dateStr]) store.days[dateStr] = { date:dateStr, tasks:DEFAULT_TASKS.map(t=>({...t})), custom:[], note:'', logs:[] };
    return store.days[dateStr];
  }

  // ===== UI =====
  function init(){
    todayLabel.textContent = toISO(new Date());
    selectedDate.value = currentDate;
    attachEvents();
    renderDay(currentDate);
    registerSW();
    drawChart();
  }

  function renderDay(dateStr){
    currentDate = dateStr;
    selectedDate.value = dateStr;
    const day = ensureDay(dateStr);

    // three main tasks editor
    mainTasks.innerHTML = '';
    day.tasks.forEach((t, idx)=> mainTasks.appendChild(createTaskRow(t, idx)));

    // list all tasks (main + custom)
    renderTaskList();
    dayNote.value = day.note || '';
    renderLogs(day.logs || []);
    drawChart();
  }

  function createTaskRow(t, idx){
    const row = document.createElement('div'); row.className='task';
    row.innerHTML = `
      <div class="left">
        <div><strong>${t.title}</strong></div>
        <div class="small muted">شروع: <input class="startInput" data-idx="${idx}" type="time" value="${t.start||''}"></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
        <input class="endInput" data-idx="${idx}" placeholder="پایان (مثال: 22:10)" value="${t.end||''}">
        <select class="statusSelect" data-idx="${idx}">
          <option value="not_started">انجام‌نشده</option>
          <option value="in_progress">درحال انجام</option>
          <option value="done">انجام‌شده</option>
          <option value="skipped">کنار گذاشته</option>
        </select>
        <button class="ghost editBtn">ویرایش عنوان</button>
      </div>
    `;
    const sel = row.querySelector('.statusSelect'); sel.value = t.status || 'not_started';
    sel.addEventListener('change', e=>{ t.status=e.target.value; saveStore(); if(t.status==='done') addLog(`${t.title} — انجام شد`); renderTaskList(); drawChart(); });
    row.querySelector('.startInput').addEventListener('change', e=>{ t.start=e.target.value; saveStore(); if(t.start) addLog(`${t.title} — شروع ${t.start}`); });
    row.querySelector('.endInput').addEventListener('blur', e=>{ t.end=e.target.value; saveStore(); if(t.end) addLog(`${t.title} — پایان ${t.end}`); });
    row.querySelector('.editBtn').addEventListener('click', ()=>{ const n=prompt('عنوان جدید:', t.title); if(n!==null){ t.title=n; saveStore(); renderDay(currentDate);} });
    return row;
  }

  function renderTaskList(){
    const day = ensureDay(currentDate);
    taskList.innerHTML = '';
    const all = day.tasks.concat(day.custom||[]);
    all.forEach((t, i)=>{
      const el = document.createElement('div'); el.className='task';
      el.innerHTML = `
        <div class="left">
          <div><strong>${t.title}</strong></div>
          <div class="small muted">${t.start||''} · ${t.end||''}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">
          <select class="statusSelect">
            <option value="not_started">انجام‌نشده</option>
            <option value="in_progress">درحال انجام</option>
            <option value="done">انجام‌شده</option>
            <option value="skipped">کنار گذاشته</option>
          </select>
          ${i >= day.tasks.length ? '<button class="ghost removeBtn">حذف</button>' : ''}
        </div>
      `;
      const sel = el.querySelector('.statusSelect'); sel.value=t.status||'not_started';
      sel.addEventListener('change', e=>{ t.status=e.target.value; saveStore(); if(t.status==='done') addLog(`${t.title} — انجام شد`); drawChart(); });
      const removeBtn = el.querySelector('.removeBtn');
      if(removeBtn){ removeBtn.addEventListener('click', ()=>{
        if(confirm('حذف شود؟')){ day.custom.splice(i - day.tasks.length,1); saveStore(); renderDay(currentDate); }
      });}
      taskList.appendChild(el);
    });
  }

  // Logs
  function renderLogs(logs){
    historyEl.innerHTML = '';
    if(!logs || logs.length===0){ historyEl.innerHTML = '<li class="historyItem muted">هیچ لاگی ثبت نشده</li>'; return; }
    logs.slice().reverse().forEach(l=>{
      const li=document.createElement('li'); li.className='historyItem';
      li.innerHTML = `<div><strong>${l.text}</strong></div><div class="small muted">${l.time} · ${l.meta||''}</div>`;
      historyEl.appendChild(li);
    });
  }
  function addLog(text, meta=null, when=null){
    const day = ensureDay(currentDate);
    const time = when || (new Date()).toLocaleTimeString('fa-IR');
    day.logs.push({ text, time, meta: meta? (meta.title||'') : '' });
    saveStore(); renderLogs(day.logs);
  }

  // Events
  function attachEvents(){
    selectedDate.addEventListener('change', ()=> renderDay(selectedDate.value));
    saveNoteBtn.addEventListener('click', ()=>{ const d=ensureDay(currentDate); d.note=dayNote.value; saveStore(); alert('یادداشت ذخیره شد'); });
    addCustomBtn.addEventListener('click', ()=>{
      const title=customTitle.value.trim(); if(!title) return alert('عنوان وارد کن');
      const start=customStart.value||'';
      const d=ensureDay(currentDate); d.custom.push({ key:'custom_'+Date.now(), title, start, end:'', status:'not_started', note:'' });
      saveStore(); customTitle.value=''; customStart.value=''; renderDay(currentDate);
    });
    addManualLog.addEventListener('click', ()=>{
      const t = manualTime.value || (new Date()).toLocaleTimeString('fa-IR');
      const txt = manualText.value.trim(); if(!txt) return alert('شرح وارد کن');
      addLog(txt, null, t); manualTime.value=''; manualText.value='';
    });
    exportCsvBtn.addEventListener('click', exportCSV);
    backupBtn.addEventListener('click', downloadBackup);
    importBtn.addEventListener('click', ()=> importFile.click());
    importFile.addEventListener('change', handleImport);
    searchNotesBtn.addEventListener('click', searchNotes);
    themeToggle.addEventListener('click', ()=> document.body.classList.toggle('light'));
    document.addEventListener('keydown', e=> { if(e.key==='p' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); startPom(); }});
  }

  // Backup/Import/CSV
  function downloadBackup(){
    const blob=new Blob([JSON.stringify(store,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download=`clo3d_backup_${toISO(new Date())}.json`; a.click(); URL.revokeObjectURL(url);
  }
  function handleImport(e){
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader(); r.onload=ev=>{
      try{
        const data=JSON.parse(ev.target.result);
        if(!data.days) return alert('پشتیبان معتبر نیست');
        if(!confirm('جایگزینی داده‌های فعلی؟')) return;
        store=data; saveStore(); renderDay(currentDate); alert('پشتیبان وارد شد');
      }catch(err){ alert('خطا در خواندن فایل'); }
    }; r.readAsText(f);
  }
  function exportCSV(){
    const rows=[['date','task','start','end','status','note','log_time','log_text']];
    for(const d in store.days){
      const day=store.days[d]; const all=(day.tasks||[]).concat(day.custom||[]);
      all.forEach(t=> rows.push([d,t.title,t.start||'',t.end||'',t.status||'',(t.note||'').replace(/[\r\n]+/g,' '),'','']));
      (day.logs||[]).forEach(l=> rows.push([d,'','','','','',l.time,l.text]));
    }
    const csv = rows.map(r=> r.map(c=> `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=`clo3d_export_${toISO(new Date())}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  // Search notes/logs
  function searchNotes(){
    const q = prompt('عبارت جستجو در یادداشت/لاگ:'); if(!q) return;
    const res=[];
    for(const d in store.days){
      const day=store.days[d];
      if((day.note||'').includes(q)) res.push(`${d} — NOTE: ${day.note}`);
      (day.logs||[]).forEach(l=> { if(l.text.includes(q)) res.push(`${d} — LOG: ${l.text}`); });
    }
    alert(res.length ? res.slice(0,30).join('\n') : 'یافت نشد');
  }

  // Stats (last 7 days)
  function drawChart(){
    const labels=[], data=[];
    for(let i=6;i>=0;i--){
      const d=new Date(); d.setDate(d.getDate()-i);
      const key=toISO(d); labels.push(key.slice(5));
      const day=store.days[key]; if(!day){ data.push(0); continue; }
      const all=(day.tasks||[]).concat(day.custom||[]);
      const done=all.filter(t=>t.status==='done').length;
      const pct=all.length? Math.round(done/all.length*100) : 0;
      data.push(pct);
    }
    const ctx=chartCtx; const w=chartCanvas.width=chartCanvas.clientWidth; const h=chartCanvas.height=chartCanvas.clientHeight;
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.moveTo(40,10); ctx.lineTo(40,h-20); ctx.lineTo(w-10,h-20); ctx.stroke();
    const barW=(w-60)/labels.length;
    data.forEach((v,i)=>{
      const x=45+i*barW; const barH=((h-40)*v)/100;
      ctx.fillStyle='rgba(124,58,237,0.9)'; ctx.fillRect(x,h-20-barH,barW*0.7,barH);
      ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.font='12px sans-serif'; ctx.fillText(labels[i],x,h-5);
      ctx.fillText(v+'%',x,h-25-barH<10?10:h-25-barH);
    });
    const avg=Math.round(data.reduce((a,b)=>a+b,0)/data.length);
    document.getElementById('statsSummary').textContent = `میانگین تکمیل ۷ روز: ${avg}%`;
  }

  // Theme
  // (برای سادگی فقط کلاس روشن/تاریک)
  // می‌تونی بعداً استایل تم روشن اضافه کنی
  // document.body.classList.toggle('light') با دکمه تم انجام می‌شود.

  // Pomodoro
  function updatePom(){ const mm=Math.floor(pom.remaining/60), ss=pom.remaining%60; pomTimer.textContent=`${pad(mm)}:${pad(ss)}`; document.getElementById('pomState').textContent=pom.mode==='work'?'کار':(pom.mode==='short'?'استراحت کوتاه':'استراحت بلند'); pomCycles.textContent=pom.completed; }
  function startPom(){
    if(pom.running) return;
    if(pom.remaining<=0){
      if(pom.mode==='work') pom.remaining=parseInt(pomWork.value||25)*60;
      else if(pom.mode==='short') pom.remaining=parseInt(pomShort.value||5)*60;
      else pom.remaining=parseInt(pomLong.value||15)*60;
    }
    pom.running=true;
    pom.interval=setInterval(()=>{
      pom.remaining--;
      if(pom.remaining<=0){
        clearInterval(pom.interval); pom.running=false; beep();
        if(pom.mode==='work'){ pom.completed++; pom.mode = (pom.completed%4===0)?'long':'short'; addLog('پایان جلسه کار (پومودورو)'); }
        else pom.mode='work';
        startPom();
      }
      updatePom();
    },1000);
  }
  function pausePom(){ if(pom.interval) clearInterval(pom.interval); pom.running=false; pom.interval=null; updatePom(); }
  function resetPom(){ pausePom(); pom.mode='work'; pom.remaining=parseInt(pomWork.value||25)*60; pom.completed=0; updatePom(); }
  document.getElementById('pomStart').addEventListener('click', startPom);
  document.getElementById('pomPause').addEventListener('click', pausePom);
  document.getElementById('pomReset').addEventListener('click', resetPom);

  // SW
  function registerSW(){
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('sw.js').catch(()=>{});
    }
  }

  // Start
  loadStore();
  todayLabel.textContent = toISO(new Date());
  selectedDate.value = currentDate;
  attachEvents();
  renderDay(currentDate);
  resetPom();

  // expose for debug if needed
  window._planner = { store, saveStore };
})();
