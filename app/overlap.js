const CONFIG = window.ROOSTER_CONFIG || { auth:{accounts:[]}, crew:[], defaults:{} };
const ICS_ROOSTER  = CONFIG.defaults.calendarUrl || 'https://calendar.google.com/calendar/ical/f0a70a3f3862ea4c0202a62f4bd8b3298a1cd69d53e57944c0dcaeab39b54dc6%40group.calendar.google.com/public/basic.ics';
const ICS_AFSPRAKEN= CONFIG.defaults.appointmentUrl || 'https://calendar.google.com/calendar/ical/f99b1ad32b1aa1f543623c166d7b74e45155aee446a941d7d0342b38b41da904%40group.calendar.google.com/public/basic.ics';
const ICS_MAIN     = CONFIG.defaults.mainEventCalendarUrl || 'https://calendar.google.com/calendar/ical/parknestflevopark%40gmail.com/public/basic.ics';
const ICS = ICS_ROOSTER; // backward compat

// Each proxy function receives the exact ICS URL to fetch
const PROXIES = [
  (url, opts={}) => `app/proxy.php?url=${encodeURIComponent(url)}${opts.forceRefresh ? '&refresh=1' : ''}&_=${opts.cacheBust}`,
  (url, opts={}) => `https://api.allorigins.win/raw?url=${encodeURIComponent(opts.sourceUrl)}&_=${opts.cacheBust}`,
  (url, opts={}) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(opts.sourceUrl)}&_=${opts.cacheBust}`,
];

const LOCAL_STORAGE_KEY = 'parknest_rooster_local_shifts';
let localShifts = [];
let loggedInUser = null;

function loadLocalShifts(){
  try { const raw = localStorage.getItem(LOCAL_STORAGE_KEY); localShifts = raw ? JSON.parse(raw) : []; } catch(e){ localShifts=[]; }
}
function saveLocalShifts(){ localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(localShifts)); }
function showShareToast(msg){
  let t=document.getElementById('shareToast');
  if(!t){
    t=document.createElement('div');
    t.id='shareToast';
    document.body.appendChild(t);
  }
  t.textContent=msg;
  t.classList.add('on');
  clearTimeout(t._hide);
  t._hide=setTimeout(()=>t.classList.remove('on'),3000);
}
function hasGoogleConfig(){ return !!(CONFIG.defaults.googleClientId && CONFIG.defaults.googleApiKey && CONFIG.defaults.googleCalendarId); }
let googleClientLoaded = false;
let googleSignedIn = false;
function crewColor(name){ const user=crewForName(name); return user?.color || PALETTES[nameHash(name)][0] || '#dbeeff'; }
function localShiftToEvent(shift){ const start = new Date(shift.start); const end = new Date(shift.end); return { title: shift.title, desc: shift.desc||'', location: shift.location||'', start, end, uid: shift.id || `local-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, _cal:'custom', localId: shift.id } }
function mergeLocalShifts(evList){ 
  const localEvs = localShifts.filter(s=>s.active!==false).map(localShiftToEvent).filter(ev => !shouldFilterEvent(ev));
  return [...evList, ...localEvs];
}

function shouldFilterEvent(ev){
  const keywords = CONFIG.defaults.filterKeywords || [];
  if(!keywords || keywords.length === 0) return false;
  const title = (ev.title || '').toLowerCase();
  return keywords.some(kw => title.includes(kw.toLowerCase()));
}

async function loadGoogleClient(){
  if(!hasGoogleConfig()) return;
  if(googleClientLoaded) return;
  await new Promise((resolve,reject)=>{
    if(window.gapi){ resolve(); return; }
    const s=document.createElement('script');
    s.src='https://apis.google.com/js/api.js';
    s.onload=resolve; s.onerror=reject;
    document.head.appendChild(s);
  });
  await new Promise(resolve=>gapi.load('client:auth2',resolve));
  try {
    await gapi.client.init({
      apiKey: CONFIG.defaults.googleApiKey,
      clientId: CONFIG.defaults.googleClientId,
      discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
      scope: 'https://www.googleapis.com/auth/calendar'
    });
  } catch(err) {
    console.error('Google client init failed', err);
    let msg = err?.details?.[0]?.message || err?.result?.error?.message || err?.message || 'Onbekende fout';
    if(msg.toLowerCase().includes('idpiframe_initialization_failed')){
      msg = 'idpiframe_initialization_failed: Oorsprong niet toegestaan. Voeg je site (http://localhost:8000 of https://parknest.nl) als geautoriseerde JavaScript-origin in Google Cloud in.';
    }
    alert('Google Calendar API initialisatie mislukt: '+msg+'\n\nControleer in Google Cloud: API ingeschakeld, juiste sleutel, referrer.');
    googleClientLoaded=false;
    return;
  }
  googleClientLoaded=true;
  googleSignedIn = gapi.auth2.getAuthInstance().isSignedIn.get();
}

async function signInGoogle(){
  if(!hasGoogleConfig()){ showShareToast('Google config ontbreekt. Stel googleClientId/APIKey/calendarId in rooster-config.js'); return; }
  await loadGoogleClient();
  try{
    const auth= gapi.auth2.getAuthInstance();
    await auth.signIn();
    googleSignedIn=true;
    const profile = auth.currentUser.get().getBasicProfile();
    loggedInUser = {
      name: profile.getName() || profile.getEmail(),
      email: profile.getEmail(),
      role: 'member'
    };
    showShareToast('Google ingelogd als ' + loggedInUser.email);
    updateAuthUI();
  }catch(e){
    console.error(e);
    const msg = e?.error || e?.details || e?.result?.error?.message || 'Google inloggen mislukt.';
    alert('Google inloggen mislukt: '+msg);
    googleSignedIn=false;
    updateAuthUI();
  }
}

function signOutGoogle(){
  if(googleClientLoaded && gapi.auth2.getAuthInstance().isSignedIn.get()){
    gapi.auth2.getAuthInstance().signOut();
  }
  googleSignedIn=false;
  loggedInUser = null;
  updateAuthUI();
}

async function insertEventInGoogle(shift){
  if(!googleSignedIn) return null;
  if(!hasGoogleConfig()) return null;
  const event={
    summary: shift.title,
    description: shift.desc || '',
    location: shift.location || '',
    start:{ dateTime: shift.start, timeZone: CONFIG.defaults.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone },
    end:{ dateTime: shift.end, timeZone: CONFIG.defaults.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone },
    reminders:{useDefault:true}
  };
  const resp=await gapi.client.calendar.events.insert({ calendarId: CONFIG.defaults.googleCalendarId, resource: event });
  return resp.result.id;
}

async function deleteEventInGoogle(eventId){
  if(!googleSignedIn || !eventId) return;
  try{
    await gapi.client.calendar.events.delete({ calendarId: CONFIG.defaults.googleCalendarId, eventId });
  }catch(e){ console.warn('Google delete failed',e); }
}

const SKIP=2;

// ── LOCALE & I18N ─────────────────────────────────────────────────────────────
const _locale = navigator.language || 'nl';
const _lang   = _locale.toLowerCase().slice(0,2);

// Day/month name arrays generated via Intl (0=Sunday, matches JS getDay())
// Reference: 2023-01-01 = Sunday
const _refSun = new Date(2023,0,1);
const DS = Array.from({length:7},(_,i)=>{const d=new Date(_refSun);d.setDate(1+i);return new Intl.DateTimeFormat(_locale,{weekday:'short'}).format(d);});
const DL = Array.from({length:7},(_,i)=>{const d=new Date(_refSun);d.setDate(1+i);return new Intl.DateTimeFormat(_locale,{weekday:'long'}).format(d);});
const MN = Array.from({length:12},(_,i)=>new Intl.DateTimeFormat(_locale,{month:'short'}).format(new Date(2023,i,1)));

// UI string translations
const _UI_STRINGS = {
  nl:{today:'Today',week:'Week',day:'Day',hours:'Uren',events:'Events',print:'Print',share:'Deel',install:'Installeer',loading:'Laden\u2026',loadFail:'\u26a0 Laden mislukt',wkShort:'Wk',calFail:'Kalender kon niet worden geladen'},
  en:{today:'Today',week:'Week',day:'Day',hours:'Hours',events:'Events',print:'Print',share:'Share',install:'Install',loading:'Loading\u2026',loadFail:'\u26a0 Load failed',wkShort:'Wk',calFail:'Calendar could not be loaded'},
  de:{today:'Heute',week:'Woche',day:'Tag',hours:'Stunden',events:'Events',print:'Drucken',share:'Teilen',install:'Installieren',loading:'Laden\u2026',loadFail:'\u26a0 Laden fehlgeschlagen',wkShort:'KW',calFail:'Kalender konnte nicht geladen werden'},
  tr:{today:'Bug\xfcn',week:'Hafta',day:'G\xfcn',hours:'Saat',events:'Etkinlik',print:'Yazd\u0131r',share:'Payla\u015f',install:'Y\xfckle',loading:'Y\xfckleniyor\u2026',loadFail:'\u26a0 Y\xfckleme ba\u015far\u0131s\u0131z',wkShort:'Hf',calFail:'Takvim y\xfcklenemedi'},
};
const UI = _UI_STRINGS[_lang] || _UI_STRINGS.nl;

// Apply UI strings to header buttons (runs once after DOM is ready)
function applyLocaleUI(){
  const ver = (window.ROOSTER_CONFIG&&window.ROOSTER_CONFIG.branding&&window.ROOSTER_CONFIG.branding.version)||'';
  // Browser tab title
  document.title = (window.ROOSTER_CONFIG&&window.ROOSTER_CONFIG.branding&&window.ROOSTER_CONFIG.branding.appName||'Parknest Rooster') + (ver?' v'+ver:'');
  // Version badge in header next to logo
  const logo = document.querySelector('.logo');
  if(logo && ver && !document.getElementById('appVer')){
    const badge = document.createElement('span');
    badge.id = 'appVer';
    badge.textContent = 'v'+ver;
    logo.insertAdjacentElement('afterend', badge);
  }
  document.getElementById('tB').textContent            = UI.today;
  document.getElementById('bW').textContent            = UI.week;
  document.getElementById('bD').textContent            = UI.day;
  const lbl = document.querySelector('label[for="mainLayerToggle"]');
  if(lbl) lbl.textContent = UI.events;
  const pl = document.querySelector('#printLandBtn .print-label');
  if(pl) pl.textContent = UI.print;
  const sl = document.querySelector('#shareBtn .share-label');
  if(sl) sl.textContent = UI.share;
  const ib = document.getElementById('installBtn');
  if(ib){ const tn=ib.lastChild; if(tn&&tn.nodeType===3) tn.textContent=' '+UI.install; }
}

let HH=40; // px per hour on screen; day view recalculates this from viewport height

function updateDayViewMetrics(hourCount, maxCrewCols=1){
  if(vm!=='day' || window._printMaxCols){
    HH=40;
    document.body.style.setProperty('--hh', `${HH}px`);
    document.body.style.removeProperty('--day-view-width');
    return;
  }

  const viewportH = window.innerHeight || document.documentElement.clientHeight || 800;
  const viewportW = window.innerWidth || document.documentElement.clientWidth || 1200;
  const headerH = document.querySelector('header')?.offsetHeight || 64;
  const baseFont = parseFloat(getComputedStyle(document.body).fontSize) || 16;
  const minHourHeight = Math.max(18, Math.round(baseFont * 1.15));
  const maxHourHeight = 52;
  const reserveH = 116;
  const usableGridH = Math.max(minHourHeight * hourCount, viewportH - headerH - reserveH);

  HH = Math.max(
    minHourHeight,
    Math.min(maxHourHeight, Math.floor(usableGridH / Math.max(hourCount, 1)))
  );

  // Width: A4-portrait ratio as base; widen by 126px per crew column beyond 1
  const a4Height = reserveH + hourCount * HH;
  const a4Width = Math.floor(a4Height / Math.SQRT2);
  const colExtra = Math.max(0, maxCrewCols - 1) * 126;
  const targetWidth = Math.max(a4Width, 52 + maxCrewCols * 126 + 24) + colExtra;
  const boundedWidth = Math.max(280, Math.min(targetWidth, viewportW - 20));

  document.body.style.setProperty('--hh', `${HH}px`);
  document.body.style.setProperty('--day-view-width', `${boundedWidth}px`);
}

