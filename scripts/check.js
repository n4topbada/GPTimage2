const Database = require('better-sqlite3');
const db = new Database('C:/Users/김바다/.ima2/sessions.db');
const row = db.prepare("SELECT * FROM history WHERE filename = '1779976905110_c7dbf989_0.png'").get();
console.log(row);
