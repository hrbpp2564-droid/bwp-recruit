const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb, initSchema, seed } = require('./db');
const apiRoutes = require('./routes/api');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const db = getDb();
initSchema(db);

const hasData = db.prepare('SELECT COUNT(*) as c FROM roles').get();
if (hasData.c === 0) {
  console.log('First run — seeding database...');
  seed(db);
}

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', apiRoutes(db));

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`\n  BWP Recruitment Management System`);
  console.log(`  ──────────────────────────────────`);
  console.log(`  Server:   http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Database: ${path.join(__dirname, 'bwp.db')}`);
  console.log(`  API:      http://localhost:${PORT}/api/init`);
  console.log(`  ──────────────────────────────────\n`);
});

process.on('SIGINT', () => { db.close(); process.exit(); });
process.on('SIGTERM', () => { db.close(); process.exit(); });