let allEv=[],vm='week',anc=sowk(new Date()),hoursFocusPeriod='month';
// Restore view/date from URL hash (e.g. #day/2026-05-10 or #week/2026-05-04)
(()=>{
  const m=location.hash.match(/^#(week|day|hours)\/(\d{4}-\d{2}-\d{2})$/);
  if(m){
    const [,mode,ds]=m;
    const d=new Date(ds+'T00:00:00');
    if(!isNaN(d)){
      vm=mode;
      anc=mode==='week'?sowk(d):d;
    }
  }
})();

// Compute dynamic start/end hour from a set of events (+1 margin each side)
// Excludes only all-day events; timed afspraken are shown in the grid too.
function dynamicHours(evList){
  let minH=23,maxH=0;
  evList.forEach(ev=>{
    if(ev.start._ad||ev.end?._ad)return;
    const sh=timeHour(ev.start);
    // Skip events starting at or after 23:00 — they are rare edge cases
    if(sh>=23)return;
    const eh=eventEndHour(ev,24);
    // Cap individual event end at 23 so a midnight-crossing end-time doesn't pull the grid
    const clampedEh=Math.min(23,eh<sh?sh+1:eh);
    // Only rooster/custom shifts drive the start time (avoid main events pulling grid early)
    if(ev._cal!=='main' && sh<minH)minH=sh;
    // All events (incl. main) drive the end time so the grid covers them
    if(clampedEh>maxH)maxH=clampedEh;
  });
  if(minH>maxH){minH=9;maxH=18;} // fallback when no timed events
  // 1 hour margin before earliest shift; day-view minimum end 19:00
  const minEh = vm==='day' ? 19 : 0;
  // +1 end margin so events ending on the hour have a closing line; cap at 24 (midnight)
  return{sh:Math.max(0,Math.floor(minH)-1), eh:Math.max(Math.min(24,Math.ceil(maxH)+1),minEh)};
}

function sowk(d){const c=new Date(d),dw=c.getDay(),df=dw===0?-6:1-dw;c.setDate(c.getDate()+df);c.setHours(0,0,0,0);return c}
function addD(d,n){const c=new Date(d);c.setDate(c.getDate()+n);return c}
function same(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()}
function p2(n){return String(n).padStart(2,'0')}
function esc(v){return String(v??'').replace(/[&<>\"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]))}
function timeHour(d){return d.getHours()+d.getMinutes()/60}
function eventEndHour(ev, fallbackEndHour){
  const sh=timeHour(ev.start);
  if(!ev.end)return sh+1;
  if(ev.end._ad)return fallbackEndHour;
  let eh=timeHour(ev.end);
  if(eh<=sh)eh+=24;
  return eh;
}
function eventEndMs(ev){
  if(!ev.end)return ev.start.getTime()+3600000;
  return ev.end.getTime();
}
function timedOverlap(a,b){
  return a.start.getTime()<eventEndMs(b)&&eventEndMs(a)>b.start.getTime();
}
function isShiftEvent(ev){
  return !ev.start?._ad&&ev._cal!=='main'&&ev._cal!=='afspraken'&&ev._cal!=='holiday';
}
function rightFloatShiftSlot(ev, dayEvents){
  if(!isShiftEvent(ev))return null;
  const overlappingAfspraken=dayEvents.filter(other=>other._cal==='afspraken'&&!other.start?._ad&&timedOverlap(ev,other));
  if(!overlappingAfspraken.length)return null;
  const group=dayEvents
    .filter(other=>isShiftEvent(other)&&overlappingAfspraken.some(afspraak=>timedOverlap(other,afspraak)))
    .sort((a,b)=>a.start-b.start||(a.title||'').localeCompare(b.title||''));
  const idx=group.indexOf(ev);
  if(idx<0)return null;
  const count=Math.max(1,group.length);
  const width=count===1?75:Math.min(33,100/(count+1));
  const occupied=width*count;
  return {left:100-occupied+(idx*width), right:100-(100-occupied+(idx*width))-width};
}
function pDate(line){
  const col=line.indexOf(':'),raw=line.slice(col+1).trim();
  const isD=line.includes('VALUE=DATE')||raw.length===8;
  if(isD){const y=+raw.slice(0,4),m=+raw.slice(4,6)-1,d=+raw.slice(6,8);const dt=new Date(y,m,d);dt._ad=true;return dt}
  const y=+raw.slice(0,4),mo=+raw.slice(4,6)-1,d=+raw.slice(6,8),h=+raw.slice(9,11),mi=+raw.slice(11,13),s=+(raw.slice(13,15)||'0');
  // Z suffix = UTC, convert to local
  if(raw.endsWith('Z')) return new Date(Date.UTC(y,mo,d,h,mi,s));
  // TZID present: treat as local time in that timezone using ISO string trick
  const tzMatch=line.match(/TZID=([^:;,]+)/);
  if(tzMatch){
    try{
      // Build an ISO string and force-interpret in the given TZ
      // (isoStr removed — unused)
      // Use Temporal-style trick: format a known UTC time in the target TZ and find the offset
      const refUTC=new Date(Date.UTC(y,mo,d,h,mi,s));
      const localStr=refUTC.toLocaleString('en-US',{timeZone:tzMatch[1],hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
      // localStr looks like "04/01/2026, 21:00:00" when UTC 19:00 → AMS 21:00 (CEST)
      const [datePart,timePart]=localStr.split(', ');
      const [lmo,ld,ly]=datePart.split('/').map(Number);
      const [lh,lmi,ls]=timePart.split(':').map(Number);
      // offset = local-interpreted h minus what TZ gave us
      const diffMs=(new Date(ly,lmo-1,ld,lh,lmi,ls)-new Date(y,mo,d,h,mi,s));
      return new Date(Date.UTC(y,mo,d,h,mi,s)-diffMs);
    }catch(e){
      return new Date(y,mo,d,h,mi,s);
    }
  }
  // No Z, no TZID: treat as local time (already correct for browser's local TZ)
  return new Date(y,mo,d,h,mi,s);
}

function parseICS(txt){
  const evs=[],lines=txt.replace(/\r\n /g,'').replace(/\r\n\t/g,'').split(/\r\n|\r|\n/);
  let ev=null;
  for(const raw of lines){
    const l=raw.trim();
    if(l==='BEGIN:VEVENT'){ev={};continue}
    if(l==='END:VEVENT'){if(ev&&ev.start)evs.push(ev);ev=null;continue}
    if(!ev)continue;
    const c=l.indexOf(':');if(c<0)continue;
    const k=l.slice(0,c).replace(/;.*/,'').toUpperCase(),v=l.slice(c+1).trim();
    if(k==='SUMMARY')ev.title=v;
    if(k==='DESCRIPTION')ev.desc=v.replace(/\\n/g,'\n').replace(/\\,/g,',');
    if(k==='LOCATION')ev.location=v;
    if(k==='DTSTART'||l.startsWith('DTSTART'))ev.start=pDate(l);
    if(k==='DTEND'||l.startsWith('DTEND'))ev.end=pDate(l);
    if(k==='RRULE')ev.rrule=v;
    if(k==='UID')ev.uid=v;
    if(k==='RECURRENCE-ID'||l.startsWith('RECURRENCE-ID'))ev.recurId=pDate(l);
    if(k==='EXDATE'||l.startsWith('EXDATE')){
      // EXDATE may be comma-separated; each value may have TZID on the property
      const vals=v.split(',');
      const exDates=vals.map(d=>pDate(l.slice(0,l.indexOf(':'))+'DTSTART:'+d.trim()));
      ev.exdates=(ev.exdates||[]).concat(exDates);
    }
  }
  return evs;
}

const BD={MO:1,TU:2,WE:3,TH:4,FR:5,SA:6,SU:0};
function expand(ev,rs,re){
  if(!ev.rrule)return[ev];
  const p={};ev.rrule.split(';').forEach(x=>{const[k,v]=x.split('=');p[k]=v});
  const freq=p.FREQ,until=p.UNTIL?pDate('DTSTART:'+p.UNTIL):null;
  const cnt=p.COUNT?+p.COUNT:9999,iv=p.INTERVAL?+p.INTERVAL:1;

  // Parse BYDAY — may have position prefix like 1WE, -1FR etc.
  let byday=null,bydayPos=null;
  if(p.BYDAY){
    const parts=p.BYDAY.split(',');
    byday=parts.map(x=>BD[x.replace(/[^A-Z]/g,'')]);
    bydayPos=parts.map(x=>{const m=x.match(/^(-?\d+)/);return m?+m[1]:0;});
  }

  // Duration in ms — for all-day events use 1 day, for timed use actual diff
  const isAD=ev.start._ad;
  const dur=isAD?86400000:(ev.end&&ev.start?ev.end.getTime()-ev.start.getTime():3600000);

  // Build exclusion sets: one for full datetime, one for date-only (for safety)
  const exSetDT=new Set((ev.exdates||[]).map(d=>{
    if(d._ad) return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
  }));
  const exSetDate=new Set((ev.exdates||[]).map(d=>`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`));

  function isExcluded(d){
    const dateKey=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const dtKey=`${dateKey}-${d.getHours()}-${d.getMinutes()}`;
    // For timed recurring events, match by datetime; for all-day match by date
    if(isAD) return exSetDate.has(dateKey);
    // Match by full datetime first, then fall back to date-only if exdate was all-day
    return exSetDT.has(dtKey) || exSetDT.has(dateKey);
  }

  const res=[];let cur=new Date(ev.start),n=0;
  // For all-day events, work with date-only (strip time)
  if(isAD) cur.setHours(0,0,0,0);
  // Safety: if starting well before range, fast-forward by frequency
  // to avoid thousands of iterations (but still count them for COUNT limit)
  if(freq==='WEEKLY'&&iv===1&&cur<rs){
    const weeksBack=Math.floor((rs-cur)/(7*86400000));
    if(weeksBack>2){
      n+=weeksBack-2;
      cur=addD(cur,7*(weeksBack-2));
    }
  } else if(freq==='MONTHLY'&&iv===1&&cur<rs){
    const monthsBack=Math.max(0,(rs.getFullYear()-cur.getFullYear())*12+(rs.getMonth()-cur.getMonth())-2);
    if(monthsBack>0){
      n+=monthsBack;
      cur=new Date(cur.getFullYear(),cur.getMonth()+monthsBack,cur.getDate(),cur.getHours(),cur.getMinutes(),0);
    }
  }

  // Helper: does date d match BYDAY with optional position for given month?
  function matchesByday(d){
    if(!byday)return true;
    for(let i=0;i<byday.length;i++){
      if(d.getDay()!==byday[i])continue;
      const pos=bydayPos?bydayPos[i]:0;
      if(!pos)return true; // no position constraint
      if(pos>0){
        let count=0,dd=new Date(d.getFullYear(),d.getMonth(),1);
        while(dd.getMonth()===d.getMonth()){
          if(dd.getDay()===byday[i])count++;
          if(dd.getDate()===d.getDate())return count===pos;
          dd.setDate(dd.getDate()+1);
        }
      } else {
        let last=null,dd=new Date(d.getFullYear(),d.getMonth(),1);
        while(dd.getMonth()===d.getMonth()){
          if(dd.getDay()===byday[i])last=new Date(dd);
          dd.setDate(dd.getDate()+1);
        }
        if(last&&last.getDate()===d.getDate())return true;
      }
    }
    return false;
  }

  while(cur<=re&&n<cnt){
    if(until&&cur>until)break;
    if(matchesByday(cur)){
      if(cur>=rs&&!isExcluded(cur)){
        const newStart=new Date(cur);
        if(isAD) newStart._ad=true;
        const newEnd=new Date(cur.getTime()+dur);
        if(ev.end&&ev.end._ad) newEnd._ad=true;
        res.push({...ev,start:newStart,end:newEnd});
      }
      n++; // count ALL occurrences (not just in-range), to respect COUNT limit
    }
    if(freq==='DAILY') cur=addD(cur,iv);
    else if(freq==='WEEKLY'){
      if(byday&&byday.length>1&&bydayPos&&!bydayPos.some(x=>x)){
        let nx=addD(cur,1);
        for(let i=0;i<7;i++){if(byday.includes(nx.getDay()))break;nx=addD(nx,1)}
        cur=nx;
      } else cur=addD(cur,7*iv);
    } else if(freq==='MONTHLY'){
      // hasPos removed — unused
      const hasByday=byday&&byday.length>0;
      // Advance to first day of next month, preserving original hours/minutes
      const origH=ev.start.getHours(), origM=ev.start.getMinutes();
      if(hasByday){
        const nextMonth=new Date(cur.getFullYear(),cur.getMonth()+iv,1,origH,origM,0);
        let found=false;
        for(let dd=0;dd<31&&!found;dd++){
          const t=new Date(nextMonth.getFullYear(),nextMonth.getMonth(),1+dd,origH,origM,0);
          if(t.getMonth()!==nextMonth.getMonth())break;
          if(matchesByday(t)){cur=t;found=true;}
        }
        if(!found)cur=addD(cur,30);
      } else {
        cur=new Date(cur.getFullYear(),cur.getMonth()+iv,cur.getDate(),origH,origM,0);
      }
    } else if(freq==='YEARLY'){
      const origH=ev.start.getHours(),origM=ev.start.getMinutes();
      cur=new Date(cur.getFullYear()+iv,cur.getMonth(),cur.getDate(),origH,origM,0);
    } else {
      cur=addD(cur,1); // unknown: avoid infinite loop
    }
  }
  if(ev.rrule) return res;
  return res.length?res:[ev];
}

function showSkeleton(){
  const nCols=6, nRows=8;
  let h=`<div class="skel-wrap">`;
  h+=`<div class="skel-hdr"><div class="skel-hdr-time"></div>`;
  for(let i=0;i<nCols;i++)h+=`<div class="skel-hdr-day"></div>`;
  h+=`</div>`;
  for(let r=0;r<nRows;r++){
    h+=`<div class="skel-row"><div class="skel-time"></div>`;
    for(let c=0;c<nCols;c++){
      const hasEv=(r===1&&c===0)||(r===2&&c===2)||(r===4&&c===1)||(r===5&&c===4)||(r===3&&c===3);
      h+=`<div class="skel-cell${hasEv?' has-ev':''}"></div>`;
    }
    h+=`</div>`;
  }
  h+=`</div>`;
  const el=document.getElementById('skelLoad')||document.getElementById('panelCur');
  if(el)el.innerHTML=h;
}

function appendQueryParam(url, key, value){
  const sep=url.includes('?')?'&':'?';
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

async function tryFetch(proxyFn, url, opts={}) {
  const cacheBust=Date.now();
  const sourceUrl=opts.forceRefresh?appendQueryParam(url,'_refresh',cacheBust):url;
  const r = await fetch(proxyFn(url,{...opts,cacheBust,sourceUrl}), {cache:'no-store',signal: AbortSignal.timeout(5000)});
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await r.text();
  if (!t.includes('BEGIN:VCALENDAR')) throw new Error('Geen geldige ICS data');
  return t;
}

async function fetchEvents(silent=false, forceRefresh=false){
  document.getElementById('ls').textContent=UI.loading;
  if(!silent) showSkeleton();

  async function fetchOne(icsUrl, tag){
    let lastError;
    for(const proxyFn of PROXIES){
      try{
        const text = await tryFetch(proxyFn, icsUrl, {forceRefresh});
        return parseICS(text).map(ev=>({...ev,_cal:tag}));
      } catch(e){ lastError=e; }
    }
    throw lastError || new Error('Kalender kon niet worden geladen');
  }

  try {
    const [rooster, afspraken, mainEv] = await Promise.allSettled([
      fetchOne(ICS_ROOSTER,  'rooster'),
      fetchOne(ICS_AFSPRAKEN,'afspraken'),
      fetchOne(ICS_MAIN,     'main'),
    ]);

    const rEv  = rooster.status==='fulfilled'   ? rooster.value   : [];
    const aEv  = afspraken.status==='fulfilled' ? afspraken.value : [];
    const mEv  = mainEv.status==='fulfilled'    ? mainEv.value   : [];

    // Deduplicate: if afspraken returns rooster events (same UID), discard from afspraken
    const roosterUIDs = new Set(rEv.map(e=>e.uid).filter(Boolean));
    const aEvFiltered = aEv.filter(e=>!e.uid || !roosterUIDs.has(e.uid));

    const combined = [...rEv, ...aEvFiltered, ...mEv];

    // Normalize UID for matching — strip _R... suffix (detached series notation)
    function baseUID(uid){ return uid ? uid.replace(/_R\d{8}T\d+$/, '') : ''; }

    // Separate override events (have RECURRENCE-ID) from base events
    const overrides  = combined.filter(e => e.recurId);
    const baseEvents = combined.filter(e => !e.recurId && !shouldFilterEvent(e));

    // Also filter out override events that match filter keywords
    const overridesFiltered = overrides.filter(e => !shouldFilterEvent(e));

    // For each override, add its recurId date as EXDATE on the matching base series
    overrides.forEach(ov => {
      if(!ov.uid) return;
      const buid = baseUID(ov.uid);
      // Find ALL base recurring events with matching UID (there may be several series)
      const bases = baseEvents.filter(b => b.rrule && baseUID(b.uid) === buid);
      bases.forEach(base => {
        base.exdates = base.exdates || [];
        base.exdates.push(ov.recurId);
      });
    });

    loadLocalShifts();
    allEv = mergeLocalShifts([...baseEvents, ...overridesFiltered]);

    const rCount=rEv.length, aCount=aEvFiltered.length;
    document.getElementById('ls').textContent=`✓ ${rCount}+${aCount} event(s)`;
    render(0);
  } catch(e) {
    document.getElementById('ls').textContent=UI.loadFail;
    document.getElementById('panelCur').innerHTML=`
    <div class="err-box">
      <h3>📡 Kalender kon niet worden geladen</h3>
      <p>Alle CORS-proxies zijn geblokkeerd of onbereikbaar. Dit is een browser-beveiligingsbeperking bij het lokaal openen van het HTML-bestand.</p>
      <p style="margin-top:10px"><strong>Oplossingen (kies één):</strong></p>
      <ol>
        <li><strong>Op Plesk/server zetten</strong> – Upload dit bestand naar je webserver. Voeg dan een PHP-proxy toe (zie knop hieronder).</li>
        <li><strong>Lokaal via webserver</strong> – Open via <code>localhost</code> i.p.v. direct als bestand.</li>
        <li><strong>PHP-proxy gebruiken</strong> – Maak een bestand <code>proxy.php</code> op je server (knop hieronder).</li>
      </ol>
      <p style="margin-top:12px">
        <button onclick="showPhpCode()" style="background:var(--gm);color:#fff;border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600;font-size:.82rem">
          📄 Toon proxy.php code
        </button>
        <button onclick="retryLoad()" style="background:var(--am);color:var(--gd);border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600;font-size:.82rem;margin-left:8px">
          🔄 Opnieuw proberen
        </button>
      </p>
      <pre id="phpCode" style="display:none;margin-top:14px;background:#f0f4f0;border-radius:8px;padding:14px;font-size:.74rem;overflow-x:auto;white-space:pre;border:1px solid var(--gp)"></pre>
    </div>`;
  }
}

function retryLoad(){ showSkeleton(); fetchEvents(false, true); }

function showPhpCode(){
  const el=document.getElementById('phpCode');
  el.style.display=el.style.display==='none'?'block':'none';
  el.textContent=`<?php
// proxy.php — sla dit op naast parknest-rooster.html op je Plesk server
$ics_url = 'https://calendar.google.com/calendar/ical/f0a70a3f3862ea4c0202a62f4bd8b3298a1cd69d53e57944c0dcaeab39b54dc6%40group.calendar.google.com/public/basic.ics';

// Cache 15 minuten
$cache_file = sys_get_temp_dir() . '/parknest_ics_cache.txt';
$cache_time = 900;

if (file_exists($cache_file) && (time() - filemtime($cache_file)) < $cache_time) {
    $data = file_get_contents($cache_file);
} else {
    $data = file_get_contents($ics_url);
    if ($data !== false) file_put_contents($cache_file, $data);
}

header('Content-Type: text/calendar; charset=UTF-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: max-age=900');
echo $data;`;
}

function updateAuthUI(){
  const info=document.getElementById('loginInfo');
  const logoutBtn=document.getElementById('logoutBtn');
  const googleBtn=document.getElementById('googleBtn');
  const googleStatus=document.getElementById('googleStatus');
  const editor=document.getElementById('editorPanel');

  if(loggedInUser){
    info.textContent=`Ingelogd als ${loggedInUser.name} (${loggedInUser.email})`;
    logoutBtn.style.display='inline-flex';
    editor.style.display='block';
  } else {
    info.textContent='Niet ingelogd';
    logoutBtn.style.display='none';
    editor.style.display='none';
  }

  if(hasGoogleConfig()){
    googleBtn.style.display='inline-flex';
    if(googleSignedIn){
      googleStatus.textContent='Google: ingelogd';
      googleStatus.style.color='#0a7a0a';
    } else {
      googleStatus.textContent='Google: niet ingelogd';
      googleStatus.style.color='#7a1f1f';
    }
  } else {
    googleBtn.style.display='none';
    googleStatus.textContent='';
  }
}

function showCrewLegend(){
  const el=document.getElementById('crewLegend');
  if(!el)return;
  // Hide chips and use the crew pulldown selector instead.
  el.style.display='none';
}

function populateCrewPicker(){
  const picker=document.getElementById('crewPicker');
  if(!picker)return;
  picker.innerHTML='';
  CONFIG.crew.forEach(c=>{
    const opt=document.createElement('option');opt.value=c.name;opt.textContent=c.name;picker.appendChild(opt);
  });
}

function logoutAction(){ loggedInUser=null; updateAuthUI(); }

async function addShiftAction(){
  if(!loggedInUser){ alert('Log in via Google om diensten toe te voegen.'); return; }
  const date=document.getElementById('newShiftDate').value;
  const start=document.getElementById('newShiftStart').value;
  const end=document.getElementById('newShiftEnd').value;
  const crew=document.getElementById('crewPicker').value;
  if(!date||!start||!end||!crew){ alert('Vul datum, start, eind en crew in.'); return; }
  const dtStart=new Date(`${date}T${start}`);
  const dtEnd=new Date(`${date}T${end}`);
  if(dtEnd<=dtStart){ alert('Eindtijd moet na starttijd zijn.'); return; }
  const newShift={
    id:`local-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    title: crew,
    desc: `Toegevoegd door ${loggedInUser.email}`,
    start: dtStart.toISOString(),
    end: dtEnd.toISOString(),
    location: 'Parknest',
    active: true
  };

  if(hasGoogleConfig()){
    try{
      await loadGoogleClient();
      if(googleSignedIn){
        const eventId=await insertEventInGoogle(newShift);
        if(eventId){ newShift.googleEventId=eventId; showShareToast('Dienst in Google Agenda toegevoegd.'); }
      }
    } catch(e){ console.warn('Google add failed',e); }
  }

  localShifts.push(newShift);
  saveLocalShifts();
  fetchEvents(false, true);
  showShareToast(`Dienst toegevoegd voor ${crew} op ${date}`);
}

function deleteLocalShift(localId){
  const shift = localShifts.find(s=>s.id===localId);
  if(shift?.googleEventId && googleSignedIn && hasGoogleConfig()){
    deleteEventInGoogle(shift.googleEventId);
  }
  localShifts = localShifts.filter(s=>s.id!==localId);
  saveLocalShifts();
  fetchEvents(false, true);
}

function initEditFeatures(){
  const logoutBtn = document.getElementById('logoutBtn');
  const googleBtn = document.getElementById('googleBtn');
  const addShiftBtn = document.getElementById('addShiftBtn');
  const newShiftDate = document.getElementById('newShiftDate');

  logoutBtn?.addEventListener('click', logoutAction);
  googleBtn?.addEventListener('click', async()=>{
    if(googleSignedIn){ signOutGoogle(); } else { await signInGoogle(); }
  });

  if(addShiftBtn && newShiftDate){
    addShiftBtn.addEventListener('click', addShiftAction);
    newShiftDate.value = (new Date()).toISOString().slice(0,10);
    populateCrewPicker();
  }

  showCrewLegend();
  updateAuthUI();
}

function hasTuesdayEvents(anchorDate){
  // Check if any event in allEv falls on a Tuesday of this week
  const tue=addD(anchorDate,1); // anchor is Monday, +1 = Tuesday
  tue.setHours(0,0,0,0);
  const tueEnd=new Date(tue);tueEnd.setHours(23,59,59,999);
  return allEv.some(ev=>{
    if(!ev.start)return false;
    const evStart=new Date(ev.start);evStart.setHours(0,0,0,0);
    if(same(evStart,tue))return true;
    // Check recurring
    if(ev.rrule){
      const copies=expand(ev,tue,tueEnd);
      return copies.some(c=>{const s=new Date(c.start);s.setHours(0,0,0,0);return same(s,tue)});
    }
    return false;
  });
}

// Returns column definitions: one per visible day, no merging
function getColDefs(anchorDate){
  if(vm==='hours') return [];
  if(vm==='day') return [{days:[new Date(anchorDate)],narrow:false}];
  const showTue=hasTuesdayEvents(anchorDate);
  const week=[];for(let i=0;i<7;i++)week.push(addD(anchorDate,i));
  return week
    .filter(d=> showTue || d.getDay()!==2)
    .map(d=>({days:[d],narrow:false}));
}

function getDays(){
  if(vm==='hours') return [new Date(anc)];
  if(vm==='day') return [new Date(anc)];
  const showTue=hasTuesdayEvents(anc);
  const week=[];for(let i=0;i<7;i++)week.push(addD(anc,i));
  if(!showTue)return week.filter(d=>d.getDay()!==2);
  return week;
}

function isPhone(){ return window.innerWidth < 600 && window.innerHeight > window.innerWidth; }
function isPhoneLandscape(){ return window.innerWidth < 900 && window.innerHeight < 500 && window.innerWidth > window.innerHeight; }
function isSmall(){ return window.innerWidth >= 600 && window.innerWidth < 1000 && !isPhoneLandscape(); }

// ── NAME-BASED COLOR ────────────────────────────────────
// 12 distinct accessible pastel palettes: [bg, text, accent]
const PALETTES=[
  ['#d8f3dc','#1b4332','#52b788'],
  ['#fff3cd','#6b4c00','#e9a825'],
  ['#d0e8ff','#003566','#5a9fd4'],
  ['#f9d5e5','#6b0f38','#e8739a'],
  ['#ede0ff','#2d0060','#9b59b6'],
  ['#fce8d5','#6b2d0c','#e07b39'],
  ['#d4f1f4','#0b3a40','#18a7b5'],
  ['#fde8e8','#6b0000','#e05555'],
  ['#e8f5e9','#1b5e20','#66bb6a'],
  ['#fff8e1','#4a3900','#f4c430'],
  ['#e8eaf6','#1a237e','#5c6bc0'],
  ['#fce4ec','#4a0020','#e91e8c'],
];

function normalizeName(name){
  return String(name||'').replace(/\?/g,'').trim();
}

function normalizeCrewToken(name){
  return String(name||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[?`"'’‘´]/g,'')
    .replace(/[^a-zA-Z0-9]+/g,'')
    .toLowerCase();
}

function crewAliasMap(){
  const map=new Map();
  (CONFIG.crew||[]).forEach(c=>{
    map.set(normalizeCrewToken(c.name),c.name);
    (c.aliases||[]).forEach(alias=>map.set(normalizeCrewToken(alias),c.name));
  });
  (CONFIG.crew||[]).forEach(c=>{
    const key=normalizeCrewToken(c.name);
    if(!map.has(key+'1'))map.set(key+'1',c.name);
  });
  return map;
}

function crewForName(name){
  const canonical=crewAliasMap().get(normalizeCrewToken(name));
  return (CONFIG.crew||[]).find(c=>c.name===canonical);
}

function nameHasQuestionMark(name){
  return String(name||'').includes('?');
}

function nameHash(str){
  let h=0;
  for(let i=0;i<str.length;i++)h=(h*31+str.charCodeAt(i))>>>0;
  return h%PALETTES.length;
}
function hashInt(str){
  let h=2166136261;
  str=String(str||'');
  for(let i=0;i<str.length;i++){
    h^=str.charCodeAt(i);
    h=Math.imul(h,16777619)>>>0;
  }
  return h>>>0;
}
function sketchTextureSeed(ev, salt=''){
  const start=ev?.start instanceof Date?ev.start.toISOString():String(ev?.start||'');
  const end=ev?.end instanceof Date?ev.end.toISOString():String(ev?.end||'');
  return hashInt(`${salt}|${ev?.uid||ev?.localId||''}|${ev?.title||''}|${start}|${end}`);
}
function sketchTextureStyle(ev, salt=''){
  const h=sketchTextureSeed(ev,salt);
  const n=(shift,bits=7)=>(h>>>shift)&((1<<bits)-1);
  const rot=(n(0,4)-7)*0.7;
  const tooth=54+n(4,5);
  const fill=43+n(8,5);
  const cross=31+n(12,4);
  const grain=4+n(16,2);
  const opacity=(0.46+n(18,4)*0.014).toFixed(2);
  const ox=2+n(22,2);
  const oy=2+n(24,2);
  const wobble=(n(26,3)-3)*0.35;
  // Scale: hash-derived small variation per card (0.97–1.03), tied to color/title
  const afterScale=(0.97+(n(29,3)/7)*0.06).toFixed(3);
  // Rotation offset for ::after based on shift duration: 1h→0deg, 6h→2deg
  const durationMs=(ev?.end instanceof Date&&ev?.start instanceof Date)?ev.end-ev.start:0;
  const durationH=Math.max(0,Math.min(6,durationMs/3600000));
  const afterRot=((durationH-1)*0.4).toFixed(2);
  return [
    `--sk-paper-x:${n(21,6)-18}px`,
    `--sk-paper-y:${n(27,6)-18}px`,
    `--sk-pencil-x:${n(3,6)-18}px`,
    `--sk-pencil-y:${n(9,6)-18}px`,
    `--sk-cross-x:${n(15,5)-10}px`,
    `--sk-cross-y:${n(20,5)-10}px`,
    `--sk-rot:${rot.toFixed(1)}deg`,
    `--sk-paper-size:${tooth}px`,
    `--sk-fill-size:${fill}px`,
    `--sk-cross-size:${cross}px`,
    `--sk-grain-gap:${grain}px`,
    `--sk-wax-opacity:${opacity}`,
    `--sk-corner-x:${ox}px`,
    `--sk-corner-y:${oy}px`,
    `--sk-border-rot:${wobble.toFixed(2)}deg`,
    `--sk-after-scale:${afterScale}`,
    `--sk-after-rot:${afterRot}deg`
  ].join(';');
}
function applySketchTexture(dv, ev, salt=''){
  sketchTextureStyle(ev,salt).split(';').forEach(pair=>{
    const [key,value]=pair.split(':');
    if(key&&value)dv.style.setProperty(key,value);
  });
}

function hexToRgb(hex){
  const h=hex.replace('#','');
  if(h.length===3) return [parseInt(h[0]+h[0],16),parseInt(h[1]+h[1],16),parseInt(h[2]+h[2],16)];
  return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
}
function rgbaFromHex(hex, alpha){
  const [r,g,b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
function darkInkFromHex(hex){
  const [r,g,b]=hexToRgb(hex);
  const darken=v=>Math.max(18,Math.round(v*0.36));
  return `rgb(${darken(r)},${darken(g)},${darken(b)})`;
}
function luminanceFromHex(hex){
  const [r,g,b]=hexToRgb(hex);
  return (r*299+g*587+b*114)/1000;
}
function sketchInkFromHex(hex){
  return luminanceFromHex(hex)<150?'#fff':darkInkFromHex(hex);
}
function contrastTextColor(hex){
  const [r,g,b]=hexToRgb(hex);
  // YIQ formula
  const yiq=(r*299+g*587+b*114)/1000;
  return yiq>=150?'#111':'#fff';
}
function applyColor(dv, title){
  const rawName = String(title||'').trim();
  const normalizedName = normalizeName(rawName);
  const displayName = normalizedName || rawName || '(geen titel)';
  const isQuestion = nameHasQuestionMark(rawName);

  if(isQuestion){
    dv.classList.add('question-shift');
  }

  const crewItem = crewForName(displayName);
  if(crewItem){
    const baseColor = crewItem.color;
    const contrast = contrastTextColor(baseColor);
    dv.style.background = isQuestion ? rgbaFromHex(baseColor, 0.85) : baseColor;
    dv.style.color = isQuestion ? contrast : contrast;
    dv.style.borderLeftColor = baseColor;
    dv.style.setProperty('--sk-bg-color', baseColor);
    dv.style.setProperty('--sk-ink-color', sketchInkFromHex(baseColor));
    if(isQuestion){
      dv.style.border = '4px dashed #000';
      dv.style.borderRadius = '6px';
      dv.style.borderLeft = `4px solid ${baseColor}`;
      dv.style.fontWeight = '700';
      dv.style.boxShadow = '0 0 12px rgba(0,0,0,.25)';
    }
    return;
  }

  const paletteKey = displayName || rawName;
  const [bg,tx,ac]=PALETTES[nameHash(paletteKey)];
  const outlinedBorderColor = ac;
  const contrast = contrastTextColor(outlinedBorderColor);
  dv.style.background = isQuestion ? rgbaFromHex(outlinedBorderColor, 0.85) : bg;
  dv.style.color = isQuestion ? contrast : tx;
  dv.style.borderLeftColor = ac;
  dv.style.setProperty('--sk-bg-color', bg);
  dv.style.setProperty('--sk-ink-color', sketchInkFromHex(bg));
  if(isQuestion){
    dv.style.border = '4px dashed #000';
    dv.style.borderRadius = '6px';
    dv.style.borderLeft = `4px solid ${ac}`;
    dv.style.fontWeight = '700';
    dv.style.boxShadow = '0 0 12px rgba(0,0,0,.25)';
  }
}

function topableEventBlocks(){
  return '.ev.ev-top,.allday-block.ev-top';
}
function resetTopBlock(el){
  el.classList.remove('ev-top');
  el.style.zIndex=el.dataset.baseZ||'';
}
function clearTopBlocks(except){
  document.querySelectorAll(topableEventBlocks()).forEach(el=>{
    if(el!==except) resetTopBlock(el);
  });
}
function promoteBlock(el){
  clearTopBlocks(el);
  el.classList.add('ev-top');
  el.style.zIndex='100';
}
function toggleBlockToFront(el, point){
  const isTop=el.classList.contains('ev-top');
  let target=el;
  if(isTop&&point&&document.elementsFromPoint){
    const stack=document.elementsFromPoint(point.x,point.y).filter(candidate=>
      candidate.classList&&candidate.classList.contains('ev')&&!candidate.classList.contains('main-event')
    );
    const currentIdx=stack.indexOf(el);
    if(currentIdx>-1&&stack.length>1) target=stack[(currentIdx+1)%stack.length];
  }
  if(target===el&&isTop){
    resetTopBlock(el);
    return;
  }
  promoteBlock(target);
}
function activateEventBlock(e, el, ev){
  e.stopPropagation();
  const touch=e.changedTouches&&e.changedTouches[0];
  if(touch&&e.cancelable) e.preventDefault();
  const point=touch?{x:touch.clientX,y:touch.clientY}:('clientX' in e?{x:e.clientX,y:e.clientY}:null);
  if(touch) showTip({clientX:touch.clientX,clientY:touch.clientY},ev);
  toggleBlockToFront(el,point);
}

// Compute dynamic hours using only events that fall on the given column days
function dynamicHoursForCols(exp, cols){
  const daySet=new Set(cols.flatMap(c=>c.days.map(d=>d.toDateString())));
  return dynamicHours(exp.filter(ev=>{
    const d=new Date(ev.start);d.setHours(0,0,0,0);
    return daySet.has(d.toDateString());
  }));
}

function startOfMonth(d){return new Date(d.getFullYear(),d.getMonth(),1)}
function startOfYear(d){return new Date(d.getFullYear(),0,1)}
function rangeForHours(period, anchorDate){
  const start = period==='week' ? sowk(anchorDate) : period==='month' ? startOfMonth(anchorDate) : startOfYear(anchorDate);
  const end = period==='week' ? addD(start,7) : period==='month' ? new Date(start.getFullYear(),start.getMonth()+1,1) : new Date(start.getFullYear()+1,0,1);
  return {start,end};
}
function fmtDate(d){return `${DL[d.getDay()]} ${d.getDate()} ${MN[d.getMonth()]} ${d.getFullYear()}`}
function fmtTime(d){return `${p2(d.getHours())}:${p2(d.getMinutes())}`}
function fmtHours(h){return (Math.round(h*100)/100).toLocaleString(_locale,{minimumFractionDigits:h%1?1:0,maximumFractionDigits:2})}
function hoursWeekDateLabel(anchorDate){
  const start=sowk(anchorDate), end=addD(start,6);
  const sameMonth=start.getMonth()===end.getMonth()&&start.getFullYear()===end.getFullYear();
  const startLabel=sameMonth?String(start.getDate()):`${start.getDate()} ${MN[start.getMonth()]}`;
  return `${startLabel}-${end.getDate()} ${MN[end.getMonth()]} ${end.getFullYear()}`;
}
function hoursPeriodLabel(period, anchorDate){
  const {start,end}=rangeForHours(period,anchorDate);
  if(period==='week'){
    const last=addD(end,-1);
    return `${UI.week} ${getWeekNumber(start)}: ${start.getDate()}-${last.getDate()} ${MN[last.getMonth()]} ${last.getFullYear()}`;
  }
  if(period==='month') return new Intl.DateTimeFormat(_locale,{month:'long',year:'numeric'}).format(start);
  return String(start.getFullYear());
}
function crewNamesForEvent(ev){
  const rawTitle=String(ev.title||'');
  const cleanTitle=normalizeName(rawTitle).toLowerCase();
  if(/\b(afwezig|vakantie|niet)\b/i.test(cleanTitle))return [];

  const aliases=crewAliasMap();
  const names=[];
  const seen=new Set();
  const parts=rawTitle.split(/[\/+,;&]|\ben\b/i);
  parts.forEach(part=>{
    const words=String(part).match(/[A-Za-zÀ-ÿ0-9?`'’‘´-]+/g)||[];
    words.forEach(word=>{
      const key=normalizeCrewToken(word);
      const crew=aliases.get(key);
      if(crew&&!seen.has(crew.toLowerCase())){
        seen.add(crew.toLowerCase());
        names.push(crew);
      }
    });
  });
  return names;
}
function expandedShiftEntries(rangeStart, rangeEnd){
  const effectiveEnd=new Date(rangeEnd);
  if(effectiveEnd<=rangeStart)return [];
  const expanded=[];
  const inclusiveEnd=new Date(effectiveEnd.getTime()-1);
  allEv.forEach(ev=>expanded.push(...expand(ev,rangeStart,inclusiveEnd)));
  return expanded
    .filter(ev=>isShiftEvent(ev)&&!ev.start?._ad&&ev.start&&ev.end)
    .flatMap(ev=>{
      const crews=crewNamesForEvent(ev);
      if(!crews.length)return [];
      const start=new Date(Math.max(ev.start.getTime(),rangeStart.getTime()));
      const end=new Date(Math.min(eventEndMs(ev),effectiveEnd.getTime()));
      const hours=Math.max(0,(end-start)/3600000);
      if(!hours)return [];
      return crews.map(crew=>({crew,start,end,hours,title:ev.title||crew,source:ev._cal||'rooster'}));
    })
    .sort((a,b)=>a.start-b.start||a.crew.localeCompare(b.crew));
}
function totalHoursForCrew(crew, start, end){
  return expandedShiftEntries(start,end)
    .filter(e=>e.crew.toLowerCase()===crew.toLowerCase())
    .reduce((sum,e)=>sum+e.hours,0);
}
function hoursDataFor(anchorDate){
  const todayStart=new Date();todayStart.setHours(0,0,0,0);
  const periods=['week','month','year'];
  const entriesByPeriod={};
  periods.forEach(period=>{
    const {start,end}=rangeForHours(period,anchorDate);
    entriesByPeriod[period]=expandedShiftEntries(start,end);
  });
  return (CONFIG.crew||[]).map(c=>{
    const totals={};
    periods.forEach(period=>{
      totals[period]=entriesByPeriod[period]
        .filter(e=>e.crew.toLowerCase()===c.name.toLowerCase())
        .reduce((sum,e)=>sum+e.hours,0);
    });
    const plannedFromToday=entriesByPeriod.week.some(e=>e.crew.toLowerCase()===c.name.toLowerCase()&&e.end>todayStart);
    return {...c,totals,plannedFromToday};
  }).filter(c=>c.totals.week>0);
}
function hourBreakdownItems(period, anchorDate){
  if(period==='year'){
    const y=anchorDate.getFullYear();
    return Array.from({length:12},(_,m)=>{
      const start=new Date(y,m,1), end=new Date(y,m+1,1);
      return {label:new Intl.DateTimeFormat(_locale,{month:'long'}).format(start),start,end,next:'month'};
    });
  }
  if(period==='month'){
    const monthStart=startOfMonth(anchorDate), monthEnd=new Date(monthStart.getFullYear(),monthStart.getMonth()+1,1);
    const items=[];
    for(let wk=sowk(monthStart);wk<monthEnd;wk=addD(wk,7)){
      const start=new Date(Math.max(wk.getTime(),monthStart.getTime()));
      const end=new Date(Math.min(addD(wk,7).getTime(),monthEnd.getTime()));
      const last=addD(end,-1);
      items.push({label:`${UI.week} ${getWeekNumber(wk)}: ${start.getDate()}-${last.getDate()} ${MN[last.getMonth()]}`,start,end,next:'week'});
    }
    return items;
  }
  const weekStart=sowk(anchorDate);
  return Array.from({length:7},(_,i)=>{
    const start=addD(weekStart,i), end=addD(start,1);
    return {label:fmtDate(start),start,end,next:'day'};
  });
}
function renderHoursShiftList(detail, crew, start, end, label){
  const rows=expandedShiftEntries(start,end).filter(e=>e.crew.toLowerCase()===crew.toLowerCase());
  const total=rows.reduce((sum,e)=>sum+e.hours,0);
  if(!detail)return;
  const body=rows.length
    ? rows.map(e=>{const todayStart=new Date();todayStart.setHours(0,0,0,0);return `<tr class="${e.end>todayStart?'hours-planned-row':''}"><td>${esc(fmtDate(e.start))}</td><td>${fmtTime(e.start)}-${fmtTime(e.end)}</td><td>${esc(e.title)}</td><td>${fmtHours(e.hours)}</td></tr>`}).join('')
    : `<tr><td colspan="4" class="hours-empty">Geen diensten in deze periode.</td></tr>`;
  detail.innerHTML=`<div class="hours-detail-head"><h3>${esc(crew)} - ${esc(label)}</h3><button class="hours-close" type="button" title="Sluit">×</button></div>
    <table class="hours-table"><thead><tr><th>Datum</th><th>Tijd</th><th>Dienst</th><th>Uren</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="3">Totaal</td><td>${fmtHours(total)}</td></tr></tfoot></table>`;
  detail.querySelector('.hours-close')?.addEventListener('click',()=>{detail.innerHTML='';});
  detail.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function renderHoursBreakdown(detail, crew, period, anchorDate){
  if(!detail)return;
  const todayStart=new Date();todayStart.setHours(0,0,0,0);
  const items=hourBreakdownItems(period, anchorDate).map(item=>({...item,hours:totalHoursForCrew(crew,item.start,item.end),plannedFromToday:item.end>todayStart}));
  const total=items.reduce((sum,item)=>sum+item.hours,0);
  const title=period==='year'?'Maanden':period==='month'?'Weken':'Dagen';
  detail.innerHTML=`<div class="hours-detail-head"><h3>${esc(crew)} - ${title} - ${esc(hoursPeriodLabel(period,anchorDate))}</h3><button class="hours-close" type="button" title="Sluit">×</button></div>
    <table class="hours-table"><thead><tr><th>Periode</th><th>Uren</th></tr></thead><tbody>
    ${items.map((item,idx)=>`<tr class="${item.hours?'':'hours-zero'}${item.hours&&item.plannedFromToday?' hours-planned-row':''}"><td><button class="hours-period" type="button" data-hours-break="${idx}"><span>${esc(item.label)}</span><span>${item.next==='day'?'Details':'Open'}</span></button></td><td>${fmtHours(item.hours)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td>Totaal</td><td>${fmtHours(total)}</td></tr></tfoot></table>`;
  detail.querySelector('.hours-close')?.addEventListener('click',()=>{detail.innerHTML='';});
  detail.querySelectorAll('[data-hours-break]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const item=items[+btn.dataset.hoursBreak];
      if(item.next==='day') renderHoursShiftList(detail, crew, item.start, item.end, item.label);
      else renderHoursBreakdown(detail, crew, item.next, item.start);
    });
  });
  detail.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function renderHoursView(container, anchorDate, deferAnimation=false){
  const rows=hoursDataFor(anchorDate);
  const periodLabels={week:'uren deze week',month:'uren deze maand',year:'per jaar'};
  const allTotals={week:rows.reduce((sum,c)=>sum+c.totals.week,0)};
  container.innerHTML=`<div class="hours-report${deferAnimation?' hours-anim-pending':''}"><div class="hours-context"><span class="hours-context-label">${esc(new Intl.DateTimeFormat(_locale,{month:'long',year:'numeric'}).format(anchorDate))}</span><span class="hours-week-nav"><button class="hours-week-arrow" type="button" data-hours-week-nav="-1" title="Vorige week">‹</button><span class="hours-week-label">week ${getWeekNumber(sowk(anchorDate))}</span><button class="hours-week-arrow" type="button" data-hours-week-nav="1" title="Volgende week">›</button></span><span class="hours-date-range">${esc(hoursWeekDateLabel(anchorDate))}</span><span class="hours-all-totals"><span>totaal deze week: <b>${fmtHours(allTotals.week)}</b> uren</span></span></div><div class="hours-summary">
    ${rows.length?rows.map((c,idx)=>{
      const color=c.color||crewColor(c.name);
      const totalButtons=['week','month','year'].map(period=>`<button class="hours-total" type="button" data-hours-crew="${esc(c.name)}" data-hours-period="${period}">
        <b>${fmtHours(c.totals[period])}</b><span>${periodLabels[period]}</span>
      </button>`).join('');
      return `<section class="hours-person${c.plannedFromToday?' hours-person-planned':''}" style="animation-delay:${idx*5}ms"><div class="hours-person-head"><span class="hours-swatch" style="background:${color}"></span><span class="hours-name">${esc(c.name)}</span></div><div class="hours-totals">${totalButtons}</div><div class="hours-inline-detail hours-detail"></div></section>`;
    }).join(''):`<div class="hours-empty">Geen uren gevonden in ${esc(hoursPeriodLabel('week',anchorDate))}.</div>`}
    </div></div>`;
  container.querySelectorAll('[data-hours-week-nav]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      hoursFocusPeriod='week';
      anc=addD(sowk(anc), +btn.dataset.hoursWeekNav*7);
      render(0);
    });
  });
  container.querySelectorAll('[data-hours-crew]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      hoursFocusPeriod=btn.dataset.hoursPeriod||'month';
      updateLabel();
      container.querySelectorAll('.hours-inline-detail').forEach(el=>{if(el!==btn.closest('.hours-person')?.querySelector('.hours-inline-detail'))el.innerHTML='';});
      const detail=btn.closest('.hours-person')?.querySelector('.hours-inline-detail');
      renderHoursBreakdown(detail,btn.dataset.hoursCrew,hoursFocusPeriod,anc);
    });
  });
}

function startHoursAnimation(container){
  const report=container?.querySelector('.hours-anim-pending');
  if(!report)return;
  report.offsetHeight;
  requestAnimationFrame(()=>report.classList.remove('hours-anim-pending'));
}

function renderInto(container, anchorDate, options={}){
  if(vm==='hours'){
    window._dayMaxCols=1;
    updateDayViewMetrics(0);
    renderHoursView(container, anchorDate, !!options.deferHoursAnimation);
    return;
  }
  const colDefs=getColDefs(anchorDate);
  const days=colDefs.flatMap(c=>c.days); // all dates for expand
  const today=new Date();today.setHours(0,0,0,0);
  const rs=new Date(days[0]);rs.setHours(0,0,0,0);
  const re=new Date(days[days.length-1]);re.setHours(23,59,59,999);
  const exp=[];
  for(const ev of allEv)exp.push(...expand(ev,rs,re));
  const byDay={};days.forEach(d=>byDay[d.toDateString()]=[]);
  exp.forEach(ev=>{const ds=new Date(ev.start);ds.setHours(0,0,0,0);const k=ds.toDateString();if(byDay[k]!==undefined)byDay[k].push(ev)});
  if(vm==='day'){
    const {sh:daySh,eh:dayEh}=dynamicHoursForCols(exp,colDefs);
    // Count max concurrent crew columns (include cross-midnight continuations)
    const _dk=colDefs[0].days[0];
    const _ds=new Date(_dk);_ds.setHours(0,0,0,0);
    const _de=new Date(_dk);_de.setHours(23,59,59,999);
    const _crew=exp.filter(ev=>{
      if(ev.start._ad||ev._cal==='main')return false;
      const s=ev.start.getTime(),e=ev.end?ev.end.getTime():s+3600000;
      return s<=_de.getTime()&&e>_ds.getTime();
    });
    const _asgn=assignColumns(_crew,20);
    const _maxCols=_asgn.length?Math.max(..._asgn.map(a=>a.col))+1:1;
    window._dayMaxCols=_maxCols;
    updateDayViewMetrics(dayEh-daySh,_maxCols);
  } else {
    window._dayMaxCols=1;
    updateDayViewMetrics(0);
  }
  const cm={};let ci=0;

  if(vm==='week' && isPhoneLandscape()){
    // Phone landscape: show full week as 3+3 split (like tablet)
    const row1=colDefs.slice(0,3);
    const row2=colDefs.slice(3);
    container.innerHTML=`<div class="split-wrap"><div id="sgA"></div><div id="sgB"></div></div>`;
    const {sh:sh1,eh:eh1}=dynamicHoursForCols(exp,row1);
    const {sh:sh2,eh:eh2}=dynamicHoursForCols(exp,row2);
    buildGrid(container.querySelector('#sgA'),row1,today,exp,cm,ci,byDay,sh1,eh1);
    buildGrid(container.querySelector('#sgB'),row2,today,exp,cm,ci,byDay,sh2,eh2);
  } else if(vm==='week' && isSmall()){
    const showTue=hasTuesdayEvents(anchorDate);
    if(showTue){
      const allDays=colDefs.map(c=>c.days[0]);
      const weekendDays=allDays.filter(d=>d.getDay()===6||d.getDay()===0);
      const nonWeekend=colDefs.filter(c=>c.days[0].getDay()!==6&&c.days[0].getDay()!==0);
      const row1=nonWeekend.slice(0,3);
      const row2=nonWeekend.slice(3);
      container.innerHTML=`<div class="split-wrap"><div id="sgA"></div><div id="sgB2"></div></div>`;
      const {sh:sh1,eh:eh1}=dynamicHoursForCols(exp,row1);
      const {sh:sh2,eh:eh2}=dynamicHoursForCols(exp,row2);
      buildGrid(container.querySelector('#sgA'),row1,today,exp,cm,ci,byDay,sh1,eh1);
      buildGridWithCompact(container.querySelector('#sgB2'),row2,weekendDays,today,exp,cm,ci,byDay,sh2,eh2);
    } else {
      const row1=colDefs.slice(0,3);
      const row2=colDefs.slice(3);
      container.innerHTML=`<div class="split-wrap"><div id="sgA"></div><div id="sgB"></div></div>`;
      const {sh:sh1,eh:eh1}=dynamicHoursForCols(exp,row1);
      const {sh:sh2,eh:eh2}=dynamicHoursForCols(exp,row2);
      buildGrid(container.querySelector('#sgA'),row1,today,exp,cm,ci,byDay,sh1,eh1);
      buildGrid(container.querySelector('#sgB'),row2,today,exp,cm,ci,byDay,sh2,eh2);
    }
  } else if(vm==='week' && isPhone()){
    // Phone portrait: 3 rows × 2 cols (+ optional 4th row for Zo when Tue active)
    // colDefs: without Tue = [Ma,Wo,Do,Vr,Za,Zo] (6), with Tue = [Ma,Di,Wo,Do,Vr,Za,Zo] (7)
    const showTue=hasTuesdayEvents(anchorDate);
    const ids=['sgP0','sgP1','sgP2','sgP3'];
    let rows;
    if(!showTue){
      // 6 cols → 3 rows of 2: [Ma,Wo] [Do,Vr] [Za,Zo]
      rows=[colDefs.slice(0,2),colDefs.slice(2,4),colDefs.slice(4,6)];
    } else {
      // 7 cols → [Ma,Di] [Wo,Do] [Vr,Za] [Zo]
      rows=[colDefs.slice(0,2),colDefs.slice(2,4),colDefs.slice(4,6),colDefs.slice(6,7)];
    }
    const divs=rows.map((_,i)=>`<div id="${ids[i]}"></div>`).join('');
    container.innerHTML=`<div class="split-wrap">${divs}</div>`;
    rows.forEach((rowCols,i)=>{
      const {sh:rsh,eh:reh}=dynamicHoursForCols(exp,rowCols);
      buildGrid(container.querySelector('#'+ids[i]),rowCols,today,exp,cm,ci,byDay,rsh,reh);
    });
  } else {
    container.innerHTML=`<div class="cw"><div id="cg"></div></div>`;
    const cg=container.querySelector('#cg');
    cg.style.borderRadius='0';cg.style.overflow='visible';
    cg.style.boxShadow='var(--sh)';cg.style.background='#fff';cg.style.margin='0 auto';
    cg.style.maxWidth='100%';
    const {sh,eh}=dynamicHoursForCols(exp,colDefs);
    buildGrid(cg,colDefs,today,exp,cm,ci,byDay,sh,eh);
  }
}

function render(dir=0){
  document.body.classList.toggle('view-day', vm==='day');
  document.body.classList.toggle('view-week', vm==='week');
  document.body.classList.toggle('view-hours', vm==='hours');
  document.getElementById('bW').classList.toggle('on', vm==='week');
  document.getElementById('bD').classList.toggle('on', vm==='day');
  const inner  = document.getElementById('slideInner');
  const panCur = document.getElementById('panelCur');
  const panPrev= document.getElementById('panelPrev');
  const panNext= document.getElementById('panelNext');

  if(dir===0 || !inner){
    // Initial load — no animation
    renderInto(panCur, anc, {deferHoursAnimation:vm==='hours'});
    startHoursAnimation(panCur);
    inner.style.transition='none';
    inner.style.transform='translateX(-100%)';
    updateLabel();
    updateWeekStrip();
    return;
  }

  // Pre-render adjacent panel
  if(dir>0){
    renderInto(panNext, anc, {deferHoursAnimation:vm==='hours'});
    inner.style.transition='none';
    inner.style.transform='translateX(-100%)'; // show current
    panNext.offsetHeight; // force reflow
    inner.style.transition='transform .28s cubic-bezier(.4,0,.2,1)';
    inner.style.transform='translateX(-200%)'; // slide to next
  } else {
    renderInto(panPrev, anc, {deferHoursAnimation:vm==='hours'});
    inner.style.transition='none';
    inner.style.transform='translateX(-100%)';
    panPrev.offsetHeight;
    inner.style.transition='transform .28s cubic-bezier(.4,0,.2,1)';
    inner.style.transform='translateX(0%)'; // slide to prev
  }

  // Set up transition end handler with timeout fallback for mobile
  let transitionCompleted = false;
  const completeTransition = () => {
    if(transitionCompleted) return;
    transitionCompleted = true;
    clearTimeout(transitionTimeout);

    // Re-render the center panel after the slide so copied markup does not lose
    // its event listeners (day-label zoom, event selection, tooltips).
    renderInto(panCur, anc, {deferHoursAnimation:vm==='hours'});
    panPrev.innerHTML='';
    panNext.innerHTML='';
    inner.style.transition='none';
    inner.style.transform='translateX(-100%)';
    updateLabel();
    updateWeekStrip();
    startHoursAnimation(panCur);
  };

  inner.addEventListener('transitionend', completeTransition, {once:true});

  // Timeout fallback for mobile browsers that may not fire transitionend reliably
  const transitionTimeout = setTimeout(completeTransition, 350);
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function updateLabel(){
  if(vm==='hours'){
    document.getElementById('pl').textContent=`${UI.hours}: ${hoursPeriodLabel(hoursFocusPeriod,anc)}`;
    syncUrl();
    return;
  }
  const days=getDays().sort((a,b)=>a-b);
  if(vm==='day'){const d=days[0];document.getElementById('pl').textContent=`${DL[d.getDay()]} ${d.getDate()} ${MN[d.getMonth()]} ${d.getFullYear()}`}
  else{
    const s=days[0],e=days[days.length-1];
    const weekNum = getWeekNumber(s);
    const yearShort = e.getFullYear().toString().slice(-2);
    const isMobile = window.innerWidth < 600;
    if(isMobile){
      document.getElementById('pl').textContent=`${UI.wkShort} ${weekNum}: ${s.getDate()}–${e.getDate()} ${MN[e.getMonth()]} ${yearShort}`;
    } else {
      document.getElementById('pl').textContent=`${UI.week} ${weekNum} : ${s.getDate()}–${e.getDate()} ${MN[e.getMonth()]} ${yearShort}`;
    }
  }
  syncUrl();
}

let _syncingFromHistory = false;

function slugForCurrentView(){
  const days=getDays().sort((a,b)=>a-b);
  const d=vm==='hours'?new Date(anc):days[0];
  return '#'+vm+'/'+`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
}

function applySlug(slug){
  const m=String(slug||'').match(/^#(week|day|hours)\/(\d{4}-\d{2}-\d{2})$/);
  if(!m) return false;
  const d=new Date(m[2]+'T00:00:00');
  if(isNaN(d)) return false;
  vm=m[1];
  anc=vm==='week'?sowk(d):d;
  return true;
}

function syncUrl(){
  const slug=slugForCurrentView();
  if(location.hash===slug) return;
  if(_syncingFromHistory){
    history.replaceState({overlap:true},'',location.pathname+slug);
    return;
  }
  history.pushState({overlap:true},'',location.pathname+slug);
}

window.addEventListener('popstate',()=>{
  if(!applySlug(location.hash)) return;
  _syncingFromHistory=true;
  render(0);
  _syncingFromHistory=false;
});

function scrollToToday(){
  requestAnimationFrame(()=>{
    const now=new Date();
    const curH=now.getHours()+now.getMinutes()/60;
    const todayKey=new Date();todayKey.setHours(0,0,0,0);
    const key=todayKey.toDateString();
    if(vm==='week'){
      const label=document.querySelector(`[data-toggle-day="${key}"]`);
      if(!label) return;
      scrollElementToTop(label);
      return;
    }
    // target: current hour minus 1 so context is visible above
    const targetH=Math.max(0,Math.floor(curH)-1);
    // In day view restrict search to panelCur to avoid matching prev/next panels
    const root=vm==='day'?document.getElementById('panelCur'):document;
    let cell=(root||document).querySelector(`[data-col="${key}"][data-h="${targetH}"]`);
    if(!cell) cell=document.querySelector('.ch.tc');
    if(!cell) return;
    scrollElementToTop(cell);
  });
}

function scrollElementToTop(el){
  // Manual scroll that respects the fixed header height (scrollIntoView block:'start'
  // would put the target behind the header bar on mobile and tablet)
  const hdrH=(document.querySelector('header')||{offsetHeight:64}).offsetHeight||64;
  const rect=el.getBoundingClientRect();
  const dest=window.scrollY+rect.top-hdrH-8;
  window.scrollTo({top:Math.max(0,dest),behavior:'smooth'});
}

// ── OVERLAP LAYOUT ─────────────────────────────────────
function assignColumns(evList, maxCols=3){
  // Prioritize main calendar events in the lowest column, then by start time.
  const sorted=[...evList].sort((a,b)=>{
    if(a._cal==='main' && b._cal!=='main') return -1;
    if(a._cal!=='main' && b._cal==='main') return 1;
    return a.start.getTime()-b.start.getTime();
  });
  const cols=[];  // tracks end-time of last event in each column
  const result=[];
  const TOLERANCE=45*60*1000; // 45 min overlap tolerance — if a col ends within 45min of our start, we can share

  for(const ev of sorted){
    const s=ev.start._ad?0:ev.start.getTime();
    const e=ev.end
      ?(ev.end._ad ? ev.start.getTime()+8*3600000 : ev.end.getTime())
      :s+3600000;
    let placed=false;
    // First pass: find a column that ends at or before our start (no overlap)
    for(let c=0;c<cols.length&&c<maxCols;c++){
      if(cols[c]<=s){cols[c]=e;result.push({ev,col:c,total:0,overflow:false});placed=true;break}
    }
    // Second pass: find a column with minimal overlap (within tolerance)
    if(!placed){
      for(let c=0;c<cols.length&&c<maxCols;c++){
        if(cols[c]-s<=TOLERANCE){cols[c]=Math.max(cols[c],e);result.push({ev,col:c,total:0,overflow:false});placed=true;break}
      }
    }
    if(!placed){
      if(cols.length<maxCols){
        cols.push(e);result.push({ev,col:cols.length-1,total:0,overflow:false});
      } else {
        // Truly can't fit — goes to compact overflow strip
        result.push({ev,col:maxCols-1,total:0,overflow:true});
      }
    }
  }
  // Compute total via connected components of the overlap graph.
  // Events in separate time groups (no mutual overlap) get independent totals,
  // so e.g. afternoon shifts that reuse morning columns start from col 0 width.
  const evMs=(r)=>{
    const s=r.ev.start._ad?0:r.ev.start.getTime();
    const e=r.ev.end?(r.ev.end._ad?s+86400000:r.ev.end.getTime()):s+3600000;
    return{s,e};
  };
  const overlaps=(r,o)=>{
    const{s,e}=evMs(r),{s:os,e:oe}=evMs(o);
    return os<e&&oe>s;
  };
  const visited=new Set();
  result.forEach(r=>{
    if(r.overflow||visited.has(r))return;
    // BFS to find connected component
    const comp=[],queue=[r];
    while(queue.length){
      const cur=queue.shift();
      if(visited.has(cur))continue;
      visited.add(cur);comp.push(cur);
      result.forEach(o=>{if(!o.overflow&&!visited.has(o)&&overlaps(cur,o))queue.push(o);});
    }
    const maxCol=Math.max(...comp.map(c=>c.col));
    comp.forEach(c=>c.total=maxCol+1);
  });
  return result;
}

function buildCompactCard(container, days, today, exp){
  let html='';
  days.forEach((d)=>{
    const k=d.toDateString();
    const tc=same(d,today)?' tc':'';
    const evs=exp.filter(ev=>{
      const ds=new Date(ev.start);ds.setHours(0,0,0,0);
      return ds.toDateString()===k;
    }).sort((a,b)=>a.start-b.start);

    // Day header — match regular grid day header style
    html+=`<div class="compact-card-hdr${tc}" data-toggle-day="${d.toISOString()}">
      <div class="dayline"><span class="dn-s">${DS[d.getDay()]}</span><span class="dd-s"> ${d.getDate()}</span><span class="dm-s"> ${MN[d.getMonth()]}</span></div>
    </div>`;

    // Shifts list
    html+=`<div class="compact-day-col${evs.length===0?' empty':''}">`;
    if(evs.length===0){
      html+=`<div class="compact-empty">—</div>`;
    } else {
      let idx=0;
      evs.forEach(ev=>{
        const rawName = String(ev.title||'').trim();
        const normalizedName = normalizeName(rawName);
        const keyName = normalizedName || rawName || '';
        const [bg,tx,ac]=PALETTES[nameHash(keyName)];
        const isQuestion = nameHasQuestionMark(rawName);
        const isDanger = rawName.includes('**');
        const ts=ev.start._ad?'Hele dag':`${p2(ev.start.getHours())}:${p2(ev.start.getMinutes())}`;
        const te=ev.end&&!ev.end._ad?`–${p2(ev.end.getHours())}:${p2(ev.end.getMinutes())}`:' ';
        html+=`<div class="compact-ev${isQuestion?' question-shift':''}${isDanger?' danger-shift':''}" style="background:${bg};color:${tx};border-left-color:${ac};--sk-bg-color:${bg};--sk-ink-color:${sketchInkFromHex(bg)};animation-delay:${idx++*40}ms;${sketchTextureStyle(ev,'compact')}">
          <span class="et">${ev.title||'(geen titel)'}</span>
          <span class="es">${ts} ${te}</span>
        </div>`;
      });
    }
    html+='</div>';
  });
  container.innerHTML=html;
  container.querySelectorAll('[data-toggle-day]').forEach(el=>{
    el.addEventListener('click',()=>{
      const d=new Date(el.dataset.toggleDay);
      vm='day'; anc=d;
      document.getElementById('bD').classList.add('on');
      document.getElementById('bW').classList.remove('on');
      render(0);
    });
  });
}

// ── DUTCH PUBLIC HOLIDAYS + AMSTERDAM SCHOOL HOLIDAYS ──
function easterSunday(y){
  // Anonymous Gregorian algorithm
  const a=y%19,b=Math.floor(y/100),c=y%100;
  const d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25);
  const g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7;
  const m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31)-1;
  const day=((h+l-7*m+114)%31)+1;
  return new Date(y,month,day);
}

function getDutchHolidays(y){
  const ea=easterSunday(y);
  const add=(d,n)=>{const c=new Date(d);c.setDate(c.getDate()+n);return c};
  const key=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const h={};
  const set=(d,name)=>{ h[key(d)]=name; };
  // Vaste feestdagen
  set(new Date(y,0,1),  'Nieuwjaarsdag');
  set(add(ea,-2),       'Goede Vrijdag');
  set(ea,               '1e Paasdag');
  set(add(ea,1),        '2e Paasdag');
  set(new Date(y,3,27), y>=2014?'Koningsdag':'Koninginnedag');
  // Als 27 april zondag is → 26 april
  if(new Date(y,3,27).getDay()===0) set(new Date(y,3,26),'Koningsdag');
  set(add(ea,39),       'Hemelvaartsdag');
  set(add(ea,49),       '1e Pinksterdag');
  set(add(ea,50),       '2e Pinksterdag');
  set(new Date(y,11,25),'1e Kerstdag');
  set(new Date(y,11,26),'2e Kerstdag');
  // Bevrijdingsdag (5 mei, alleen lustrumjaren vóór 1990, elk jaar na 1990 officieel vrij)
  set(new Date(y,4,5),  'Bevrijdingsdag');
  return h;
}

// Amsterdam school holidays (approximations based on standard Dutch school calendar)
// Returns object: key → vacation name
function getAmsterdamSchoolHolidays(y){
  const h={};
  const range=(from,to,name)=>{
    const d=new Date(from);
    while(d<=to){
      const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if(!h[k])h[k]=name;
      d.setDate(d.getDate()+1);
    }
  };
  // Approximate school holiday dates for Amsterdam (region Noord-Holland)
  // These are typical dates; exact dates vary per year from overheid.nl
  const holidays = [
    // Herfstvakantie (last week Oct)
    [new Date(y,9,21), new Date(y,9,27), 'Herfstvakantie'],
    // Kerstvakantie (~23 dec – 6 jan)
    [new Date(y,11,23), new Date(y,11,31), 'Kerstvakantie'],
    [new Date(y+1,0,1), new Date(y+1,0,5), 'Kerstvakantie'],
    // Voorjaarsvakantie (3rd week Feb)
    [new Date(y,1,17), new Date(y,1,23), 'Voorjaarsvakantie'],
    // Meivakantie (last week Apr + 1st week May)
    [new Date(y,3,28), new Date(y,4,9), 'Meivakantie'],
    // Zomervakantie (~mid Jul – end Aug)
    [new Date(y,6,14), new Date(y,7,24), 'Zomervakantie'],
  ];
  holidays.forEach(([s,e,n])=>range(s,e,n));
  return h;
}

const _publicHolCache={}, _schoolHolCache={};
function getHolidayLabel(date){
  const y=date.getFullYear();
  if(!_publicHolCache[y]) _publicHolCache[y]=getDutchHolidays(y);
  if(!_schoolHolCache[y]) _schoolHolCache[y]=getAmsterdamSchoolHolidays(y);
  const key=`${y}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  return {pub:_publicHolCache[y][key]||null, school:_schoolHolCache[y][key]||null};
}

// Compact time grid for weekend days: stacked, no time labels, max 2 crew cols, no overflow strip
// Main events are placed full-width; crew events use assignColumns independently so they
// never get pushed to overflow by background main events.
// CHH = HH/2 so that 2 stacked days ≈ same total height as the Do/Vr grid beside them.
function buildCompactTimeGrid(container, days, today, exp, sh, eh){
  const CHH=Math.round(HH/2);
  const mainHidden=document.body.classList.contains('main-layer-hidden');
  let animIdx=0;
  days.forEach((d,dayIdx)=>{
    const k=d.toDateString();
    const tc=same(d,today)?' tc':'';
    const {pub,school}=getHolidayLabel(d);
    const bdayNames=(CONFIG.crew||[]).filter(c=>{if(!c.bday)return false;const[dd,mm]=c.bday.split('-').map(Number);return d.getDate()===dd&&d.getMonth()+1===mm;}).map(c=>c.name);
    const holHtml=pub?`<span class="hday">🔴 ${pub}</span>`:''+(school&&!pub?`<span class="schday">📚 ${school}</span>`:'');
    const bdayHtml=bdayNames.length?`<span class="bdayday">🎂 ${bdayNames.join(', ')}</span>`:'';

    // Header
    const hdr=document.createElement('div');
    hdr.className=`ch${tc}`;
    hdr.dataset.toggleDay=d.toDateString();
    hdr.style.cssText=`border-right:none;border-bottom:2.5px solid #222;${dayIdx>0?'border-top:2.5px solid #222':''}`;
    hdr.innerHTML=`<div class="dayline"><span class="dn-short">${DS[d.getDay()]}</span><span class="dn-full">${DL[d.getDay()]}</span><span class="dd"> ${d.getDate()}</span><span class="dm" style="margin-left:2px">${MN[d.getMonth()]}</span></div>${holHtml}${bdayHtml}`;
    hdr.addEventListener('click',()=>{
      vm='day';anc=d;
      document.getElementById('bD').classList.add('on');
      document.getElementById('bW').classList.remove('on');
      render(0);
    });
    container.appendChild(hdr);

    // All-day strip
    const alldayEvs=[];
    if(pub) alldayEvs.push({title:pub,_cal:'holiday',start:Object.assign(new Date(d),{_ad:true})});
    exp.forEach(ev=>{
      if(!ev.start._ad)return;
      const ds=new Date(ev.start);ds.setHours(0,0,0,0);
      const de=ev.end?new Date(ev.end):new Date(ds.getTime()+86400000);de.setHours(0,0,0,0);
      for(let dd=new Date(ds);dd<de;dd.setDate(dd.getDate()+1)){if(dd.toDateString()===k)alldayEvs.push(ev);}
    });
    if(alldayEvs.length){
      const row=document.createElement('div');
      row.className='allday-row';row.style.borderRight='none';
      alldayEvs.forEach(ev=>{
        const cls=ev._cal==='holiday'?'is-holiday':ev._cal==='afspraken'?'is-afspraak':ev._cal==='main'?'is-main is-other':'is-other';
        const[bg,tx,ac]=ev._cal==='holiday'?['#fde8e8','#c0392b','#c0392b']:ev._cal==='afspraken'?['#e8f0fe','#1a56db','#1a56db']:PALETTES[nameHash(ev.title||'')];
        const bl=document.createElement('div');
        bl.className=`allday-block ${cls}`;bl.style.cssText=`background:${bg};color:${tx};border-left-color:${ac};--sk-bg-color:${bg};--sk-ink-color:${sketchInkFromHex(bg)};${sketchTextureStyle(ev,'split-allday')}`;bl.dataset.baseZ='';bl.textContent=ev.title||'?';
        bl.addEventListener('mousemove',e=>showTip(e,ev));bl.addEventListener('mouseleave',hideTip);
        bl.addEventListener('touchend',e=>activateEventBlock(e,bl,ev),{passive:false});
        bl.addEventListener('click',e=>activateEventBlock(e,bl,ev));
        row.appendChild(bl);
      });
      container.appendChild(row);
    }

    // Time grid area — compressed height (CHH = HH/2)
    const gridH=(eh-sh)*CHH;
    const gridArea=document.createElement('div');
    gridArea.dataset.compactGrid='1';
    gridArea.style.cssText=`position:relative;height:${gridH}px;overflow:visible;background:#fff;border-bottom:${dayIdx<days.length-1?'none':'2.5px solid #222'}`;
    for(let hr=sh;hr<eh;hr++){
      const sharp=[12,15,18].includes(hr);
      const line=document.createElement('div');
      line.style.cssText=`position:absolute;left:0;right:0;top:${(hr-sh)*CHH}px;border-top:${sharp?'1px dashed rgba(0,0,0,0.12)':'1px dotted rgba(0,0,0,0.06)'};pointer-events:none;z-index:1`;
      gridArea.appendChild(line);
    }

    // Collect timed events for this day
    const timedEvs=exp.filter(ev=>{
      if(ev.start._ad)return false;
      if(mainHidden&&ev._cal==='main')return false;
      const ds=new Date(ev.start);ds.setHours(0,0,0,0);
      return ds.toDateString()===k;
    });

    // Separate main (full-width background) from crew/afspraken (column-assigned)
    const mainEvs=timedEvs.filter(ev=>ev._cal==='main');
    const crewEvs=(()=>{
      const all=timedEvs.filter(ev=>ev._cal!=='main');
      if(!window._mergeShifts)return all;
      const merged=mergeCrewEvents(all.filter(ev=>ev._cal!=='afspraken'));
      return[...merged,...all.filter(ev=>ev._cal==='afspraken')];
    })();
    const hasAfspraakToday=crewEvs.some(ev=>ev._cal==='afspraken');
    const hasMainToday=!mainHidden&&mainEvs.length>0;
    const CLC=(hasMainToday||hasAfspraakToday)?25:0, CWC=100-CLC;

    // Place main events full-width at low z-index
    mainEvs.forEach(ev=>{
      const sh2=timeHour(ev.start);
      const eh2=eventEndHour(ev,eh);
      const top=(Math.max(sh2,sh)-sh)*CHH;
      const height=Math.max((Math.min(eh2,eh)-sh)*CHH-top,14);
      const dv=document.createElement('div');
      dv.className='ev main-event';
      dv.style.cssText=`top:${top}px;height:${height}px;left:0%;right:0%;z-index:2;background:linear-gradient(135deg,rgba(173,244,210,.45),rgba(63,190,116,.25));color:#0f3c20;border:2px solid rgba(26,61,43,.45)`;
      dv.dataset.mainLabel=ev.title||'';
      const ts=`${p2(ev.start.getHours())}:${p2(ev.start.getMinutes())}`;
      const te=ev.end&&!ev.end._ad?` – ${p2(ev.end.getHours())}:${p2(ev.end.getMinutes())}`:'';
      dv.innerHTML=`<div class="et">${ev.title||'(geen titel)'}</div><div class="es">${ts}${te}</div>`;
      dv.addEventListener('mousemove',e=>showTip(e,ev));dv.addEventListener('mouseleave',hideTip);
      gridArea.appendChild(dv);
    });

    // Place crew/afspraken events — afspraken always full-width, crew events get their own column slots
    const _afspraakEvs=crewEvs.filter(ev=>ev._cal==='afspraken');
    const _crewOnly=crewEvs.filter(ev=>ev._cal!=='afspraken');
    const assigned=[
      ..._afspraakEvs.map(ev=>({ev,col:0,total:1,overflow:false})),
      ...prioritizeMergedColumns(assignColumns(_crewOnly,3))
    ];
    assigned.forEach(({ev,col,total})=>{
      const sh2=timeHour(ev.start);
      const eh2=eventEndHour(ev,eh);
      const top=(Math.max(sh2,sh)-sh)*CHH;
      const minHeight=ev._cal==='afspraken'?22:14;
      const height=Math.max((Math.min(eh2,eh)-sh)*CHH-top,minHeight);

      let leftPct,rightPct;
      if(ev._cal==='afspraken'){leftPct=0;rightPct=0;}
      else if(ev._cal==='main'){leftPct=0;rightPct=0;}
      else{
        // Cascade layout: left edge only, shift always extends to right edge (right:0)
        // Step capped so leftmost shift is at CLC and rightmost never exceeds 50% (min 50% width)
        const step=total>1?(50-CLC)/(total-1):0;
        leftPct=CLC+col*step;rightPct=0;
      }

      const dv=document.createElement('div');
      const isDanger=(ev.title||'').includes('**');
      dv.className='ev'+(ev._cal==='afspraken'?' afspraak':'')+(isDanger?' danger-shift':'')+(ev._merged?' merged-shift':'');
      if(ev._merged){applyMergedColor(dv,ev._merged);}else{applyColor(dv,ev.title||'');applySketchTexture(dv,ev,'split');}
      if(ev._cal==='afspraken'){dv.style.background='#fde8e8';dv.style.color='#7b1111';}
      if(ev._cal==='afspraken'){
        dv.style.setProperty('--sk-bg-color','#fde8e8');
        dv.style.setProperty('--sk-ink-color',sketchInkFromHex('#fde8e8'));
      }
      dv.style.top=`${top}px`;dv.style.height=`${height}px`;dv.style.left=`${leftPct}%`;dv.style.right=`${rightPct}%`;
      const baseZ=ev._cal==='afspraken'?'3':String(5+col);
      dv.style.zIndex=baseZ;dv.dataset.baseZ=baseZ;
      if(ev._cal!=='afspraken'){
        dv.dataset.crewCol=String(col);
        dv.dataset.crewTotal=String(total);
        dv.dataset.hasMain=hasMainToday?'1':'0';
        dv.dataset.hasAfspraak=hasAfspraakToday?'1':'0';
      }
      dv.style.animationDelay=`${animIdx * 100}ms`;
      animIdx++;
      const ts=`${p2(ev.start.getHours())}:${p2(ev.start.getMinutes())}`;
      const te=ev.end&&!ev.end._ad?` – ${p2(ev.end.getHours())}:${p2(ev.end.getMinutes())}`:'';
      dv.innerHTML=`<div class="et">${ev.title||'(geen titel)'}</div><div class="es">${ts}${te}</div>`;
      dv.addEventListener('mousemove',e=>showTip(e,ev));dv.addEventListener('mouseleave',hideTip);
      dv.addEventListener('touchend',e=>activateEventBlock(e,dv,ev),{passive:false});
      dv.addEventListener('click',e=>activateEventBlock(e,dv,ev));
      gridArea.appendChild(dv);
    });

    container.appendChild(gridArea);
  });
}

// Row2: Do/Vr grid + compact Za/Zo side by side.
// Uses the same 52px repeat(3,1fr) CSS grid template as row1 (sgA) so that column
// boundaries land at identical pixels — prevents the double-line artifact.
function buildGridWithCompact(container, colDefs, weekendDays, today, exp, cm, ci, byDay, sh, eh){
  container.style.display='grid';
  container.style.gridTemplateColumns='52px repeat(3, minmax(0,1fr))';

  const sgB=document.createElement('div');
  const sgC=document.createElement('div');
  // sgB spans the first 3 tracks (52px + 1fr + 1fr), sgC gets the 4th track (1fr)
  // No border-right on sgB — Friday's .ce border-right provides the separator
  sgB.style.cssText='grid-column:1/4;min-width:0;overflow:hidden';
  sgC.style.cssText='grid-column:4;min-width:0;overflow:hidden;display:flex;flex-direction:column';
  container.appendChild(sgB);
  container.appendChild(sgC);

  buildGrid(sgB,colDefs,today,exp,cm,ci,byDay,sh,eh);
  // Last column (Vr) header had border-right removed by data-lastcol; restore it
  // since sgB no longer has its own border-right
  const lastColHdr=sgB.querySelector('.ch[data-lastcol]');
  if(lastColHdr)lastColHdr.removeAttribute('data-lastcol');

  buildCompactTimeGrid(sgC,weekendDays,today,exp,sh,eh);

  requestAnimationFrame(()=>{
    // Use align-self:start to measure each side's natural (unstretched) height
    sgB.style.alignSelf='start';
    sgC.style.alignSelf='start';

    const sgBH=sgB.getBoundingClientRect().height;

    // Sync compact header heights to match Do/Vr header
    const refHeader=sgB.querySelector('.ch[data-toggle-day]');
    if(refHeader){
      const chH=refHeader.getBoundingClientRect().height;
      sgC.querySelectorAll('.compact-card-hdr').forEach(el=>{
        el.style.height=chH+'px';
        el.style.boxSizing='border-box';
      });
    }

    // Balance compact gridArea heights so sgC natural height matches sgBH
    const gridAreas=Array.from(sgC.querySelectorAll('[data-compact-grid]'));
    if(gridAreas.length){
      const sgCH=sgC.getBoundingClientRect().height;
      const currentGridH=gridAreas.reduce((s,el)=>s+el.getBoundingClientRect().height,0);
      const overheadH=sgCH-currentGridH;
      const newGridH=Math.max(10,Math.floor((sgBH-overheadH)/gridAreas.length));
      gridAreas.forEach(el=>el.style.height=newGridH+'px');
    }

    // Restore — now both sides have the same natural height, no stretching needed
    sgB.style.alignSelf='';
    sgC.style.alignSelf='';
  });
}

// ── Merge shifts: combine crew events with identical start+end into one block ──
function mergeCrewEvents(evList){
  // Key by hour:minute only — robust against seconds/ms differences between ICS feeds
  const hm=d=>d.getHours()*60+d.getMinutes();
  const groups={},order=[];
  evList.forEach(ev=>{
    const k=hm(ev.start)+'|'+(ev.end?hm(ev.end):-1);
    if(!groups[k]){groups[k]=[];order.push(k);}
    groups[k].push(ev);
  });
  return order.map(k=>{
    const g=groups[k];
    if(g.length===1)return g[0];
    return{...g[0],title:g.map(e=>e.title||'?').join(' + '),_merged:g};
  });
}
function applyMergedColor(dv,events){
  const colors=events.map(ev=>{
    const n=String(ev.title||'').trim();
    const ci=(CONFIG.crew||[]).find(c=>c.name.toLowerCase()===n.toLowerCase());
    return ci?ci.color:PALETTES[nameHash(n)][0];
  });
  if(colors.length===1){
    dv.style.background=colors[0];dv.style.color=contrastTextColor(colors[0]);dv.style.borderLeftColor=colors[0];
  } else {
    const pct=100/colors.length;
    const stops=colors.flatMap((c,i)=>[`${c} ${Math.round(i*pct)}%`,`${c} ${Math.round((i+1)*pct)}%`]).join(',');
    dv.style.background=`linear-gradient(135deg,${stops})`;
    dv.style.borderLeftColor=colors[0];
    // Text sits top-left — contrast against the first (top-left) gradient color
    dv.style.color=contrastTextColor(colors[0]);
  }
}
// Swap merged shifts to the lowest column positions within their overlap groups
// so they start earliest (leftmost) and are widest with the cascade layout.
function prioritizeMergedColumns(asgn){
  const items=asgn.filter(a=>!a.overflow);
  if(!items.some(a=>a.ev._merged))return asgn;
  const p=items.map((_,i)=>i);
  const find=x=>p[x]===x?x:(p[x]=find(p[x]));
  const unite=(x,y)=>{p[find(x)]=find(y);};
  for(let i=0;i<items.length;i++){
    const si=items[i].ev.start.getTime(),ei=items[i].ev.end?items[i].ev.end.getTime():si+3600000;
    for(let j=i+1;j<items.length;j++){
      const sj=items[j].ev.start.getTime(),ej=items[j].ev.end?items[j].ev.end.getTime():sj+3600000;
      if(si<ej&&ei>sj)unite(i,j);
    }
  }
  const comps=new Map();
  items.forEach((a,i)=>{const r=find(i);if(!comps.has(r))comps.set(r,[]);comps.get(r).push(a);});
  comps.forEach(comp=>{
    if(!comp.some(a=>a.ev._merged))return;
    const sorted=comp.slice().sort((a,b)=>a.col-b.col);
    const cols=sorted.map(a=>a.col);
    let ci=0;
    sorted.filter(a=>a.ev._merged).forEach(a=>{a.col=cols[ci++];});
    sorted.filter(a=>!a.ev._merged).forEach(a=>{a.col=cols[ci++];});
  });
  return asgn;
}

function buildGrid(container, colDefs, today, exp, _cm, _ci, _byDay, sh, eh){
  container.style.display='grid';
  container.style.gridTemplateColumns=`52px repeat(${colDefs.length},minmax(0,1fr))`;
  container.style.alignContent='start';

  // Header row + all-day rows
  let h=`<div class="ch th"></div>`;
  colDefs.forEach(cd=>{
    const d=cd.days[0];
    const t=same(d,today);
    const {pub,school}=getHolidayLabel(d);
    const bdayNames=(CONFIG.crew||[]).filter(c=>{if(!c.bday)return false;const[dd,mm]=c.bday.split('-').map(Number);return d.getDate()===dd&&d.getMonth()+1===mm;}).map(c=>c.name);
    const bdayHtml=bdayNames.length?`<span class="bdayday">🎂 ${bdayNames.join(', ')}</span>`:'';
    const holHtml=pub?`<span class="hday">🔴 ${pub}</span>`:''
      +(school&&!pub?`<span class="schday">📚 ${school}</span>`:'');
    const isLastCol=(colDefs.indexOf(cd)===colDefs.length-1);
    h+=`<div class="ch${t?' tc':''}" data-toggle-day="${d.toDateString()}"${isLastCol?' data-lastcol':''}>
      <div class="dayline"><span class="dn-short">${DS[d.getDay()]}</span><span class="dn-full">${DL[d.getDay()]}</span><span class="dd"> ${d.getDate()}</span><span class="dm" style="margin-left:2px">${MN[d.getMonth()]}</span></div>
      ${holHtml}${bdayHtml}
    </div>`;
  });

  // All-day events row (1 row spanning all cols after time cell)
  // Collect all-day events per day
  const alldayByDay={};
  colDefs.forEach(cd=>{ alldayByDay[cd.days[0].toDateString()]=[] });
  exp.forEach(ev=>{
    if(!ev.start._ad)return;
    // Multi-day all-day event: add to every day in the range.
    // iCal DTEND for all-day events is exclusive (e.g. an event "on the 14th" has DTEND=15th).
    const ds=new Date(ev.start);ds.setHours(0,0,0,0);
    const de=ev.end?new Date(ev.end):new Date(ds.getTime()+86400000);
    de.setHours(0,0,0,0);
    for(let d=new Date(ds);d<de;d.setDate(d.getDate()+1)){
      const k=d.toDateString();
      if(alldayByDay[k]!==undefined) alldayByDay[k].push(ev);
    }
  });
  // Also add Dutch public holidays as all-day pills
  colDefs.forEach(cd=>{
    const d=cd.days[0];
    const {pub}=getHolidayLabel(d);
    if(pub) alldayByDay[d.toDateString()].unshift({title:pub,_cal:'holiday',start:Object.assign(new Date(d),{_ad:true})});
  });
  const hasAllday=Object.values(alldayByDay).some(a=>a.length>0);
  const _adTipEvs=[];
  if(hasAllday){
    h+=`<div class="tl" style="height:auto;min-height:4px;padding:0"></div>`;
    colDefs.forEach((cd,i)=>{
      const k=cd.days[0].toDateString();
      const evs=alldayByDay[k]||[];
      const isLast=(i===colDefs.length-1);
      h+=`<div class="allday-row" style="border-right:${isLast?'none':'2.5px solid #222'}">`;
      evs.forEach(ev=>{
        const cls=ev._cal==='holiday'?'is-holiday':ev._cal==='afspraken'?'is-afspraak':ev._cal==='main'?'is-main is-other':'is-other';
        const [bg,tx,ac]=ev._cal==='holiday'?['#fde8e8','#c0392b','#c0392b']:
                          ev._cal==='afspraken'?['#e8f0fe','#1a56db','#1a56db']:
                          PALETTES[nameHash(ev.title||'')];
        // Show time for timed afspraken events; skip if all-day or midnight-to-midnight
        let timeStr='';
        if(!ev.start._ad){
          const startH=ev.start.getHours(), startM=ev.start.getMinutes();
          const endH=ev.end?ev.end.getHours():0, endM=ev.end?ev.end.getMinutes():0;
          const isZero=(startH===0&&startM===0&&endH===0&&endM===0);
          if(!isZero){
            const tS=`${p2(startH)}:${p2(startM)}`;
            const tE=ev.end?`–${p2(endH)}:${p2(endM)}`:'';
            timeStr=` <span style="opacity:.75;font-weight:400">${tS}${tE}</span>`;
          }
        }
        const tipIdx=_adTipEvs.length;
        _adTipEvs.push(ev);
        h+=`<div class="allday-block ${cls}" style="background:${bg};color:${tx};border-left-color:${ac};--sk-bg-color:${bg};--sk-ink-color:${sketchInkFromHex(bg)};${sketchTextureStyle(ev,'allday')}" data-adtip="${tipIdx}">${ev.title||'?'}${timeStr}</div>`;
      });
      h+='</div>';
    });
  }

  // Hour rows — mark 12, 15, 18 with sharp black lines
  const SHARP_HRS=[12,15,18];
  for(let hr=sh;hr<eh;hr++){
    const sharp=SHARP_HRS.includes(hr);
    const isLast=(hr===eh-1);
    h+=`<div class="tl${sharp?' sharp':''}">${p2(hr)}:00</div>`;
    colDefs.forEach(cd=>{
      h+=`<div class="ce${sharp?' sharp':''}${isLast?' ce-last-row':''}${colDefs.indexOf(cd)===colDefs.length-1?' data-lastcol':''}" data-col="${cd.days[0].toDateString()}" data-h="${hr}"></div>`;
    });
  }
  container.innerHTML=h;

  // Tooltip listeners for all-day / afspraken blocks
  container.querySelectorAll('[data-adtip]').forEach(el=>{
    const ev=_adTipEvs[+el.dataset.adtip];
    if(!ev)return;
    el.addEventListener('mousemove',e=>showTip(e,ev));
    el.addEventListener('mouseleave',hideTip);
    el.dataset.baseZ='';
    el.addEventListener('touchend',e=>activateEventBlock(e,el,ev),{passive:false});
    el.addEventListener('click',e=>activateEventBlock(e,el,ev));
  });

  // Click on day header → toggle day/week view
  container.querySelectorAll('[data-toggle-day]').forEach(el=>{
    el.addEventListener('click',()=>{
      const d=new Date(el.dataset.toggleDay);
      if(vm==='week'){
        vm='day'; anc=d;
        document.getElementById('bD').classList.add('on');
        document.getElementById('bW').classList.remove('on');
      } else {
        vm='week'; anc=sowk(d);
        document.getElementById('bW').classList.add('on');
        document.getElementById('bD').classList.remove('on');
      }
      render(0);
    });
  });

  // Collect timed events per day column (skip all-day; afspraken now shown in time grid on top)
  const mainHidden = document.body.classList.contains('main-layer-hidden');
  const colEvents={};
  colDefs.forEach(cd=>{ colEvents[cd.days[0].toDateString()]=[] });
  exp.forEach(ev=>{
    if(ev.start._ad)return;
    if(mainHidden && ev._cal==='main')return; // exclude from overlap calc when layer hidden
    const ds=new Date(ev.start);ds.setHours(0,0,0,0);
    const k=ds.toDateString();
    if(colEvents[k]!==undefined) colEvents[k].push(ev);
    // Cross-midnight: also render a continuation block on subsequent days, clamped to 00:00
    if(ev.end && !ev.end._ad){
      const evEndDay=new Date(ev.end);evEndDay.setHours(0,0,0,0);
      for(let d=new Date(ds.getTime()+86400000);d<=evEndDay;d.setDate(d.getDate()+1)){
        // Skip if event ends exactly at midnight of this day (zero-length block)
        if(d.getTime()===evEndDay.getTime()&&ev.end.getHours()===0&&ev.end.getMinutes()===0) break;
        const dk=d.toDateString();
        if(colEvents[dk]!==undefined) colEvents[dk].push({...ev,start:new Date(d),_continuation:true});
      }
    }
  });

  // Day view (single column) can fit more crew columns; week view caps at 3
  const maxCols = window._printMaxCols || (vm==='day' ? (window._dayMaxCols||20) : 3);

  let animIdx=0;
  // Collect overflow events per day column for the overflow strip
  const overflowByCol={};
  colDefs.forEach(cd=>{ overflowByCol[cd.days[0].toDateString()]=[] });

  Object.entries(colEvents).forEach(([colKey,evList])=>{
    const mainEvs=evList.filter(ev=>ev._cal==='main');
    const crewEvs=(()=>{
      const all=evList.filter(ev=>ev._cal!=='main');
      if(!window._mergeShifts)return all;
      const merged=mergeCrewEvents(all.filter(ev=>ev._cal!=='afspraken'));
      return[...merged,...all.filter(ev=>ev._cal==='afspraken')];
    })();
    const hasAfspraakToday=evList.some(ev=>ev._cal==='afspraken');
    const hasMainToday=!mainHidden&&mainEvs.length>0;
    // Main events render full-width at z-index:2; afspraken always full-width; crew events get maxCols slots
    const _afspraakEvs=crewEvs.filter(ev=>ev._cal==='afspraken');
    const _crewOnly=crewEvs.filter(ev=>ev._cal!=='afspraken');
    const crewAssigned=[
      ..._afspraakEvs.map(ev=>({ev,col:0,total:1,overflow:false})),
      ...prioritizeMergedColumns(assignColumns(_crewOnly,maxCols))
    ];
    const assigned=[...mainEvs.map(ev=>({ev,col:0,total:1,overflow:false})),...crewAssigned];
    assigned.forEach(({ev,col,total,overflow})=>{
      if(overflow){
        // Don't place in grid — collect for overflow strip
        overflowByCol[colKey]&&overflowByCol[colKey].push(ev);
        return;
      }
      const sh2=timeHour(ev.start);
      const eh2=eventEndHour(ev,eh);
      const bH=Math.max(sh2,sh),cH=Math.floor(bH);
      const top=(bH-sh)*HH,bot=(Math.min(eh2,eh)-sh)*HH;
      const minHeight=ev._cal==='afspraken'?24:14;
      const height=Math.max(bot-top,minHeight);
      const cell=container.querySelector(`[data-col="${colKey}"][data-h="${cH}"]`);if(!cell)return;
      const dv=document.createElement('div');
      const isDanger=(ev.title||'').includes('**');
      dv.className='ev'+(ev._cal==='afspraken'?' afspraak':'')+(ev._cal==='main'?' main-event':'')+(isDanger?' danger-shift':'')+(ev._merged?' merged-shift':'');
      if(ev._merged){applyMergedColor(dv,ev._merged);}else{applyColor(dv,ev.title||'');applySketchTexture(dv,ev,'grid');}
      if(ev._cal==='main'){
        dv.style.background='linear-gradient(135deg, rgba(173,244,210,.45), rgba(63,190,116,.25))';
        dv.style.color='#0f3c20';
        dv.style.border='2px solid rgba(26,61,43,.45)';
        dv.style.setProperty('--sk-bg-color','#adf4d2');
        dv.style.setProperty('--sk-ink-color',sketchInkFromHex('#adf4d2'));
      }
      if(ev._cal==='afspraken'){
        dv.style.background='#fde8e8';dv.style.color='#7b1111';
        dv.style.setProperty('--sk-bg-color','#fde8e8');
        dv.style.setProperty('--sk-ink-color',sketchInkFromHex('#fde8e8'));
      }
      dv.style.top=`${top-(cH-sh)*HH}px`;dv.style.height=`${height}px`;
      // Width calculation
      let leftPct,rightPct;
      if(ev._cal==='afspraken'){
        leftPct=0; rightPct=0;
      } else if(ev._cal==='main'){
        leftPct=0; rightPct=0;
      } else {
        // Cascade layout: left edge only, shift always extends to right edge (right:0)
        // Step capped so no shift starts beyond 50% → min 50% width guaranteed
        const CL=(hasMainToday||hasAfspraakToday)?25:0;
        const step=total>1?(50-CL)/(total-1):0;
        leftPct=CL+col*step; rightPct=0;
        dv.dataset.crewCol=String(col);
        dv.dataset.crewTotal=String(total);
        dv.dataset.hasMain=hasMainToday?'1':'0';
        dv.dataset.hasAfspraak=hasAfspraakToday?'1':'0';
      }

      dv.style.left=`${leftPct}%`;dv.style.right=`${rightPct}%`;
      // Main events at bottom, appointments above them, shifts above appointments.
      const baseZ=ev._cal==='afspraken'?'3':ev._cal==='main'?'2':String(5+col);
      dv.style.zIndex=baseZ;
      dv.dataset.baseZ=baseZ;
      const _ai=animIdx++;
      dv.style.animationDelay=`${_ai * 100}ms`;
      const isAD=ev.start._ad;
      const ts=isAD?'':`${p2(ev.start.getHours())}:${p2(ev.start.getMinutes())}`;
      const te=(!isAD&&ev.end&&!ev.end._ad)?` – ${p2(ev.end.getHours())}:${p2(ev.end.getMinutes())}`:' ';
      if(ev._cal==='main'){
        dv.dataset.mainLabel = ev.title||'Main event';
      }
      dv.innerHTML=`<div class="et">${ev.title||'(geen titel)'}</div>${ts?`<div class="es">${ts}${te}</div>`:''}`;
      if(ev._cal==='custom' && ev.localId){
        const del=document.createElement('button');
        del.className='shift-delete';
        del.title='Verwijder dienst';
        del.textContent='×';
        del.addEventListener('click',e=>{e.stopPropagation(); deleteLocalShift(ev.localId);});
        dv.appendChild(del);
      }
      dv.addEventListener('mousemove',e=>showTip(e,ev));
      dv.addEventListener('mouseleave',hideTip);
      dv.addEventListener('touchend',e=>activateEventBlock(e,dv,ev),{passive:false});
      dv.addEventListener('click',e=>activateEventBlock(e,dv,ev));
      cell.appendChild(dv);
    });
  });

  // Render overflow strip: one row per day column that has overflow, spanning full grid width
  const hasOverflow=Object.values(overflowByCol).some(a=>a.length>0);
  if(hasOverflow){
    // Add overflow strip row: time-col placeholder + one cell per day col
    // Insert as a new row in the grid by appending cells
    const stripTimePlaceholder=document.createElement('div');
    stripTimePlaceholder.className='tl';
    stripTimePlaceholder.style.cssText='height:auto;min-height:4px;padding:0;border-bottom:none';
    stripTimePlaceholder.innerHTML='<span style="font-size:.55rem;color:var(--mu);writing-mode:vertical-rl;transform:rotate(180deg);padding:2px 0">extra</span>';
    container.appendChild(stripTimePlaceholder);

    colDefs.forEach((cd,i)=>{
      const k=cd.days[0].toDateString();
      const ovEvs=(overflowByCol[k]||[]).sort((a,b)=>a.start-b.start);
      const isLastCol=(i===colDefs.length-1);
      const cell=document.createElement('div');
      cell.className='overflow-strip';
      cell.style.cssText=`border-right:${isLastCol?'none':'2.5px solid #222'};border-bottom:2px solid #b0b8a8`;
      if(ovEvs.length>0){
        ovEvs.forEach((ev,idx)=>{
          const[bg,tx,ac]=PALETTES[nameHash(ev.title||'')];
          const ts=ev.start._ad?'':`${p2(ev.start.getHours())}:${p2(ev.start.getMinutes())}`;
          const te=(!ev.start._ad&&ev.end&&!ev.end._ad)?` – ${p2(ev.end.getHours())}:${p2(ev.end.getMinutes())}`:'';
          const row=document.createElement('div');
          row.className='overflow-ev';
          row.style.cssText=`background:${bg};color:${tx};border-left-color:${ac};--sk-bg-color:${bg};--sk-ink-color:${sketchInkFromHex(bg)};animation-delay:${idx*40}ms`;
          applySketchTexture(row,ev,'overflow');
          row.innerHTML=`<span class="oe-name">${ev.title||'?'}</span><span class="oe-time">${ts?` ${ts}${te}`:''}</span>`;
          row.addEventListener('mousemove',e=>showTip(e,ev));
          row.addEventListener('mouseleave',hideTip);
          row.addEventListener('touchend',e=>{e.preventDefault();const t=e.changedTouches[0];showTip({clientX:t.clientX,clientY:t.clientY},ev);},{passive:false});
          cell.appendChild(row);
        });
      }
      container.appendChild(cell);
    });
  }
}

// ── PHONE WEEK STRIP ────────────────────────────────────
function updateWeekStrip(){
  const strip=document.getElementById('weekStrip');
  if(!strip||!isPhone()){if(strip)strip.innerHTML='';return;}
  const today=new Date();today.setHours(0,0,0,0);
  const weekStart=sowk(anc);
  let h='';
  for(let i=0;i<7;i++){
    const d=addD(weekStart,i);
    const isToday=same(d,today);
    const hasEv=allEv.some(ev=>{const ds=new Date(ev.start);ds.setHours(0,0,0,0);return same(ds,d);});
    h+=`<div class="ws-day${isToday?' ws-today':''}" data-ws="${d.toDateString()}">
      <span class="ws-dn">${DS[d.getDay()]}</span>
      <span class="ws-num">${d.getDate()}</span>
      <span class="ws-dot${hasEv?' has-ev':''}"></span>
    </div>`;
  }
  strip.innerHTML=h;
  strip.querySelectorAll('[data-ws]').forEach(el=>{
    el.addEventListener('click',()=>{
      const d=new Date(el.dataset.ws);
      if(!same(sowk(d),sowk(anc))){
        anc=d;vm='week';
        document.getElementById('bW').classList.add('on');
        document.getElementById('bD').classList.remove('on');
        render(0);
      } else {
        const label=document.querySelector(`[data-toggle-day="${d.toDateString()}"]`);
        if(label) scrollElementToTop(label);
      }
    });
  });
}
let _lastSmall=isSmall(), _lastPhone=isPhone(), _lastLandscape=isPhoneLandscape();
function handleResize(){
  const s=isSmall(), p=isPhone(), l=isPhoneLandscape();
  if(s!==_lastSmall||p!==_lastPhone||l!==_lastLandscape){
    _lastSmall=s; _lastPhone=p; _lastLandscape=l;
    if(allEv.length) render(0);
  }
}
window.addEventListener('resize', handleResize);
// Orientation change: small delay to let browser finish rotating
window.addEventListener('orientationchange', ()=>setTimeout(()=>{_lastLandscape=null;handleResize();}, 150));

const tipEl=document.getElementById('tip');
function showTip(e,ev){
  const ts=ev.start._ad?'Hele dag':`${p2(ev.start.getHours())}:${p2(ev.start.getMinutes())}`;
  const te=ev.end&&!ev.end._ad?` – ${p2(ev.end.getHours())}:${p2(ev.end.getMinutes())}`:' ';
  let body;
  if(ev._merged){
    body=`<strong>${ev._merged.length}× samengevouwen</strong><br>🕐 ${ts}${te}<br>`
        +ev._merged.map(m=>`<span style="display:block;margin-top:2px">• ${m.title||'?'}</span>`).join('');
  } else {
    body=`<strong>${ev.title||'(geen titel)'}</strong><br>🕐 ${ts}${te}${ev.location?'<br>📍 '+ev.location:''}${ev.desc?'<br><em style="font-size:.68rem;opacity:.85">'+ev.desc.slice(0,100)+'</em>':''}`;
  }
  tipEl.innerHTML=body;
  tipEl.classList.add('on');moveTip(e);
}
function moveTip(e){
  const tw=tipEl.offsetWidth||280, th=tipEl.offsetHeight||80, mg=12;
  const left=e.clientX+13+tw+mg>window.innerWidth ? e.clientX-tw-13 : e.clientX+13;
  const top=e.clientY+13+th+mg>window.innerHeight ? e.clientY-th-13 : e.clientY+13;
  tipEl.style.left=Math.max(mg,left)+'px';
  tipEl.style.top=Math.max(mg,top)+'px';
}
function hideTip(){tipEl.classList.remove('on')}
document.addEventListener('mousemove',e=>{if(tipEl.classList.contains('on'))moveTip(e)});
document.addEventListener('touchstart',e=>{if(!e.target.closest('.ev,.allday-block,.overflow-ev'))hideTip();},{passive:true});
document.addEventListener('click',e=>{
  if(!e.target.closest('.ev,.allday-block')){
    clearTopBlocks();
  }
});

function setViewMode(mode){
  vm=mode;
  if(vm==='week') anc=sowk(anc);
  document.getElementById('bW')?.classList.toggle('on', vm==='week');
  document.getElementById('bD')?.classList.toggle('on', vm==='day');
}
function shiftAnchor(delta){
  if(vm==='week') anc=addD(anc,delta*7);
  else if(vm==='day') anc=addD(anc,delta);
  else if(hoursFocusPeriod==='week') anc=addD(sowk(anc),delta*7);
  else if(hoursFocusPeriod==='year') anc=new Date(anc.getFullYear()+delta,0,1);
  else anc=new Date(anc.getFullYear(),anc.getMonth()+delta,1);
}

document.getElementById('pB').onclick=()=>{shiftAnchor(-1);render(-1)};
document.getElementById('nB').onclick=()=>{shiftAnchor(1);render(1)};
document.getElementById('tB').onclick=()=>{const t=new Date();anc=(vm==='week'&&!isPhone())?sowk(t):t;render(0);setTimeout(scrollToToday,350)};
document.getElementById('bW').onclick=()=>{setViewMode('week');render(0)};
document.getElementById('bD').onclick=()=>{setViewMode('day');render(0)};

// trackpad / touch swipe navigation
(() => {
  const area = document.getElementById('calOuter');
  if(!area) return;

  // Touch swipe is handled by the document-level handler below (with slide animation).
  // Only intercept horizontal wheel/trackpad here to prevent accidental page scroll.
  area.addEventListener('wheel', e=>{
    if(Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 40){
      e.preventDefault();
      e.stopPropagation();
      if(e.deltaX > 0) document.getElementById('nB').click();
      else document.getElementById('pB').click();
    }
  }, {passive:false});

  window.addEventListener('wheel', e=>{
    if(Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 40){
      e.preventDefault();
      e.stopPropagation();
    }
  }, {passive:false});
})();

// Toggle main layer visibility
function _animateCrewPositions(toHidden){
  const CL=toHidden?0:25,CW=100-CL;
  document.querySelectorAll('.ev:not(.main-event):not(.afspraak)').forEach(el=>{
    if(el.dataset.crewCol===undefined||el.dataset.hasMain!=='1')return;
    if(toHidden){
      // Stored attribute check
      if(el.dataset.hasAfspraak==='1')return;
      // Fallback: live DOM check — compact grid siblings, or week grid cells by date
      const gridArea=el.closest('[data-compact-grid]');
      if(gridArea&&gridArea.querySelector('.ev.afspraak'))return;
      const cell=el.closest('[data-col]');
      if(cell&&document.querySelector(`[data-col="${cell.dataset.col}"] .ev.afspraak`))return;
    }
    const cc=parseInt(el.dataset.crewCol,10),ct=parseInt(el.dataset.crewTotal,10);
    const step=ct>1?(50-CL)/(ct-1):0;
    el.style.left=`${CL+cc*step}%`;
    el.style.right='0%';
  });
}
// Merge shifts toggle
(function(){
  window._mergeShifts=localStorage.getItem('mergeShifts')==='1';
  const chk=document.getElementById('mergeShiftsToggle');
  if(chk)chk.checked=window._mergeShifts;
  document.getElementById('mergeShiftsToggle')?.addEventListener('change',e=>{
    window._mergeShifts=e.target.checked;
    localStorage.setItem('mergeShifts',window._mergeShifts?'1':'0');
    render(0);
  });
})();

document.getElementById('mainLayerToggle')?.addEventListener('change',(e)=>{
  const nowHidden=!e.target.checked;
  if(nowHidden){
    // Hiding: animate shifts first, then hide main events after animation
    _animateCrewPositions(true);
    setTimeout(()=>document.body.classList.add('main-layer-hidden'),260);
  } else {
    // Showing: reveal main events first, then animate shifts into position
    document.body.classList.remove('main-layer-hidden');
    setTimeout(()=>_animateCrewPositions(false),150);
  }
});

// Initialize login & editing controls
initEditFeatures();

// ── DATEPICKER ───────────────────────────────────────────
(()=>{
  // Read week start from config (0=Sun, 1=Mon)
  const _wsd=((window.OVERLAP_CONFIG||window.ROOSTER_CONFIG||{}).defaults||{}).weekStartDay??1;
  // Locale-aware short weekday names ordered by week start day
  const _dpDow=Array.from({length:7},(_,i)=>new Intl.DateTimeFormat(_locale,{weekday:'short'}).format(new Date(2023,0,(_wsd===0?1:2)+i)));
  const _dpMonFmt=new Intl.DateTimeFormat(_locale,{month:'long',year:'numeric'});
  const dp=document.getElementById('datePicker');
  let dpDate=new Date();

  function renderPicker(){
    const today=new Date();today.setHours(0,0,0,0);
    const y=dpDate.getFullYear(),m=dpDate.getMonth();
    document.getElementById('dpMonthLabel').textContent=_dpMonFmt.format(new Date(y,m,1));

    const first=new Date(y,m,1);
    // Offset of first day from week start (0 = no padding needed)
    const startDow=_wsd===0?first.getDay():(first.getDay()===0?6:first.getDay()-1);
    const daysInMonth=new Date(y,m+1,0).getDate();
    const daysInPrev=new Date(y,m,0).getDate();

    // Build flat cell array: prev-month padding + current month + next-month padding
    const cells=[];
    for(let i=startDow-1;i>=0;i--) cells.push({day:daysInPrev-i,other:true,date:new Date(y,m-1,daysInPrev-i)});
    for(let d=1;d<=daysInMonth;d++) cells.push({day:d,other:false,date:new Date(y,m,d)});
    const rem=cells.length%7===0?0:7-cells.length%7;
    for(let d=1;d<=rem;d++) cells.push({day:d,other:true,date:new Date(y,m+1,d)});

    // Header row: week-number label + day name columns
    let g=`<div class="dp-wk-hdr">Wk</div>`+_dpDow.map(d=>`<div class="dp-dow">${d}</div>`).join('');

    for(let i=0;i<cells.length;i++){
      const rowIdx=Math.floor(i/7);
      if(i%7===0){
        // ISO weeks start Monday; for Sunday-start advance Sunday→Monday before computing
        let wd=cells[i].date;
        const _d=cells[i].date;
        const wkStartIso=`${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;
        if(_wsd===0&&wd.getDay()===0){wd=new Date(wd);wd.setDate(wd.getDate()+1);}
        g+=`<div class="dp-wk-num" data-wkstart="${wkStartIso}" data-row="${rowIdx}">${getWeekNumber(wd)}</div>`;
      }
      const c=cells[i];
      if(c.other){
        g+=`<div class="dp-day dp-other" data-row="${rowIdx}">${c.day}</div>`;
      } else {
        const dd=new Date(y,m,c.day);dd.setHours(0,0,0,0);
        const isToday=dd.getTime()===today.getTime();
        let isSel;
        if(vm==='week') isSel=dd>=sowk(anc)&&dd<=addD(sowk(anc),6);
        else if(vm==='hours'&&hoursFocusPeriod==='week') isSel=dd>=sowk(anc)&&dd<=addD(sowk(anc),6);
        else if(vm==='hours'&&hoursFocusPeriod==='month') isSel=dd.getFullYear()===anc.getFullYear()&&dd.getMonth()===anc.getMonth();
        else if(vm==='hours'&&hoursFocusPeriod==='year') isSel=dd.getFullYear()===anc.getFullYear();
        else isSel=same(dd,anc);
        const cls='dp-day'+(isToday?' dp-today':'')+(isSel&&!isToday?' dp-sel':'');
        g+=`<div class="${cls}" data-y="${y}" data-m="${m}" data-d="${c.day}" data-row="${rowIdx}">${c.day}</div>`;
      }
    }
    const dpGrid=document.getElementById('dpGrid');
    dpGrid.innerHTML=g;

    dpGrid.onclick=e=>{
      // Week number click → jump to that week in week-view
      const wkEl=e.target.closest('.dp-wk-num[data-wkstart]');
      if(wkEl){
        anc=sowk(new Date(wkEl.dataset.wkstart+'T00:00:00'));
        if(vm==='hours') hoursFocusPeriod='week';
        else setViewMode('week');
        render(0);
        hidePicker();
        return;
      }
      // Day click → go directly to that date in day-view
      const el=e.target.closest('.dp-day');
      if(!el||el.classList.contains('dp-other'))return;
      const chosen=new Date(+el.dataset.y,+el.dataset.m,+el.dataset.d);
      anc=chosen;
      if(vm!=='hours') setViewMode('day');
      render(0);
      setTimeout(scrollToToday,350);
      hidePicker();
    };

    // Week-row hover: highlight all 7 day cells in the hovered row
    dpGrid.onmouseover=e=>{
      const wk=e.target.closest('.dp-wk-num');
      if(!wk)return;
      dpGrid.querySelectorAll(`[data-row="${wk.dataset.row}"]`).forEach(el=>el.classList.add('dp-row-hover'));
    };
    dpGrid.onmouseout=e=>{
      const wk=e.target.closest('.dp-wk-num');
      if(!wk)return;
      dpGrid.querySelectorAll('.dp-row-hover').forEach(el=>el.classList.remove('dp-row-hover'));
    };
  }

  function syncPickerPosition(){
    const h=document.querySelector('header')?.getBoundingClientRect().height||52;
    document.documentElement.style.setProperty('--header-h',`${Math.ceil(h)}px`);
  }
  function applyHoursPickerMonth(){
    if(vm!=='hours')return false;
    if(hoursFocusPeriod==='year') anc=new Date(dpDate.getFullYear(),0,1);
    else if(hoursFocusPeriod==='week') anc=sowk(new Date(dpDate.getFullYear(),dpDate.getMonth(),1));
    else anc=new Date(dpDate.getFullYear(),dpDate.getMonth(),1);
    render(0);
    return true;
  }
  function syncHoursPickerPadding(){
    if(vm==='hours'&&dp.classList.contains('dp-open')){
      document.documentElement.style.setProperty('--datepicker-h',`${Math.ceil(dp.getBoundingClientRect().height)}px`);
      document.body.classList.add('hours-picker-open');
    } else {
      document.documentElement.style.setProperty('--datepicker-h','0px');
      document.body.classList.remove('hours-picker-open');
    }
  }
  function showPicker(){
    dpDate=new Date(anc);
    syncPickerPosition();
    renderPicker();
    dp.classList.add('dp-open');
    syncHoursPickerPadding();
  }
  function hidePicker(){ dp.classList.remove('dp-open'); syncHoursPickerPadding(); }

  // Debounced toggle — prevents ghost-click double-fire on touch devices
  let _dpLastToggle=0;
  const _dpToggle=e=>{
    e.stopPropagation();
    const now=Date.now();
    if(now-_dpLastToggle<400)return;
    _dpLastToggle=now;
    dp.classList.contains('dp-open')?hidePicker():showPicker();
  };
  document.getElementById('tBDrop').addEventListener('click',_dpToggle);
  const _hdrBtn=document.getElementById('hdrDateBtn');
  if(_hdrBtn)_hdrBtn.addEventListener('click',_dpToggle);

  document.getElementById('dpPrev').onclick=e=>{
    e.stopPropagation();
    dpDate=new Date(dpDate.getFullYear(),dpDate.getMonth()-1,1);
    applyHoursPickerMonth();
    renderPicker();
    syncHoursPickerPadding();
  };
  document.getElementById('dpNext').onclick=e=>{
    e.stopPropagation();
    dpDate=new Date(dpDate.getFullYear(),dpDate.getMonth()+1,1);
    applyHoursPickerMonth();
    renderPicker();
    syncHoursPickerPadding();
  };
  // Close when clicking outside the picker (stopPropagation above means
  // tBDrop and hdrDateBtn clicks never reach this handler)
  document.addEventListener('click',e=>{
    if(!dp.contains(e.target))hidePicker();
  });

  // Swipe left/right to go to next/prev month
  let _dpTx=null;
  dp.addEventListener('touchstart',e=>{_dpTx=e.touches[0].clientX;},{passive:true});
  dp.addEventListener('touchend',e=>{
    if(_dpTx===null)return;
    const dx=e.changedTouches[0].clientX-_dpTx;
    _dpTx=null;
    if(Math.abs(dx)<40)return;
    dpDate=dx<0
      ?new Date(dpDate.getFullYear(),dpDate.getMonth()+1,1)
      :new Date(dpDate.getFullYear(),dpDate.getMonth()-1,1);
    applyHoursPickerMonth();
    renderPicker();
    syncHoursPickerPadding();
  });
  window.addEventListener('resize',()=>{if(dp.classList.contains('dp-open')){syncPickerPosition();syncHoursPickerPadding();}});
})();

// ── KEYBOARD NAVIGATION ─────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft')  { shiftAnchor(-1); render(-1); e.preventDefault(); }
  if (e.key === 'ArrowRight') { shiftAnchor(1); render( 1); e.preventDefault(); }
  if (e.key === 'ArrowUp')    { setViewMode('week');render(0);e.preventDefault(); }
  if (e.key === 'ArrowDown')  { setViewMode('day');render(0);e.preventDefault(); }
});

// ── SWIPE NAVIGATION (with slide animation) ──────────────
(()=>{
  let tx=0,ty=0,dragging=false,sliding=false;
  document.addEventListener('touchstart',e=>{
    if(e.touches.length!==1)return;
    tx=e.touches[0].clientX; ty=e.touches[0].clientY; dragging=true;
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(!dragging||sliding)return;
    const dx=e.touches[0].clientX-tx;
    const dy=e.touches[0].clientY-ty;
    // If clearly vertical scroll, cancel
    if(Math.abs(dy)>Math.abs(dx)*1.5){dragging=false;}
  },{passive:true});
  document.addEventListener('touchend',e=>{
    if(!dragging)return; dragging=false;
    const dx=e.changedTouches[0].clientX-tx;
    const dy=e.changedTouches[0].clientY-ty;
    if(Math.abs(dx)<50||Math.abs(dx)<Math.abs(dy)*1.5)return;
    sliding=true;
    if(dx<0){shiftAnchor(1);render( 1);}
    else    {shiftAnchor(-1);render(-1);}
    setTimeout(()=>sliding=false,400);
  },{passive:true});
})();

// ── PWA: MANIFEST + INSTALL BUTTON ─────────────────────
// Build manifest dynamically from current origin + OVERLAP_CONFIG branding
// so it always matches the serving domain (avoids Android security warning)
(function(){
  const cfg      = window.OVERLAP_CONFIG || window.ROOSTER_CONFIG || {};
  const branding = cfg.branding || {};
  const appDir   = location.pathname.replace(/\/[^\/]*$/, '/');
  // Always use the square app icons for the manifest (logoUrl is for display, not PWA icons)
  const icon192  = appDir + 'app/icon-192.png';
  const icon512  = appDir + 'app/icon-512.png';
  const themeClr = branding.themeColor || '#1a3d2b';
  const appName  = branding.appName || branding.name || 'Overlap';
  const manifest = {
    id:               location.origin + appDir,
    name:             appName,
    short_name:       appName,
    start_url:        appDir,
    scope:            appDir,
    display:          'standalone',
    orientation:      'any',
    background_color: themeClr,
    theme_color:      themeClr,
    prefer_related_applications: false,
    icons: [
      { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  };
  const link = document.getElementById('manifestLink');
  if(link) link.href = 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify(manifest));
})();

// Chrome/Edge/Android install prompt
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  deferredPrompt=e;
  const b=document.getElementById('installBtn');
  if(b) b.style.display='flex';
  const s=document.getElementById('installSection');
  if(s) s.style.display='';
});
window.addEventListener('appinstalled',()=>{
  const b=document.getElementById('installBtn');if(b)b.style.display='none';
  const s=document.getElementById('installSection');if(s)s.style.display='none';
});

// iOS Safari: beforeinstallprompt never fires — detect and show button manually
(function(){
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if(isIOS && !window.navigator.standalone){
    const b=document.getElementById('installBtn');if(b)b.style.display='flex';
    const s=document.getElementById('installSection');if(s)s.style.display='';
  }
})();

document.getElementById('installBtn')?.addEventListener('click',async()=>{
  if(deferredPrompt){
    deferredPrompt.prompt();
    const{outcome}=await deferredPrompt.userChoice;
    deferredPrompt=null;
    if(outcome==='accepted'){
      document.getElementById('installBtn').style.display='none';
      const s=document.getElementById('installSection');if(s)s.style.display='none';
    }
  } else {
    // Toggle iOS/fallback instruction panel
    const tip=document.getElementById('iosInstallTip');
    if(tip) tip.style.display = tip.style.display==='none' ? '' : 'none';
  }
});

// ── PRINT ORIENTATION ───────────────────────────────────
(()=>{
  const pageStyle=document.createElement('style');
  pageStyle.id='printPageRule';
  document.head.appendChild(pageStyle);

  function getWeekNr(d){
    const jan4=new Date(d.getFullYear(),0,4);
    const startOfW1=new Date(jan4);
    startOfW1.setDate(jan4.getDate()-(jan4.getDay()||7)+1);
    return Math.floor(1+(d-startOfW1)/604800000);
  }

  function printAs(orientation){
    // Fill in print header
    const days=getDays().sort((a,b)=>a-b);
    const s=days[0],e=days[days.length-1];
    const wk=getWeekNr(s);
    const label=vm==='day'
      ? `${DL[s.getDay()]} ${s.getDate()} ${MN[s.getMonth()]} ${s.getFullYear()}`
      : `${UI.week} ${wk} · ${s.getDate()} ${MN[s.getMonth()]} – ${e.getDate()} ${MN[e.getMonth()]} ${e.getFullYear()}`;
    document.getElementById('printMeta').textContent=label;

    const pageRule=orientation==='landscape'
      ? '@page{size:A4 landscape;margin:4mm 6mm}'
      : '@page{size:A4 portrait;margin:8mm 8mm}';
    pageStyle.textContent=pageRule;

    // Page dimensions in px (used for zoom calculation only — zoom applied via @media print CSS)
    // A4 landscape: 297×210mm, @page margin 4mm top/bottom 6mm left/right → 285×202mm usable
    // A4 portrait:  210×297mm, @page margin 8mm all sides              → 194×281mm usable
    const mmW = orientation==='landscape' ? 280 : 190;
    const mmH = orientation==='landscape' ? 196 : 275;
    const pxPerMm = 96/25.4;
    const pageW = mmW * pxPerMm;
    const pageH = mmH * pxPerMm;

    const panel = document.getElementById('panelCur');
    document.body.classList.remove('print-landscape','print-portrait');
    document.body.classList.add('print-'+orientation);

    // Re-render with unlimited columns so all shifts print
    window._printMaxCols = 99;
    renderInto(panel, anc);

    // In day view, expand width to fit all printed columns (unconstrained by screen width)
    if (vm === 'day') {
      const _printW = 52 + (window._dayMaxCols || 1) * 168;
      document.body.style.setProperty('--day-view-width', _printW + 'px');
    }

    // Wait one RAF so the compact-header height-sync RAF runs first,
    // then recalculate zoom from the final layout and print.
    requestAnimationFrame(()=>{
      // Measure the actual print header height by temporarily showing it
      const phEl = document.getElementById('printHeader');
      phEl.style.cssText='display:flex!important;visibility:hidden;position:absolute';
      const hdrH = phEl.offsetHeight;
      phEl.style.cssText='';

      const contentH2 = panel.scrollHeight + hdrH + 8;
      const contentW2 = panel.scrollWidth;
      const zoom2 = Math.min(pageH/contentH2, pageW/contentW2);
      // Zoom applied only in @media print so the screen is never visually affected
      pageStyle.textContent=pageRule+`\n@media print{#panelCur,#printHeader{zoom:${zoom2}}}`;

      // Apply printFontScale for week view only (scales all rem-based font sizes)
      // Save the current value so we can restore it exactly after print
      const _prevFontSize=document.documentElement.style.fontSize;
      const _pfs = vm==='week' ? ((window.ROOSTER_CONFIG&&window.ROOSTER_CONFIG.defaults&&window.ROOSTER_CONFIG.defaults.printFontScale)||1) : 1;
      if(_pfs !== 1) document.documentElement.style.fontSize = (_pfs * 16) + 'px';

      window.print();
      window.addEventListener('afterprint',()=>{
        document.body.classList.remove('print-landscape','print-portrait');
        document.documentElement.style.fontSize=_prevFontSize;
        document.body.style.removeProperty('--hh');
        pageStyle.textContent='';
        window._printMaxCols = null;
        render(0); // restore normal render
      },{once:true});
    });
  }

  // Main button → landscape; arrow → dropdown menu
  const menu=document.getElementById('printMenu');

  function showPrintMenu(){
    const btn=document.getElementById('printDrop');
    if(btn){
      const r=btn.getBoundingClientRect();
      menu.style.top=(r.bottom+4)+'px';
      menu.style.left=Math.min(r.left,window.innerWidth-180)+'px';
    }
    menu.style.display='block';
  }
  function hidePrintMenu(){ menu.style.display='none'; }

  document.getElementById('printLandBtn')?.addEventListener('click',()=>printAs('landscape'));
  document.getElementById('printDrop')?.addEventListener('click',e=>{
    e.stopPropagation();
    menu.style.display==='none'?showPrintMenu():hidePrintMenu();
  });
  document.getElementById('printLandOpt')?.addEventListener('click',()=>{ hidePrintMenu(); printAs('landscape'); });
  document.getElementById('printPortOpt')?.addEventListener('click',()=>{ hidePrintMenu(); printAs('portrait'); });
  document.addEventListener('click',e=>{
    if(!e.target.closest('#printBtnGroup')&&!e.target.closest('#printMenu')) hidePrintMenu();
  });
})();

// ── SHARE AS PNG ─────────────────────────────────────────
(()=>{
  async function loadHtml2Canvas(){
    if(window.html2canvas) return;
    await new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload=resolve; s.onerror=reject;
      document.head.appendChild(s);
    });
  }

  async function shareAsPng(e){
    const btn=(e&&e.currentTarget)||document.getElementById('shareBtn');
    const origHTML=btn.innerHTML;
    btn.disabled=true;
    btn.innerHTML='<span>…</span>';
    try {
      await loadHtml2Canvas();
      // For day view: capture just the narrow grid (#cg) for a portrait image
      const isDayView=document.body.classList.contains('view-day');
      const cgEl=isDayView?document.querySelector('#panelCur #cg'):null;
      const panel=cgEl||document.getElementById('panelCur');
      const label=document.getElementById('pl').textContent;

      // Freeze animations so events render at full opacity instead of mid-keyframe
      const animated=panel.querySelectorAll('.ev,.compact-ev,.overflow-ev,.allday-block');
      animated.forEach(el=>{
        el.style.animation='none';
        el.style.opacity=el.classList.contains('ev')?'0.9':'1';
      });

      const gridCanvas=await html2canvas(panel,{
        scale:2,
        useCORS:true,
        backgroundColor:'#ffffff',
        logging:false,
        height:panel.scrollHeight,
        windowHeight:panel.scrollHeight,
        onclone:(doc)=>{
          doc.body.classList.add('share-capture');
          // Remove sketchy.css — html2canvas can't parse color-mix() in its gradients
          doc.querySelectorAll('link[rel="stylesheet"]').forEach(l=>{
            if(l.href&&l.href.includes('sketchy.css')) l.remove();
          });
          doc.querySelectorAll('.ev,.compact-ev,.overflow-ev,.allday-block').forEach(el=>{
            el.style.animation='none';
            el.style.opacity=el.classList.contains('ev')?'0.9':'1';
          });
        },
      });

      // Restore animations
      animated.forEach(el=>{ el.style.animation=''; el.style.opacity=''; });

      // Compose: green title bar on top, then the calendar
      const S=2;
      const barH=52*S;
      const out=document.createElement('canvas');
      out.width=gridCanvas.width;
      out.height=gridCanvas.height+barH;
      const ctx=out.getContext('2d');

      // Header bar
      ctx.fillStyle='#1a3d2b';
      ctx.fillRect(0,0,out.width,barH);

      // Logo text
      ctx.fillStyle='#ffffff';
      ctx.font=`700 ${15*S}px "DM Sans",sans-serif`;
      ctx.textBaseline='middle';
      ctx.fillText('Parknest',16*S,barH*0.32);

      // Week/day label
      ctx.font=`400 ${11*S}px "DM Sans",sans-serif`;
      ctx.fillStyle='#b7e4c7';
      ctx.fillText(label,16*S,barH*0.72);

      // Calendar grid
      ctx.drawImage(gridCanvas,0,barH);

      const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));
      const days=getDays().sort((a,b)=>a-b);
      const s=days[0];
      const fname=vm==='week'
        ?`parknest-week-${s.getFullYear()}-${p2(s.getMonth()+1)}-${p2(s.getDate())}.png`
        :`parknest-${s.getFullYear()}-${p2(s.getMonth()+1)}-${p2(s.getDate())}.png`;

      const file=new File([blob],fname,{type:'image/png'});
      const shareUrl=location.href;
      const canClipboardImage=!!(navigator.clipboard&&window.ClipboardItem);
      const preferNativeShare=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent||'')&&(navigator.maxTouchPoints||0)>0;
      // 1. Desktop: copy the bitmap first, avoiding a native share sheet that often reports "canceled".
      if(canClipboardImage&&!preferNativeShare){
        try{
          await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
          showShareToast('Afbeelding gekopieerd — plak in WhatsApp of een andere app');
          return;
        }catch(_){}
      }
      // 2. Mobile: native share sheet, picks WhatsApp etc directly.
      if(navigator.canShare&&navigator.canShare({files:[file]})){
        try{
          await navigator.share({files:[file],title:'Parknest Rooster',text:label+'\n'+shareUrl});
          return;
        }catch(err){
          // If the native sheet is canceled or unavailable, continue to clipboard/download.
          if(err&&err.name!=='AbortError') console.warn('navigator.share failed, falling back',err);
        }
      }
      // 3. Clipboard fallback — also used when mobile share was canceled/unavailable.
      if(canClipboardImage){
        try{
          await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
          showShareToast('Afbeelding gekopieerd — plak in WhatsApp of een andere app');
          return;
        }catch(_){}
      }
      // 4. Download fallback
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url; a.download=fname;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch(err){
      // Ensure animations are restored on error too
      document.getElementById('panelCur').querySelectorAll('.ev,.compact-ev,.overflow-ev,.allday-block')
        .forEach(el=>{ el.style.animation=''; el.style.opacity=''; });
      console.error('shareAsPng',err);
      alert('Afbeelding maken mislukt:\n'+err.message);
    } finally {
      btn.disabled=false;
      btn.innerHTML=origHTML;
    }
  }

  // Main share button: generate screenshot and open native share sheet
  // On mobile this lets you pick WhatsApp etc and sends the calendar image + link text
  // On desktop (no Web Share API): downloads the PNG file
  document.getElementById('shareBtn').addEventListener('click',shareAsPng);

  // Arrow button: copy the URL link to clipboard
  document.getElementById('shareDrop').addEventListener('click',async()=>{
    syncUrl();
    const url=location.href;
    try{
      await navigator.clipboard.writeText(url);
    }catch(_){
      const inp=document.createElement('input');
      inp.value=url; document.body.appendChild(inp); inp.select();
      document.execCommand('copy'); document.body.removeChild(inp);
    }
    showShareToast('Link gekopieerd!');
  });
})();

applyLocaleUI();
setViewMode(vm);

// Apply screen font scale from config (printFontScale is handled in printAs — week view only)
(()=>{
  const d = window.ROOSTER_CONFIG && window.ROOSTER_CONFIG.defaults || {};
  const fs = d.fontScale || 1;
  if(fs !== 1){
    const s = document.createElement('style');
    s.textContent = `html{font-size:${fs * 16}px}`;
    document.head.appendChild(s);
  }
})();

fetchEvents().then(()=>setTimeout(scrollToToday,400));

// Auto-refresh — interval configurable via window._overlapRefreshMin (0 = off)
var _refreshTimer = null;
(function startRefresh(){
  var min = (window._overlapRefreshMin !== undefined) ? window._overlapRefreshMin : 15;
  clearInterval(_refreshTimer);
  if(min > 0) _refreshTimer = setInterval(()=>fetchEvents(true, true), min * 60 * 1000);
})();
window._setRefreshInterval = function(min){
  window._overlapRefreshMin = min;
  clearInterval(_refreshTimer);
  if(min > 0) _refreshTimer = setInterval(()=>fetchEvents(true, true), min * 60 * 1000);
};

// ── EVENT ANIMATION STYLE SWITCHER ───────────────────────
// Tap the period label (#pl) to cycle: Grow → Rise → Fade → Flip X → Flip Y → Grow…
(()=>{
  const STYLES=[
    {key:'grow', anim:'evInGrow', dur:'.44s', ease:'cubic-bezier(0.34,1.56,0.64,1)', label:'Grow ✦'},
    {key:'rise', anim:'evInRise', dur:'.38s', ease:'cubic-bezier(0.22,1,0.36,1)',    label:'Rise ↑'},
    {key:'fade', anim:'evInFade', dur:'.30s', ease:'cubic-bezier(0.4,0,0.2,1)',      label:'Fade ◌'},
    {key:'flipx', anim:'evInFlipX', dur:'.85s', ease:'cubic-bezier(0.2,0.8,0.2,1)',   label:'Flip X'},
    {key:'flipy', anim:'evInFlipY', dur:'2.6s',  ease:'linear',                        label:'Flip Y'},
  ];
  let cur = +(localStorage.getItem('evAnimIdx')||0);
  if(!STYLES[cur]) cur=0;
  function apply(){
    const s=STYLES[cur];
    const r=document.documentElement.style;
    r.setProperty('--ev-anim',s.anim);
    r.setProperty('--ev-dur', s.dur);
    r.setProperty('--ev-ease',s.ease);
  }
  window._getEventAnimationStyle=()=>cur;
  window._setEventAnimationStyle=(idx)=>{
    cur=+idx;
    if(!STYLES[cur]) cur=0;
    localStorage.setItem('evAnimIdx',cur);
    apply();
    render(0);
  };
  apply();
})();

// Logo tap = force reload with spin animation (keeps spinning until fetch completes)
document.querySelector('.logo').addEventListener('click', () => {
  const img = document.querySelector('.logo img');
  if(!img) return;
  img.classList.add('logo-spin');
  fetchEvents(false, true).finally(() => img.classList.remove('logo-spin'));
});
