const CONFIG = window.ROOSTER_CONFIG || { auth:{accounts:[]}, crew:[], defaults:{} };
const ICS_ROOSTER  = CONFIG.defaults.calendarUrl || 'https://calendar.google.com/calendar/ical/f0a70a3f3862ea4c0202a62f4bd8b3298a1cd69d53e57944c0dcaeab39b54dc6%40group.calendar.google.com/public/basic.ics';
const ICS_AFSPRAKEN= CONFIG.defaults.appointmentUrl || 'https://calendar.google.com/calendar/ical/f99b1ad32b1aa1f543623c166d7b74e45155aee446a941d7d0342b38b41da904%40group.calendar.google.com/public/basic.ics';
const ICS_MAIN     = CONFIG.defaults.mainEventCalendarUrl || 'https://calendar.google.com/calendar/ical/parknestflevopark%40gmail.com/public/basic.ics';
const ICS = ICS_ROOSTER; // backward compat

// Each proxy function receives the exact ICS URL to fetch
const PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  url => `app/proxy.php?url=${encodeURIComponent(url)}`,
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
function crewColor(name){ const user = CONFIG.crew.find(c=>c.name.toLowerCase()===name.toLowerCase()); return user?.color || PALETTES[nameHash(name)][0] || '#dbeeff'; }
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
  nl:{today:'Today',week:'Week',day:'Day',events:'Events',print:'Print',share:'Deel',install:'Installeer',loading:'Laden\u2026',loadFail:'\u26a0 Laden mislukt',wkShort:'Wk',calFail:'Kalender kon niet worden geladen'},
  en:{today:'Today',week:'Week',day:'Day',events:'Events',print:'Print',share:'Share',install:'Install',loading:'Loading\u2026',loadFail:'\u26a0 Load failed',wkShort:'Wk',calFail:'Calendar could not be loaded'},
  de:{today:'Heute',week:'Woche',day:'Tag',events:'Events',print:'Drucken',share:'Teilen',install:'Installieren',loading:'Laden\u2026',loadFail:'\u26a0 Laden fehlgeschlagen',wkShort:'KW',calFail:'Kalender konnte nicht geladen werden'},
  tr:{today:'Bug\xfcn',week:'Hafta',day:'G\xfcn',events:'Etkinlik',print:'Yazd\u0131r',share:'Payla\u015f',install:'Y\xfckle',loading:'Y\xfckleniyor\u2026',loadFail:'\u26a0 Y\xfckleme ba\u015far\u0131s\u0131z',wkShort:'Hf',calFail:'Takvim y\xfcklenemedi'},
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

function updateDayViewMetrics(hourCount){
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

  const a4Height = reserveH + hourCount * HH;
  const targetWidth = Math.floor(a4Height / Math.SQRT2);
  const boundedWidth = Math.max(280, Math.min(targetWidth, viewportW - 20, 620));

  document.body.style.setProperty('--hh', `${HH}px`);
  document.body.style.setProperty('--day-view-width', `${boundedWidth}px`);
}

