<p align="center">
  <img src="docs/logo.png" alt="Overlap" width="220">
</p>

# Overlap

**All rosters, calendars and events in one clear overview.**

<table align="right" style="margin-left:24px;border:none">
  <tr><td align="center"><img src="docs/screen-week-desktop.png" alt="Week view — desktop" width="600"><br><sub>Week view — desktop</sub></td></tr>
  <tr><td align="center"><img src="docs/screen-week-tablet.png" alt="Week view — medium screen" width="400"><br><sub>Week view — medium screen (split layout)</sub></td></tr>
  <tr>
    <td align="center">
      <img src="docs/screen-week-mobile.png" alt="Week view — mobile" width="195">
      <img src="docs/screen-day.png" alt="Day view — desktop" width="380"><br>
      <sub>Mobile &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Day view</sub>
    </td>
  </tr>
</table>

Overlap is an open-source calendar viewer and management layer built for volunteer-driven organisations: neighbourhood centres, festivals, cultural venues, community initiatives and social projects. It pulls together multiple Google Calendars into a single, human-readable schedule — not as separate side-by-side agendas, but as one unified visual that shows at a glance who is working when, which activities are happening, where gaps exist, and where shifts or events overlap.

---

## Why Overlap?

Volunteer organisations run on people who make things happen together. A community centre, festival, cultural stage or social foundation typically deals with shifts, activities, meetings, absences, special appointments and last-minute changes — all scattered across multiple Google Calendars.

Overlap brings calm to that chaos.

A standard calendar shows events.
Overlap shows the organisation as a whole.

---

## What it shows

Any Google Calendar can be given a dedicated role. Typical layers include:

| Calendar | Example content |
|---|---|
| Volunteer roster | Who is on shift and when |
| Events | Public activities and performances |
| Kitchen / logistics | Prep sessions, setup and breakdown |
| Meetings | Internal coordination |
| Absences | Holidays, leave, unavailability |
| Appointments | External or one-off commitments |

Because all these layers appear together in a single view, the connections become immediately visible: a busy Sunday afternoon, a volunteer who is absent during a big event, an important appointment hidden in a crowded week — nothing disappears between the lines.

---

## Features

- **Multi-calendar overlay** — read multiple ICS feeds and render them as one visual schedule
- **Week view and day view** — responsive grid that adapts to desktop, tablet and phone
- **Hours overview** — compact worked-hours report per volunteer, with week/month/year totals and inline drill-downs for payment administration
- **Day-view week strip** — tap any day chip to navigate; selected day highlighted with a filled circle
- **Full-screen day view** — day view stretches edge-to-edge for maximum readability
- **Colour-coded crew** — each volunteer gets a personal colour; shifts are instantly recognisable
- **All-day event pills** — multi-day events span across the top of the grid
- **Important dates** — holidays, school vacations and custom date ranges shown as labels on calendar days, managed via the admin panel
- **ICS import for important dates** — upload an `.ics` file; consecutive same-named events are automatically collapsed into date ranges; category prefixes (`Schoolvakantie:`, `Nationale feestdag:` etc.) are stripped automatically
- **Always-show days** — configure which weekdays are always visible vs. hidden when empty
- **Week start** — choose Monday or Sunday as the first day of the week (persisted per-user in a cookie)
- **Print** — landscape or portrait A4 with a dedicated print stylesheet
- **Share as image** — export the current view as a shareable PNG
- **Copy link** — copy the current view URL to the clipboard
- **PWA** — installable on Android, iOS and desktop; "Install as app" button in the hamburger menu, including iPhone/iPad instructions
- **Auto-update detection** — the app polls for file changes every 10 minutes and on tab focus; when a new version is deployed a pulsing badge appears on the hamburger and a reload prompt inside the drawer
- **Auto-refresh** — configurable calendar refresh interval (5 / 15 / 30 / 60 min or off) stored per-user in a cookie; scheduled/manual refreshes force a fresh ICS fetch
- **Hamburger drawer** — always-visible slide-in menu containing Hours overview, Print, Share, Install, Settings (theme, week start, refresh interval) and version / author info
- **Theme system** — three built-in themes; add your own by dropping a CSS file in `app/`
- **Spring-curve event animations** — crew shifts pop in with an overshoot spring animation
- **No database** — the entire configuration lives in a single JavaScript file (`overlap-config.js`)

---

## Themes

Overlap ships with three themes, selectable in the Display admin page or the in-app settings drawer:

| Theme | Description |
|---|---|
| **Blockery** | Bold grid with thick black borders and large date numbers (default) |
| **Softy** | Rounded layout with circle day labels, no black borders, white header |
| **Nova** | Dark space aesthetic: navy/indigo header, pastel crew shifts with shimmer animation, white time column |

To add your own theme, create `app/mytheme.css` with selectors prefixed by `body.theme-mytheme {}`. It will appear automatically in the theme selector in the admin panel.

---

## Admin panel (`/manage`)

A PHP-based management interface lets you configure everything through a browser — no file editing required. The panel is mobile-friendly with a collapsible slide-in navigation drawer and uses the uploaded logo as its favicon.

| Page | What you can manage |
|---|---|
| **Dashboard** | Quick status overview |
| **Calendars** | ICS feed URLs with live test button |
| **Volunteers** | Crew names and colours |
| **Schedule** | Week start day, always-show days, important dates, ICS import |
| **Display** | Branding (name, logo, theme), font scales, filter keywords, visual theme |

Changes are written back to `overlap-config.js` immediately. The manifest (`overlap-manifest.json`) and PWA icons are regenerated automatically when branding is saved.

---

## Architecture

```
overlap/
├── index.php                   # Main calendar app (PHP shell — reads config for theme/branding)
├── app/
│   ├── overlap.js              # Calendar engine (rendering, ICS parsing, PWA)
│   ├── overlap.css             # Base calendar styles
│   ├── blockery.css            # Blockery theme marker (styles embedded in overlap.css)
│   ├── softy.css               # Softy theme marker (styles embedded in overlap.css)
│   ├── nova.css                # Nova dark theme — full standalone overrides
│   ├── overlap-config.js       # Live config (generated; do not edit by hand)
│   ├── overlap-manifest.json   # PWA manifest (auto-generated from branding)
│   ├── proxy.php               # Server-side ICS proxy and short cache
│   ├── icon-192.png            # PWA icon — overwritten on logo upload
│   └── icon-512.png            # PWA icon — overwritten on logo upload
├── manage/
│   ├── index.php               # Dashboard
│   ├── calendars.php           # Calendar URL management
│   ├── volunteers.php          # Crew management
│   ├── schedule.php            # Schedule settings + important dates + ICS import
│   ├── display.php             # Branding + display settings + logo upload
│   ├── api.php                 # AJAX endpoint (calendar test, etc.)
│   ├── _header.php             # Shared nav header (mobile-responsive drawer)
│   └── _footer.php             # Shared footer
├── lib/
│   ├── Config.php              # JS config reader/writer (no database needed)
│   └── CalendarDiagnostics.php # ICS fetch, parse and health-check
├── assets/
│   ├── css/admin.css           # Admin panel styles
│   └── js/admin.js             # Admin panel JS (crew sort, calendar test, toasts)
└── uploads/
    └── logo.png                # Uploaded logo (source for icon resizing)
```

---

## Setup

### Requirements

- PHP 8.0+ with GD extension (for logo resizing)
- A web server (Apache, Nginx, Plesk) with PHP enabled
- One or more public Google Calendar ICS URLs

### Installation

1. **Upload** all files to your web root or a subdirectory (e.g. `/overlap/`).

2. **Copy the example config:**
   ```bash
   cp app/overlap-config.example.js app/overlap-config.js
   ```

3. **Set write permissions** on the config and icon files so PHP can update them:
   ```bash
   chmod 664 app/overlap-config.js app/overlap-manifest.json app/icon-192.png app/icon-512.png
   chmod 775 uploads/
   ```
   On Plesk/SuExec, make sure the files are owned by the PHP user (e.g. `chown -R user:psacln`).

4. **Open `/manage/display.php`** in your browser and fill in your branding, then go through Calendars, Volunteers and Schedule.

5. **Open `index.php`** — your calendar is live.

### Proxy

All ICS feeds are fetched server-side through `app/proxy.php`, which:
- Caches responses briefly (60 seconds)
- Supports `refresh=1` for explicit/manual refreshes that bypass the local proxy cache
- Only allows URLs listed in the configuration (no open proxy)

---

## Configuration

The config file `app/overlap-config.js` is a plain JavaScript file with three sections:

```js
window.OVERLAP_CONFIG = {
  branding: {
    appName:        'My Organisation',
    appShortName:   'MyOrg',
    logoUrl:        'https://example.com/logo.png',
    themeColor:     '#1a3d2b',
    theme:          'blockery',   // blockery | softy | nova | or any app/*.css filename
    // ...
  },
  crew: [
    { name: 'Alice', color: '#52b788' },
    { name: 'Bob',   color: '#5a9fd4', bday: '15-03' },
    // ...
  ],
  defaults: {
    calendarUrl:          'https://calendar.google.com/calendar/ical/…',
    appointmentUrl:       'https://calendar.google.com/calendar/ical/…',
    mainEventCalendarUrl: 'https://calendar.google.com/calendar/ical/…',
    weekStartDay:         1,           // 0 = Sunday, 1 = Monday
    alwaysShowDays:       [0,1,3,4,5,6],
    importantDates: [
      { date: '2026-12-25', label: 'Christmas' },
      { date: '2026-07-01', endDate: '2026-08-31', label: 'Summer vacation' },
    ],
    filterKeywords:       ['regular day'],
    fontScale:            1,
    printFontScale:       2,
    timeZone:             'Europe/Amsterdam',
  }
};

// overlap.js reads ROOSTER_CONFIG internally — keep this alias
window.ROOSTER_CONFIG = window.OVERLAP_CONFIG;
```

An example file with all options and empty sensitive values is provided at `app/overlap-config.example.js`.

---

## Important dates and ICS import

The **Schedule** admin page lets you define holidays, school vacations and other notable dates that appear as labels on calendar day headers.

- Single day: just set a **From** date and a **Label**
- Date range: set both **From** and **Until**

You can also **import an `.ics` file** (e.g. a national holiday calendar or school vacation feed). The importer:
- Parses every `VEVENT` block
- Adjusts the exclusive `DTEND` to an inclusive end date
- **Automatically collapses consecutive same-named events into a single range** (e.g. 9 individual "Summer vacation" days become one row)
- Strips common category prefixes (`Schoolvakantie:`, `Nationale feestdag:` etc.) from event titles


## Hours overview

The hamburger menu contains **Urenoverzicht**. It shows only volunteers with worked hours and ignores future planning, so year totals reflect hours actually worked so far.

Counting rules:
- Shift titles can contain multiple names, e.g. `Zdeno/Dirk`; each listed volunteer receives the full shift duration.
- `name1` is treated as an alias for `name`; numbered real names such as `Dirk2` remain separate volunteers.
- Question marks and stray quote/backtick characters are ignored for name matching, e.g. `Zdeno?` and `` `zdeno`` match `Zdeno`.
- Titles containing `afwezig`, `vakantie` or `niet` are excluded from paid-hour totals.
- Future events are not counted; a currently running shift is counted only up to the current time.

Clicking a `per week`, `per maand` or `per jaar` total opens the breakdown inline below that volunteer. Year opens months, month opens weeks, week opens days, and a day opens the underlying shift rows.


---

## In-app settings (hamburger menu)

Clicking the hamburger icon opens a slide-in drawer available on all screen sizes. It contains:

| Section | Options |
|---|---|
| Update notice | Shown when a new version is detected; click to reload |
| Urenoverzicht | Worked-hours report per volunteer, per week/month/year, with inline details |
| Install | Install as PWA; on iPhone/iPad the button shows Safari Add to Home Screen instructions |
| Afdrukken | Landscape or portrait print |
| Delen | Share as image / copy link |
| Instellingen | Theme, week start day |
| Automatisch vernieuwen | 5 / 15 / 30 / 60 min or off — stored per-user in a cookie |
| Footer | App version, author link, manage link |

Theme and week-start changes trigger a page reload to apply. The refresh interval is applied instantly without reloading.

---

## PWA / installation

The app ships with a web manifest so it can be installed:

- **Android**: tap the browser menu → "Add to Home Screen" or use the "Installeer als app" button in the hamburger menu
- **iOS**: open the hamburger menu, tap "Installeer als app", then use Safari Share → "Add to Home Screen"
- **Desktop Chrome/Edge**: install button in the address bar or hamburger menu

The PWA icons (`icon-192.png` and `icon-512.png`) are automatically generated from the logo you upload in the Display settings — centre-cropped to square and resampled to the correct size.

---

## Auto-update detection

`index.php` exposes a lightweight `?overlap_upd=1` endpoint that returns the maximum modification timestamp of `index.php`, `overlap.js` and `overlap.css`. The app stores the timestamp from the initial page load and polls this endpoint every 10 minutes and whenever the browser tab regains focus. When the server timestamp is newer, a pulsing amber badge appears on the hamburger button and an animated "Update beschikbaar — herladen" button appears at the top of the drawer.

---

## Contributing

Pull requests and issues are welcome. The admin panel is deliberately kept framework-free (plain PHP + vanilla JS) to make it easy to host anywhere without a build step.

---

## Licence

MIT — free to use, modify and redistribute. Attribution appreciated but not required.
