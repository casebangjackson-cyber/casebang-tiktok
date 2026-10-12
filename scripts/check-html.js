'use strict';
const fs = require('fs');
const h = fs.readFileSync('index.html', 'utf8');
const ids = [...h.matchAll(/id="(view\w+)"/g)].map((m) => m[1]);
console.log('viewIds', ids, 'unique', new Set(ids).size === ids.length);
console.log(
  'navOrder',
  h.indexOf('navDashboard') < h.indexOf('navCampaign') &&
    h.indexOf('navCampaign') < h.indexOf('navLogs') &&
    h.indexOf('navLogs') < h.indexOf('navStatus')
);
console.log('dashActive', h.includes('class="view active" id="viewDashboard"'));
console.log('statusHidden', h.includes('id="viewStatus" data-view="status" hidden'));
console.log('stTiktok count', (h.match(/id="stTiktok"/g) || []).length);
console.log('dashTableBody count', (h.match(/id="dashTableBody"/g) || []).length);
console.log('statusNavLast', h.indexOf('navStatus') > h.indexOf('navLogs'));