let allEv=[],vm='week',anc=sowk(new Date());
// Restore view/date from URL hash (e.g. #day/2026-05-10 or #week/2026-05-04)
(()=>{
  const m=location.hash.match(/^#(week|day)\/(\d{4}-\d{2}-\d{2})$/);
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

async function tryFetch(proxyFn, url) {
  const r = await fetch(proxyFn(url), {signal: AbortSignal.timeout(5000)});
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await r.text();
  if (!t.includes('BEGIN:VCALENDAR')) throw new Error('Geen geldige ICS data');
  return t;
}

async function fetchEvents(silent=false){
  document.getElementById('ls').textContent=UI.loading;
  if(!silent) showSkeleton();

  async function fetchOne(icsUrl, tag){
    const text = await Promise.any(PROXIES.map(fn => tryFetch(fn, icsUrl)));
    return parseICS(text).map(ev=>({...ev,_cal:tag}));
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

function retryLoad(){ showSkeleton(); fetchEvents(); }

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
  fetchEvents();
  showShareToast(`Dienst toegevoegd voor ${crew} op ${date}`);
}

function deleteLocalShift(localId){
  const shift = localShifts.find(s=>s.id===localId);
  if(shift?.googleEventId && googleSignedIn && hasGoogleConfig()){
    deleteEventInGoogle(shift.googleEventId);
  }
  localShifts = localShifts.filter(s=>s.id!==localId);
  saveLocalShifts();
  fetchEvents();
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
  if(vm==='day') return [{days:[new Date(anchorDate)],narrow:false}];
  const showTue=hasTuesdayEvents(anchorDate);
  const week=[];for(let i=0;i<7;i++)week.push(addD(anchorDate,i));
  return week
    .filter(d=> showTue || d.getDay()!==2)
    .map(d=>({days:[d],narrow:false}));
}

function getDays(){
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

function nameHasQuestionMark(name){
  return String(name||'').includes('?');
}

function nameHash(str){
  let h=0;
  for(let i=0;i<str.length;i++)h=(h*31+str.charCodeAt(i))>>>0;
  return h%PALETTES.length;
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

  const crewItem = CONFIG.crew.find(c=>c.name.toLowerCase()===displayName.toLowerCase());
  if(crewItem){
    const baseColor = crewItem.color;
    const contrast = contrastTextColor(baseColor);
    dv.style.background = isQuestion ? rgbaFromHex(baseColor, 0.85) : baseColor;
    dv.style.color = isQuestion ? contrast : contrast;
    dv.style.borderLeftColor = baseColor;
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

function renderInto(container, anchorDate){
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
    updateDayViewMetrics(dayEh-daySh);
  } else {
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
  const inner  = document.getElementById('slideInner');
  const panCur = document.getElementById('panelCur');
  const panPrev= document.getElementById('panelPrev');
  const panNext= document.getElementById('panelNext');

  if(dir===0 || !inner){
    // Initial load — no animation
    renderInto(panCur, anc);
    inner.style.transition='none';
    inner.style.transform='translateX(-100%)';
    updateLabel();
    return;
  }

  // Pre-render adjacent panel
  if(dir>0){
    renderInto(panNext, anc);
    inner.style.transition='none';
    inner.style.transform='translateX(-100%)'; // show current
    panNext.offsetHeight; // force reflow
    inner.style.transition='transform .28s cubic-bezier(.4,0,.2,1)';
    inner.style.transform='translateX(-200%)'; // slide to next
  } else {
    renderInto(panPrev, anc);
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
    renderInto(panCur, anc);
    panPrev.innerHTML='';
    panNext.innerHTML='';
    inner.style.transition='none';
    inner.style.transform='translateX(-100%)';
    updateLabel();
    updateWeekStrip();
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

function syncUrl(){
  const days=getDays().sort((a,b)=>a-b);
  const d=days[0];
  const ds=`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
  history.replaceState(null,'',location.pathname+'#'+vm+'/'+ds);
}

function scrollToToday(){
  requestAnimationFrame(()=>{
    const now=new Date();
    const curH=now.getHours()+now.getMinutes()/60;
    // Find the cell closest to current time in today's column
    const todayKey=new Date();todayKey.setHours(0,0,0,0);
    const key=todayKey.toDateString();
    // Try to find a cell at current hour - 1 so the current time is visible with context
    const targetH=Math.max(0,Math.floor(curH)-1);
    let cell=document.querySelector(`[data-col="${key}"][data-h="${targetH}"]`);
    // Fallback: find today header
    if(!cell) cell=document.querySelector('.ch.tc');
    if(cell) cell.scrollIntoView({behavior:'smooth',block:'start',inline:'nearest'});
  });
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
  // Per-event total: max col+1 among events that truly overlap with this one
  result.forEach(r=>{
    const s=r.ev.start._ad?0:r.ev.start.getTime();
    const e=r.ev.end?(r.ev.end._ad?s+86400000:r.ev.end.getTime()):s+3600000;
    let mx=r.col;
    result.forEach(o=>{
      if(o===r||o.overflow)return;
      const os=o.ev.start._ad?0:o.ev.start.getTime();
      const oe=o.ev.end?(o.ev.end._ad?os+86400000:o.ev.end.getTime()):os+3600000;
      if(os<e&&oe>s)mx=Math.max(mx,o.col);
    });
    r.total=mx+1;
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
        html+=`<div class="compact-ev${isQuestion?' question-shift':''}${isDanger?' danger-shift':''}" style="background:${bg};color:${tx};border-left-color:${ac};animation-delay:${idx++*40}ms">
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
        const cls=ev._cal==='holiday'?'is-holiday':ev._cal==='afspraken'?'is-afspraak':'is-other';
        const[bg,tx,ac]=ev._cal==='holiday'?['#fde8e8','#c0392b','#c0392b']:ev._cal==='afspraken'?['#e8f0fe','#1a56db','#1a56db']:PALETTES[nameHash(ev.title||'')];
        const bl=document.createElement('div');
        bl.className=`allday-block ${cls}`;bl.style.cssText=`background:${bg};color:${tx};border-left-color:${ac}`;bl.dataset.baseZ='';bl.textContent=ev.title||'?';
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
    const crewEvs=timedEvs.filter(ev=>ev._cal!=='main');

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

    // Place crew/afspraken events — column-assigned, no overflow strip
    const assigned=assignColumns(crewEvs,2);
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
        const afspraakSlot=rightFloatShiftSlot(ev,crewEvs);
        if(afspraakSlot){
          leftPct=afspraakSlot.left;
          rightPct=afspraakSlot.right;
        } else {
        const hasMO=!mainHidden&&mainEvs.some(me=>{
          const ms=me.start.getTime(),mend=me.end?me.end.getTime():ms+3600000;
          const es=ev.start.getTime(),ee=ev.end?ev.end.getTime():es+3600000;
          return ms<ee&&mend>es;
        });
        if(hasMO){
          const cw=75/total;leftPct=25+col*cw;rightPct=(total-col-1)*cw;
        } else {
          const gap=total<=2?2:1,cw=(100-gap*(total-1))/total;
          leftPct=col*(cw+gap);rightPct=100-leftPct-cw;
        }
        }
      }

      const dv=document.createElement('div');
      const isDanger=(ev.title||'').includes('**');
      dv.className='ev'+(ev._cal==='afspraken'?' afspraak':'')+(isDanger?' danger-shift':'');
      applyColor(dv,ev.title||'');
      if(ev._cal==='afspraken'){dv.style.background='#fde8e8';dv.style.color='#7b1111';}
      dv.style.top=`${top}px`;dv.style.height=`${height}px`;dv.style.left=`${leftPct}%`;dv.style.right=`${rightPct}%`;
      const baseZ=ev._cal==='afspraken'?'3':String(5+col);
      dv.style.zIndex=baseZ;dv.dataset.baseZ=baseZ;
      dv.style.animationDelay=`${Math.round(Math.pow(animIdx,1.8)*8)}ms`;
      dv.style.animationDuration=`${300+animIdx*30}ms`;
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
  container.style.gridTemplateColumns='52px repeat(3, 1fr)';

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

function buildGrid(container, colDefs, today, exp, _cm, _ci, _byDay, sh, eh){
  container.style.display='grid';
  container.style.gridTemplateColumns=`52px repeat(${colDefs.length},1fr)`;
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
        const cls=ev._cal==='holiday'?'is-holiday':ev._cal==='afspraken'?'is-afspraak':'is-other';
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
        h+=`<div class="allday-block ${cls}" style="background:${bg};color:${tx};border-left-color:${ac}" data-adtip="${tipIdx}">${ev.title||'?'}${timeStr}</div>`;
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

  // Day-view: allow more columns (up to 6); week-view: cap at 3; print: unlimited
  const maxCols = window._printMaxCols || (vm==='day' ? 6 : 3);

  let animIdx=0;
  // Collect overflow events per day column for the overflow strip
  const overflowByCol={};
  colDefs.forEach(cd=>{ overflowByCol[cd.days[0].toDateString()]=[] });

  Object.entries(colEvents).forEach(([colKey,evList])=>{
    const assigned=assignColumns(evList, maxCols);
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
      dv.className='ev'+(ev._cal==='afspraken'?' afspraak':'')+(ev._cal==='main'?' main-event':'')+(isDanger?' danger-shift':'');
      applyColor(dv,ev.title||'');
      if(ev._cal==='main'){
        dv.style.background='linear-gradient(135deg, rgba(173,244,210,.45), rgba(63,190,116,.25))';
        dv.style.color='#0f3c20';
        dv.style.border='2px solid rgba(26,61,43,.45)';
      }
      if(ev._cal==='afspraken'){dv.style.background='#fde8e8';dv.style.color='#7b1111';}
      dv.style.top=`${top-(cH-sh)*HH}px`;dv.style.height=`${height}px`;
      // Width calculation
      let leftPct,rightPct;
      if(ev._cal==='afspraken'){
        // Appointments sit below shifts as a full-width context layer.
        leftPct=0; rightPct=0;
      } else if(mainHidden){
        // Events hidden: clean side-by-side full width
        const gap=total<=2?2:1;
        const cellW=(100-gap*(total-1))/total;
        leftPct=col*(cellW+gap);
        rightPct=100-leftPct-cellW;
      } else if(ev._cal==='main'){
        // Main/background event: always full width
        leftPct=0; rightPct=0;
      } else {
        const afspraakSlot=rightFloatShiftSlot(ev,evList);
        if(afspraakSlot){
          leftPct=afspraakSlot.left;
          rightPct=afspraakSlot.right;
        } else {
        // Check if a main event overlaps this shift
        const hasMainOverlap=assigned.some(r2=>{
          if(r2.overflow||r2.ev._cal!=='main')return false;
          const as=r2.ev.start.getTime(),ae=r2.ev.end?r2.ev.end.getTime():as+3600000;
          const bs=ev.start.getTime(),be=ev.end?ev.end.getTime():bs+3600000;
          return as<be&&ae>bs;
        });
        if(hasMainOverlap){
          // Non-main events use 25%–100%, subdivided among themselves
          // Main event is at col=0; volunteer cols start at 1
          const nonMainTotal=total-1;
          const nonMainCol=col-1;
          if(nonMainTotal<=0){leftPct=25;rightPct=0;}
          else{const cw=75/nonMainTotal;leftPct=25+nonMainCol*cw;rightPct=(nonMainTotal-nonMainCol-1)*cw;}
        } else {
          // No main event overlap: clean side-by-side
          const gap=total<=2?2:1;
          const cellW=(100-gap*(total-1))/total;
          leftPct=col*(cellW+gap);
          rightPct=100-leftPct-cellW;
        }
        }
      }

      dv.style.left=`${leftPct}%`;dv.style.right=`${rightPct}%`;
      // Main events at bottom, appointments above them, shifts above appointments.
      const baseZ=ev._cal==='afspraken'?'3':ev._cal==='main'?'2':String(5+col);
      dv.style.zIndex=baseZ;
      dv.dataset.baseZ=baseZ;
      const _ai=animIdx++;
      dv.style.animationDelay=`${Math.round(Math.pow(_ai,1.8)*8)}ms`;
      dv.style.animationDuration=`${300+_ai*30}ms`;
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
      cell.style.cssText=`border-right:${isLastCol?'none':'2.5px solid #222'};border-bottom:2.5px solid #222`;
      if(ovEvs.length>0){
        ovEvs.forEach((ev,idx)=>{
          const[bg,tx,ac]=PALETTES[nameHash(ev.title||'')];
          const ts=ev.start._ad?'':`${p2(ev.start.getHours())}:${p2(ev.start.getMinutes())}`;
          const te=(!ev.start._ad&&ev.end&&!ev.end._ad)?` – ${p2(ev.end.getHours())}:${p2(ev.end.getMinutes())}`:'';
          const row=document.createElement('div');
          row.className='overflow-ev';
          row.style.cssText=`background:${bg};color:${tx};border-left-color:${ac};animation-delay:${idx*40}ms`;
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
        if(label) label.scrollIntoView({behavior:'smooth',block:'start'});
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
  tipEl.innerHTML=`<strong>${ev.title||'(geen titel)'}</strong><br>🕐 ${ts}${te}${ev.location?'<br>📍 '+ev.location:''}${ev.desc?'<br><em style="font-size:.68rem;opacity:.85">'+ev.desc.slice(0,100)+'</em>':''}`;
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

document.getElementById('pB').onclick=()=>{anc=(vm==='week')?addD(anc,-7):addD(anc,-1);render(-1)};
document.getElementById('nB').onclick=()=>{anc=(vm==='week')?addD(anc,7):addD(anc,1);render(1)};
document.getElementById('tB').onclick=()=>{const t=new Date();anc=(vm==='week'&&!isPhone())?sowk(t):t;render(0);setTimeout(scrollToToday,350)};
document.getElementById('bW').onclick=()=>{vm='week';anc=sowk(anc);document.getElementById('bW').classList.add('on');document.getElementById('bD').classList.remove('on');render(0)};
document.getElementById('bD').onclick=()=>{vm='day';document.getElementById('bD').classList.add('on');document.getElementById('bW').classList.remove('on');render(0)};

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
document.getElementById('mainLayerToggle')?.addEventListener('change', (e) => {
  document.body.classList.toggle('main-layer-hidden', !e.target.checked);
  document.body.classList.add('layer-toggling');
  render(0);
  requestAnimationFrame(()=>requestAnimationFrame(()=>document.body.classList.remove('layer-toggling')));
});

// Initialize login & editing controls
initEditFeatures();

// ── DATEPICKER ───────────────────────────────────────────
(()=>{
  // Locale-aware short weekday names Mon–Sun (2023-01-02 = Monday)
  const _dpDow = Array.from({length:7},(_,i)=>new Intl.DateTimeFormat(_locale,{weekday:'short'}).format(new Date(2023,0,2+i)));
  const _dpMonFmt = new Intl.DateTimeFormat(_locale,{month:'long',year:'numeric'});
  const dp=document.getElementById('datePicker');
  let dpDate=new Date(); // month currently shown in picker

  function renderPicker(){
    const today=new Date();today.setHours(0,0,0,0);
    const y=dpDate.getFullYear(),m=dpDate.getMonth();
    document.getElementById('dpMonthLabel').textContent=_dpMonFmt.format(new Date(y,m,1));

    // Day-of-week headers starting Monday
    let g=_dpDow.map(d=>`<div class="dp-dow">${d}</div>`).join('');

    // First day of month; pad to Monday start
    const first=new Date(y,m,1);
    const startDow=first.getDay()===0?6:first.getDay()-1; // 0=Mon
    const daysInMonth=new Date(y,m+1,0).getDate();

    // Prev month padding
    const daysInPrev=new Date(y,m,0).getDate();
    for(let i=startDow-1;i>=0;i--) g+=`<div class="dp-day dp-other">${daysInPrev-i}</div>`;

    // Days of month
    for(let d=1;d<=daysInMonth;d++){
      const dd=new Date(y,m,d);dd.setHours(0,0,0,0);
      const isToday=dd.getTime()===today.getTime();
      // Is this day within the currently shown anchor?
      const isSel=vm==='week'
        ? (dd>=sowk(anc)&&dd<=addD(sowk(anc),6))
        : same(dd,anc);
      const cls='dp-day'+(isToday?' dp-today':'')+(isSel&&!isToday?' dp-sel':'');
      g+=`<div class="${cls}" data-y="${y}" data-m="${m}" data-d="${d}">${d}</div>`;
    }
    // Next month padding to fill row
    const total=startDow+daysInMonth;
    const rem=total%7===0?0:7-(total%7);
    for(let d=1;d<=rem;d++) g+=`<div class="dp-day dp-other">${d}</div>`;

    document.getElementById('dpGrid').innerHTML=g;

    // Click on a day
    document.getElementById('dpGrid').onclick=e=>{
      const el=e.target.closest('.dp-day');
      if(!el||el.classList.contains('dp-other'))return;
      const chosen=new Date(+el.dataset.y,+el.dataset.m,+el.dataset.d);
      anc=vm==='week'?sowk(chosen):chosen;
      render(0);
      setTimeout(scrollToToday,350);
      hidePicker();
    };
  }

  function showPicker(){
    dpDate=new Date(anc); // start on current anchor's month
    renderPicker();
    // Position below the dropdown arrow button
    const btn=document.getElementById('tBDrop');
    const r=btn.getBoundingClientRect();
    dp.style.top=(r.bottom+6)+'px';
    dp.style.left=Math.min(r.left,window.innerWidth-270)+'px';
    dp.style.display='block';
  }
  function hidePicker(){ dp.style.display='none'; }

  document.getElementById('tBDrop').onclick=e=>{
    e.stopPropagation();
    dp.style.display==='none'?showPicker():hidePicker();
  };
  document.getElementById('dpPrev').onclick=e=>{
    e.stopPropagation();
    dpDate=new Date(dpDate.getFullYear(),dpDate.getMonth()-1,1);
    renderPicker();
  };
  document.getElementById('dpNext').onclick=e=>{
    e.stopPropagation();
    dpDate=new Date(dpDate.getFullYear(),dpDate.getMonth()+1,1);
    renderPicker();
  };
  // Close on outside click
  document.addEventListener('click',e=>{
    if(!dp.contains(e.target)&&e.target.id!=='tBDrop')hidePicker();
  });
})();

// ── KEYBOARD NAVIGATION ─────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft')  { anc=(vm==='week')?addD(anc,-7):addD(anc,-1); render(-1); e.preventDefault(); }
  if (e.key === 'ArrowRight') { anc=(vm==='week')?addD(anc,7):addD(anc,1); render( 1); e.preventDefault(); }
  if (e.key === 'ArrowUp')    { vm='week';anc=sowk(anc);document.getElementById('bW').classList.add('on');document.getElementById('bD').classList.remove('on');render(0);e.preventDefault(); }
  if (e.key === 'ArrowDown')  { vm='day';document.getElementById('bD').classList.add('on');document.getElementById('bW').classList.remove('on');render(0);e.preventDefault(); }
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
    if(dx<0){anc=(vm==='week')?addD(anc,7):addD(anc,1);render( 1);}
    else    {anc=(vm==='week')?addD(anc,-7):addD(anc,-1);render(-1);}
    setTimeout(()=>sliding=false,400);
  },{passive:true});
})();

// ── PWA: MANIFEST + INSTALL BUTTON ─────────────────────
// Build manifest as a proper data-URI (not blob:) so Android/Play Protect
// does not flag it as an unknown-origin app
const iconUrl = 'https://parknest.nl/wp-content/uploads/2024/09/Parknest-logo-transp-shadow.png';

const manifest = {
  id: 'https://parknest.nl/parknest-rooster.html',
  name: 'Parknest Vrijwilligersrooster',
  short_name: 'Parknest',
  description: 'Vrijwilligersrooster van Stichting Buurtbelang Parknest',
  start_url: 'https://parknest.nl/parknest-rooster.html',
  scope: 'https://parknest.nl/',
  display: 'standalone',
  orientation: 'any',
  background_color: '#1a3d2b',
  theme_color: '#1a3d2b',
  icons: [
    { src: iconUrl, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: iconUrl, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
  ]
};

// Use static manifest file on server; fall back to data-URI locally
const isLocal = location.protocol === 'file:';
if(!isLocal){
  // manifest link already points to parknest-manifest.json — leave it
} else {
  // Replace with inline data-URI to avoid CORS error on local file
  const manifest={id:'/rooster.html',name:'Parknest Vrijwilligersrooster',short_name:'Parknest',start_url:'/rooster.html',scope:'/',display:'standalone',background_color:'#1a3d2b',theme_color:'#1a3d2b',prefer_related_applications:false,icons:[{src:iconUrl,sizes:'192x192',type:'image/png',purpose:'any'},{src:iconUrl,sizes:'512x512',type:'image/png',purpose:'any'},{src:iconUrl,sizes:'512x512',type:'image/png',purpose:'maskable'}]};
  document.getElementById('manifestLink').href='data:application/manifest+json,'+encodeURIComponent(JSON.stringify(manifest));
}

// Chrome/Edge/Android install prompt
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  // Don't call preventDefault — that suppresses the mini-infobar on Android
  deferredPrompt=e;
  const b=document.getElementById('installBtn');b.style.display='flex';
});
window.addEventListener('appinstalled',()=>{document.getElementById('installBtn').style.display='none';});

document.getElementById('installBtn').addEventListener('click',async()=>{
  if(deferredPrompt){
    deferredPrompt.prompt();
    const{outcome}=await deferredPrompt.userChoice;
    deferredPrompt=null;
    if(outcome==='accepted')document.getElementById('installBtn').style.display='none';
  } else {
    alert('Voeg toe aan startscherm:\n\n📱 iPhone/iPad:\nTik op het Deel-icoon (□↑) onderaan Safari → "Zet op beginscherm"\n\n🤖 Android (Chrome):\nTik op menu (⋮) → "Toevoegen aan startscherm"\n\n💻 Desktop Chrome/Edge:\nKlik op het ⊕ icoon rechts in de adresbalk');
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

    pageStyle.textContent=orientation==='landscape'
      ? '@page{size:A4 landscape;margin:4mm 6mm}'
      : '@page{size:A4 portrait;margin:8mm 8mm}';

    // Compute zoom to fit on one page
    // A4 landscape: 297×210mm, @page margin 4mm top/bottom 6mm left/right → 285×202mm usable
    // A4 portrait:  210×297mm, @page margin 8mm all sides              → 194×281mm usable
    // Subtract a few mm as safety margin so browsers never clip the edge
    const mmW = orientation==='landscape' ? 280 : 190;
    const mmH = orientation==='landscape' ? 196 : 275;
    const pxPerMm = 96/25.4;
    const pageW = mmW * pxPerMm;
    const pageH = mmH * pxPerMm;

    // Measure current rendered height of panelCur (includes all rows)
    const panel = document.getElementById('panelCur');
    const contentH = panel.scrollHeight + 20; // +20 for print header
    const contentW = panel.scrollWidth;

    const zoomH = pageH / contentH;
    const zoomW = pageW / contentW;
    const zoom  = Math.min(zoomH, zoomW, 1); // never zoom in, only out

    document.body.classList.remove('print-landscape','print-portrait');
    document.body.classList.add('print-'+orientation);
    panel.style.zoom = zoom;
    document.getElementById('printHeader').style.zoom = zoom;

    // Re-render with unlimited columns so all shifts print
    window._printMaxCols = 99;
    renderInto(panel, anc);

    // Wait one RAF so the compact-header height-sync RAF runs first,
    // then recalculate zoom from the final layout and print.
    requestAnimationFrame(()=>{
      // Measure the actual print header height by temporarily showing it
      const phEl = document.getElementById('printHeader');
      phEl.style.cssText='display:flex!important;visibility:hidden;position:absolute';
      const hdrH = phEl.offsetHeight;
      phEl.style.cssText='';

      const contentH2 = panel.scrollHeight + hdrH + 8; // +8 small gap between header and grid
      const contentW2 = panel.scrollWidth;
      const zoom2 = Math.min(pageH/contentH2, pageW/contentW2, 1);
      panel.style.zoom = zoom2;
      document.getElementById('printHeader').style.zoom = zoom2;

      // Apply printFontScale for week view only (scales all rem-based font sizes)
      const _pfs = vm==='week' ? ((window.ROOSTER_CONFIG&&window.ROOSTER_CONFIG.defaults&&window.ROOSTER_CONFIG.defaults.printFontScale)||1) : 1;
      if(_pfs !== 1) document.documentElement.style.fontSize = (_pfs * 16) + 'px';

      window.print();
      window.addEventListener('afterprint',()=>{
        document.body.classList.remove('print-landscape','print-portrait');
        panel.style.zoom='';
        document.getElementById('printHeader').style.zoom='';
        document.documentElement.style.fontSize='';
        window._printMaxCols = null;
        render(0); // restore normal render
      },{once:true});
    });
  }

  // Main button → landscape; arrow → dropdown menu
  const menu=document.getElementById('printMenu');

  function showPrintMenu(){
    const btn=document.getElementById('printDrop');
    const r=btn.getBoundingClientRect();
    menu.style.top=(r.bottom+4)+'px';
    menu.style.left=Math.min(r.left,window.innerWidth-180)+'px';
    menu.style.display='block';
  }
  function hidePrintMenu(){ menu.style.display='none'; }

  document.getElementById('printLandBtn').addEventListener('click',()=>printAs('landscape'));
  document.getElementById('printDrop').addEventListener('click',e=>{
    e.stopPropagation();
    menu.style.display==='none'?showPrintMenu():hidePrintMenu();
  });
  document.getElementById('printLandOpt').addEventListener('click',()=>{ hidePrintMenu(); printAs('landscape'); });
  document.getElementById('printPortOpt').addEventListener('click',()=>{ hidePrintMenu(); printAs('portrait'); });
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

  async function shareAsPng(){
    const btn=document.getElementById('shareDrop');
    const origHTML=btn.innerHTML;
    btn.disabled=true;
    btn.innerHTML='<span>…</span>';
    try {
      await loadHtml2Canvas();
      const panel=document.getElementById('panelCur');
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

fetchEvents();

// Auto-refresh every 15 minutes (silent — no skeleton, calendar stays visible)
setInterval(() => fetchEvents(true), 15 * 60 * 1000);

// ── EVENT ANIMATION STYLE SWITCHER ───────────────────────
// Tap the period label (#pl) to cycle: Grow → Rise → Fade → Grow…
(()=>{
  const STYLES=[
    {key:'grow', anim:'evInGrow', dur:'.44s', ease:'cubic-bezier(0.34,1.56,0.64,1)', label:'Grow ✦'},
    {key:'rise', anim:'evInRise', dur:'.38s', ease:'cubic-bezier(0.22,1,0.36,1)',    label:'Rise ↑'},
    {key:'fade', anim:'evInFade', dur:'.30s', ease:'cubic-bezier(0.4,0,0.2,1)',      label:'Fade ◌'},
  ];
  let cur = +(localStorage.getItem('evAnimIdx')||0);
  function apply(){
    const s=STYLES[cur];
    const r=document.documentElement.style;
    r.setProperty('--ev-anim',s.anim);
    r.setProperty('--ev-dur', s.dur);
    r.setProperty('--ev-ease',s.ease);
  }
  apply();
  const pl=document.getElementById('pl');
  pl.style.cursor='pointer';
  pl.title='Tik om animatiestijl te wisselen';
  pl.addEventListener('click',()=>{
    cur=(cur+1)%STYLES.length;
    localStorage.setItem('evAnimIdx',cur);
    apply();
    render(0);
    showShareToast('Animatie: '+STYLES[cur].label);
  });
})();

// Logo tap = force reload with spin animation
document.querySelector('.logo').addEventListener('click', () => {
  const img = document.querySelector('.logo img');
  img.classList.add('logo-spin');
  img.addEventListener('animationend', () => img.classList.remove('logo-spin'), {once:true});
  fetchEvents();
});
