// overlap-config.example.js
// Copy this file to overlap-config.js and fill in your own values.
// The admin panel (manage/) will keep this file up to date automatically.

window.OVERLAP_CONFIG = {

  // ── BRANDING ─────────────────────────────────────────────────────────────
  branding: {
    version:               '1.0',
    appName:               'My Organisation Schedule',
    appShortName:          'MyOrg',
    appDescription:        'Volunteer schedule for My Organisation',
    logoUrl:               '',                           // set via Display settings
    themeColor:            '#1a3d2b',
    foregroundColor:       '#f8f5ee',                    // text on theme-colored backgrounds
    accentColor:           '#52b788',                    // buttons, active tab, highlights
    defaultLocation:       'My Location',
    shareFilePrefix:       'myorg',
  },

  // ── CREW ─────────────────────────────────────────────────────────────────
  crew: [
    // { name: 'Alice',  color: '#52b788' },
    // { name: 'Bob',    color: '#5a9fd4', bday: '15-03' },
  ],

  // ── DEFAULTS & API KEYS ──────────────────────────────────────────────────
  defaults: {
    shiftDurationMinutes:          120,
    timeZone:                      'Europe/Amsterdam',

    // Google API credentials (optional — only needed for volunteer shift entry)
    googleClientId:                '',
    googleApiKey:                  '',
    googleCalendarId:              '',

    // ICS calendar feeds — set via Calendars settings
    calendarUrl:                   '',   // Main volunteer roster
    appointmentUrl:                '',   // Appointments / one-off events
    mainEventCalendarUrl:          '',   // Public events / activities

    // Keywords: events whose title starts with one of these are hidden
    filterKeywords:                [],

    // Display
    fontScale:                     1,
    printFontScale:                2,

    // Schedule settings — set via Schedule settings
    weekStartDay:                  1,    // 0 = Sunday, 1 = Monday
    alwaysShowDays:                [0, 1, 2, 3, 4, 5, 6],

    // Important dates shown as labels on calendar day headers
    // Managed via Schedule settings; can also be imported from an ICS file
    importantDates: [
      // { date: '2026-12-25', label: 'Christmas' },
      // { date: '2026-07-01', endDate: '2026-08-31', label: 'Summer vacation' },
    ],
  }
};

// overlap.js reads ROOSTER_CONFIG internally — keep this alias
window.ROOSTER_CONFIG = window.OVERLAP_CONFIG;
