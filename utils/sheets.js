// ============================================================
//  utils/sheets.js  —  shared Google Sheets CSV helpers
// ============================================================

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
      continue;
    }

    if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((v) => String(v || '').trim()));
}

async function fetchSheetCsv(sheetId, tabIdentifier, byGid = false) {
  const base = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
  const param = byGid
    ? `&gid=${encodeURIComponent(tabIdentifier)}`
    : `&sheet=${encodeURIComponent(tabIdentifier)}`;
  const res = await fetch(base + param);
  if (!res.ok) throw new Error(`Sheet fetch failed (${res.status}): ${tabIdentifier}`);
  return parseCsv(await res.text());
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const TEAM_ALIAS_MAPPINGS_RAW = {
  'Air Force Falcons': ['AFA'],
  'Alabama Crimson Tide': ['Alabama'],
  'Appalachian State Mountaineers': ['App St'],
  'Arizona State Sun Devils': ['ASU'],
  'Arkansas Razorbacks': ['Arkansas'],
  'Arkansas State Red Wolves': ['Ark St'],
  'Army Black Knights': ['Army'],
  'Auburn Tigers': ['Auburn'],
  'Baylor Bears': ['Baylor'],
  'Boise State Broncos': ['BSU'],
  'Boston College Eagles': ['BC'],
  'Bowling Green Falcons': ['Bowling'],
  'Brigham Young Cougars': ['BYU'],
  'Buffalo Bulls': ['Buffalo'],
  'California Golden Bears': ['Cal'],
  'Central Florida Knights': ['UCF', 'Central Florida'],
  'Central Michigan Chippewas': ['CMU'],
  'Cincinnati Bearcats': ['Cinci'],
  'Clemson Tigers': ['Clemson'],
  'Coastal Carolina Chanticleers': ['CCU'],
  'Colorado State Rams': ['CSU'],
  'Delaware Fightin\' Blue Hens': ['Delaware'],
  'Duke Blue Devils': ['Duke'],
  'Florida Atlantic Owls': ['FAU'],
  'Florida Gators': ['Florida'],
  'Florida State Seminoles': ['FSU'],
  'Fresno State Bulldogs': ['Fresno'],
  'Georgia State Panthers': ['GaSt'],
  'Georgia Tech Yellow Jackets': ['GaTech'],
  'Grambling State Tigers': ['Grambling'],
  'Harvard Crimson': ['Harvard'],
  'Houston Cougars': ['Houston'],
  'Illinois Fighting Illini': ['Illinois'],
  'Indiana Hoosiers': ['Indiana'],
  'Iowa Hawkeyes': ['Iowa'],
  'Iowa State Cyclones': ['ISU'],
  'Jackson State Tigers': ['JSU'],
  'James Madison Dukes': ['JMU'],
  'Kansas Jayhawks': ['Kansas'],
  'Kansas State Wildcats': ['KSU'],
  'Kentucky Wildcats': ['Kentucky'],
  'LSU Tigers': ['LSU', 'Louisiana State'],
  'Louisiana Tech Bulldogs': ['LaTech'],
  'Louisville Cardinals': ['Louisville'],
  'Marshall Thundering Herd': ['Marshall'],
  'Maryland Terrapins': ['Maryland'],
  'Memphis Tigers': ['Memphis'],
  'Miami Hurricanes': ['Miami'],
  'Michigan State Spartans': ['MSU', 'MIST'],
  'Michigan Wolverines': ['Michigan'],
  'Minnesota Golden Gophers': ['Minn'],
  'Mississippi State Bulldogs': ['Miss St'],
  'Missouri Tigers': ['Missouri'],
  'NC State Wolfpack': ['NCST', 'NC State', 'North Carolina State'],
  'Navy Midshipmen': ['Navy'],
  'Nebraska Cornhuskers': ['Nebraska'],
  'Nevada Wolf Pack': ['Nevada'],
  'New Mexico Lobos': ['UNM'],
  'North Carolina Tar Heels': ['UNC'],
  'North Dakota State Bison': ['NDST'],
  'North Texas Mean Green': ['UNT'],
  'Northern Illinois Huskies': ['NoIll'],
  'Northwestern Wildcats': ['NWU', 'Northwestern'],
  'Notre Dame Fighting Irish': ['ND'],
  'Ohio Bobcats': ['Ohio'],
  'Ohio State Buckeyes': ['tOSU', 'Ohio State', 'OSU'],
  'Oklahoma Sooners': ['Oklahoma'],
  'Oklahoma State Cowboys': ['OKST'],
  'Ole Miss Rebels': ['Ole Miss'],
  'Oregon Ducks': ['Oregon'],
  'Oregon State Beavers': ['Oregon St'],
  'Penn State Nittany Lions': ['PSU', 'Penn State'],
  'Pittsburgh Panthers': ['Pitt'],
  'Princeton Tigers': ['Princeton'],
  'Purdue Boilermakers': ['Purdue'],
  'Rice Owls': ['Rice'],
  'Rutgers Scarlet Knights': ['Rutgers'],
  'SMU Mustangs': ['SMU', 'Southern Methodist'],
  'San Diego State Aztecs': ['SDSU'],
  'San Jose State Spartans': ['SJSU'],
  'South Carolina Gamecocks': ['SC'],
  'Southern Miss Golden Eagles': ['SoMiss'],
  'Stanford Cardinal': ['Stanford'],
  'Syracuse Orange': ['Syracuse'],
  'TCU Horned Frogs': ['TCU', 'Texas Christian'],
  'Tennessee Volunteers': ['Tenn'],
  'Texas A&M Aggies': ['TAMU'],
  'Texas Longhorns': ['Texas'],
  'Texas Tech Red Raiders': ['TTU'],
  'Toledo Rockets': ['Toledo'],
  'Troy Trojans': ['Troy'],
  'Tulane Green Wave': ['Tulane'],
  'Tulsa Golden Hurricane': ['Tulsa'],
  'UAB Blazers': ['UAB', 'Alabama-Birmingham'],
  'UCLA Bruins': ['UCLA'],
  'UNLV Rebels': ['UNLV'],
  'USC Trojans': ['USC'],
  'USF Bulls': ['USF'],
  'Utah State Aggies': ['USU'],
  'Utah Utes': ['Utah'],
  'UConn Huskies': ['Uconn'],
  'Vanderbilt Commodores': ['Vanderbilt'],
  'Virginia Cavaliers': ['Virginia'],
  'Virginia Tech Hokies': ['VaTech', 'Virginia Tech', 'VT', 'Virginia Polytechnic Institute and State University'],
  'Wake Forest Demon Deacons': ['Wake'],
  'Washington Huskies': ['Washington'],
  'Washington State Cougars': ['WSU'],
  'West Virginia Mountaineers': ['WVU'],
  'Western Michigan Broncos': ['WMU'],
  'Wisconsin Badgers': ['Wisconsin'],
  'Wyoming Cowboys': ['Wyoming'],
  'Yale Bulldogs': ['Yale'],
};

const TEAM_ALIAS_MAPPINGS = Object.fromEntries(
  Object.entries(TEAM_ALIAS_MAPPINGS_RAW).map(([fullName, aliases]) => [
    normalize(fullName),
    aliases,
  ])
);

// Build a set of normalized aliases for a Football-GM team object
function getTeamAliases(team) {
  const aliases = new Set();
  const abbrev = String(team?.abbrev || '').trim();
  const region = String(team?.region || '').trim();
  const name   = String(team?.name || '').trim();
  const full   = [region, name].filter(Boolean).join(' ').trim();

  [abbrev, region, name, full].filter(Boolean).forEach((a) => aliases.add(a));

  const mappedAliases = TEAM_ALIAS_MAPPINGS[normalize(full)];
  if (mappedAliases) {
    for (const alias of mappedAliases) {
      aliases.add(alias);
    }
  }

  // Collision-prone aliases can be stripped here when the source sheet
  // uses a disambiguated code. With the current H2H mapping, "OSU" belongs
  // to Ohio State and Oregon State comes through as "Oregon St", so we keep
  // the Ohio State alias intact.
  const aliasBlocklist = {};

  for (const [key, blocked] of Object.entries(aliasBlocklist)) {
    if (full === key) {
      [].concat(blocked).forEach((v) => aliases.delete(v));
    }
  }

  return new Set([...aliases].map(normalize).filter(Boolean));
}

function matchesTeam(cellValue, team) {
  const v = normalize(cellValue);
  if (!v) return false;
  return getTeamAliases(team).has(v);
}

function findMatchingTeam(leagueData, query) {
  if (!leagueData?.teams || !query) return null;
  for (const team of leagueData.teams) {
    if (team.disabled) continue;
    if (matchesTeam(query, team)) return team;
  }
  return null;
}

module.exports = {
  parseCsv,
  fetchSheetCsv,
  normalize,
  safeNum,
  getTeamAliases,
  matchesTeam,
  findMatchingTeam,
};
