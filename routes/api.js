const express = require('express');
const crypto = require('crypto');
const router = express.Router();

module.exports = function(db) {

  // ---------- Auth ----------
  function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
  }

  function generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  function getSessionUser(req) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return null;
    const session = db.prepare('SELECT s.*, u.username, u.role_id, u.display_name FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > ?').get(token, new Date().toISOString());
    return session || null;
  }

  router.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });

    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
    if (!user) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

    const hash = hashPassword(password, user.salt);
    if (hash !== user.password_hash) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

    const token = generateToken();
    const now = new Date();
    const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, user.id, now.toISOString(), expires.toISOString());

    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(user.role_id);
    res.json({ token, user: { id: user.id, username: user.username, role_id: user.role_id, display_name: user.display_name, role } });
  });

  router.get('/auth/me', (req, res) => {
    const session = getSessionUser(req);
    if (!session) return res.status(401).json({ error: 'ไม่ได้เข้าสู่ระบบ' });
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(session.role_id);
    res.json({ id: session.user_id, username: session.username, role_id: session.role_id, display_name: session.display_name, role });
  });

  router.post('/auth/logout', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.json({ ok: true });
  });

  router.post('/auth/change-password', (req, res) => {
    const session = getSessionUser(req);
    if (!session) return res.status(401).json({ error: 'ไม่ได้เข้าสู่ระบบ' });

    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
    if (new_password.length < 6) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
    const currentHash = hashPassword(current_password, user.salt);
    if (currentHash !== user.password_hash) return res.status(400).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });

    const newSalt = crypto.randomBytes(16).toString('hex');
    const newHash = hashPassword(new_password, newSalt);
    db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(newHash, newSalt, user.id);

    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, req.headers.authorization?.replace('Bearer ', ''));
    res.json({ ok: true });
  });

  // ---------- Roles & Permissions ----------
  router.get('/roles', (req, res) => {
    res.json(db.prepare('SELECT * FROM roles').all());
  });

  router.get('/permissions', (req, res) => {
    const rows = db.prepare('SELECT module, role_id FROM permissions').all();
    const perms = {};
    for (const r of rows) {
      if (!perms[r.module]) perms[r.module] = [];
      perms[r.module].push(r.role_id);
    }
    res.json(perms);
  });

  router.get('/perm-matrix', (req, res) => {
    const rows = db.prepare('SELECT module, role_id, level FROM perm_matrix').all();
    const modules = {};
    for (const r of rows) {
      if (!modules[r.module]) modules[r.module] = { module: r.module };
      modules[r.module][r.role_id] = r.level;
    }
    res.json(Object.values(modules));
  });

  router.patch('/perm-matrix', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role_id !== 'super_admin') return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
    const { module, role_id, level } = req.body;
    if (!module || !role_id || !level) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
    const valid = ['F','A','E','C','V','–'];
    if (!valid.includes(level)) return res.status(400).json({ error: 'ระดับสิทธิ์ไม่ถูกต้อง' });
    db.prepare('INSERT OR REPLACE INTO perm_matrix (module, role_id, level) VALUES (?, ?, ?)').run(module, role_id, level);
    res.json({ ok: true, module, role_id, level });
  });

  router.patch('/permissions', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role_id !== 'super_admin') return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
    const { module, role_id, granted } = req.body;
    if (!module || !role_id) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
    if (granted) {
      db.prepare('INSERT OR IGNORE INTO permissions (module, role_id) VALUES (?, ?)').run(module, role_id);
    } else {
      db.prepare('DELETE FROM permissions WHERE module = ? AND role_id = ?').run(module, role_id);
    }
    res.json({ ok: true });
  });

  // ---------- User Management ----------
  router.get('/users', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role_id !== 'super_admin') return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
    const users = db.prepare('SELECT u.id, u.username, u.role_id, u.display_name, u.active, u.created_at, r.name as role_name, r.th as role_th, r.color as role_color, r.initials as role_initials FROM users u JOIN roles r ON u.role_id = r.id ORDER BY u.id').all();
    res.json(users);
  });

  router.post('/users', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role_id !== 'super_admin') return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
    const { username, password, role_id, display_name } = req.body;
    if (!username || !password || !role_id || !display_name) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
    if (password.length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
    if (!/^[a-zA-Z0-9._]+$/.test(username)) return res.status(400).json({ error: 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีดล่าง' });
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return res.status(400).json({ error: 'ชื่อผู้ใช้นี้มีในระบบแล้ว' });
    const roleExists = db.prepare('SELECT id FROM roles WHERE id = ?').get(role_id);
    if (!roleExists) return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    const result = db.prepare('INSERT INTO users (username, password_hash, salt, role_id, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(username, hash, salt, role_id, display_name, new Date().toISOString());
    const user = db.prepare('SELECT u.id, u.username, u.role_id, u.display_name, u.active, u.created_at, r.name as role_name, r.th as role_th, r.color as role_color, r.initials as role_initials FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?').get(result.lastInsertRowid);
    res.status(201).json(user);
  });

  router.patch('/users/:id', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role_id !== 'super_admin') return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
    const { role_id, display_name, active } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    db.prepare('UPDATE users SET role_id = COALESCE(?, role_id), display_name = COALESCE(?, display_name), active = COALESCE(?, active) WHERE id = ?').run(role_id, display_name, active, req.params.id);
    const updated = db.prepare('SELECT u.id, u.username, u.role_id, u.display_name, u.active, u.created_at, r.name as role_name, r.th as role_th, r.color as role_color, r.initials as role_initials FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?').get(req.params.id);
    res.json(updated);
  });

  router.post('/users/:id/reset-password', (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role_id !== 'super_admin') return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(new_password, salt);
    db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, req.params.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---------- Company Config / Summary ----------
  router.get('/config', (req, res) => {
    const rows = db.prepare('SELECT key, value FROM company_config').all();
    const config = {};
    for (const r of rows) config[r.key] = r.value;
    res.json(config);
  });

  router.get('/summary', (req, res) => {
    const rows = db.prepare('SELECT key, value FROM company_config WHERE key NOT LIKE ?').all('exec.%');
    const summary = {};
    for (const r of rows) {
      if (!r.key.includes('.')) summary[r.key] = isNaN(r.value) ? r.value : Number(r.value);
    }
    res.json(summary);
  });

  router.get('/exec-kpi', (req, res) => {
    const rows = db.prepare("SELECT key, value FROM company_config WHERE key LIKE 'exec.%'").all();
    const kpi = {};
    for (const r of rows) {
      const parts = r.key.split('.');
      const metric = parts[1];
      const field = parts[2];
      if (!kpi[metric]) kpi[metric] = {};
      kpi[metric][field] = isNaN(r.value) ? r.value : Number(r.value);
    }
    res.json(kpi);
  });

  // ---------- Departments ----------
  router.get('/departments', (req, res) => {
    res.json(db.prepare('SELECT * FROM departments').all());
  });

  router.patch('/departments/:id', (req, res) => {
    const { plan, actual } = req.body;
    const stmt = db.prepare('UPDATE departments SET plan = COALESCE(?, plan), actual = COALESCE(?, actual) WHERE id = ?');
    stmt.run(plan, actual, req.params.id);
    res.json(db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id));
  });

  // ---------- Shifts ----------
  router.get('/shifts', (req, res) => {
    res.json(db.prepare('SELECT * FROM shifts').all());
  });

  // ---------- Pipeline Stages ----------
  router.get('/stages', (req, res) => {
    res.json(db.prepare('SELECT * FROM pipeline_stages ORDER BY sort_order').all());
  });

  // ---------- Candidates ----------
  router.get('/candidates', (req, res) => {
    const { dept, q, stage } = req.query;
    let sql = 'SELECT * FROM candidates WHERE 1=1';
    const params = [];
    if (dept && dept !== 'all') { sql += ' AND dept = ?'; params.push(dept); }
    if (stage) { sql += ' AND stage = ?'; params.push(stage); }
    if (q) { sql += ' AND (name LIKE ? OR pos LIKE ? OR skills LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    sql += ' ORDER BY match_score DESC';
    const rows = db.prepare(sql).all(...params);
    res.json(rows.map(r => ({ ...r, skills: JSON.parse(r.skills || '[]'), match: r.match_score })));
  });

  router.get('/candidates/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    c.skills = JSON.parse(c.skills || '[]');
    c.match = c.match_score;
    res.json(c);
  });

  router.patch('/candidates/:id', (req, res) => {
    const { stage, match_score, salary } = req.body;
    db.prepare('UPDATE candidates SET stage = COALESCE(?, stage), match_score = COALESCE(?, match_score), salary = COALESCE(?, salary) WHERE id = ?')
      .run(stage, match_score, salary, req.params.id);
    const c = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
    c.skills = JSON.parse(c.skills || '[]');
    c.match = c.match_score;
    res.json(c);
  });

  router.post('/candidates', (req, res) => {
    const { id, name, pos, dept, dept_name, exp, salary, prov, source, applied, stage, match_score, edu, skills } = req.body;
    db.prepare(`INSERT INTO candidates (id, name, pos, dept, dept_name, exp, salary, prov, source, applied, stage, match_score, edu, skills)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, pos, dept, dept_name, exp || 0, salary || 0, prov, source, applied, stage || 'applied', match_score || 0, edu, JSON.stringify(skills || []));
    res.status(201).json(db.prepare('SELECT * FROM candidates WHERE id = ?').get(id));
  });

  // ---------- Requisitions ----------
  router.get('/requisitions', (req, res) => {
    const { status } = req.query;
    let sql = 'SELECT * FROM requisitions';
    if (status && status !== 'all') {
      sql += ' WHERE status = ?';
      return res.json(db.prepare(sql).all(status));
    }
    res.json(db.prepare(sql).all());
  });

  router.patch('/requisitions/:id', (req, res) => {
    const { status } = req.body;
    db.prepare('UPDATE requisitions SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json(db.prepare('SELECT * FROM requisitions WHERE id = ?').get(req.params.id));
  });

  router.post('/requisitions', (req, res) => {
    const { id, pos, dept, count, type, reason, salary, urgency, start_date, status, created_by, created_at } = req.body;
    db.prepare(`INSERT INTO requisitions (id, pos, dept, count, type, reason, salary, urgency, start_date, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, pos, dept, count || 1, type, reason, salary, urgency || 'กลาง', start_date, status || 'draft', created_by, created_at);
    res.status(201).json(db.prepare('SELECT * FROM requisitions WHERE id = ?').get(id));
  });

  // ---------- Interviews ----------
  router.get('/interviews', (req, res) => {
    const rows = db.prepare('SELECT * FROM interviews ORDER BY date, time').all();
    res.json(rows.map(r => ({ ...r, panel: JSON.parse(r.panel || '[]') })));
  });

  router.patch('/interviews/:id', (req, res) => {
    const { status, score } = req.body;
    db.prepare('UPDATE interviews SET status = COALESCE(?, status), score = COALESCE(?, score) WHERE id = ?')
      .run(status, score, req.params.id);
    const iv = db.prepare('SELECT * FROM interviews WHERE id = ?').get(req.params.id);
    iv.panel = JSON.parse(iv.panel || '[]');
    res.json(iv);
  });

  router.post('/interviews', (req, res) => {
    const { id, cand_name, pos, type, date, time, panel, round, status } = req.body;
    db.prepare(`INSERT INTO interviews (id, cand_name, pos, type, date, time, panel, round, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, cand_name, pos, type || 'onsite', date, time, JSON.stringify(panel || []), round, status || 'scheduled');
    const iv = db.prepare('SELECT * FROM interviews WHERE id = ?').get(id);
    iv.panel = JSON.parse(iv.panel || '[]');
    res.status(201).json(iv);
  });

  router.post('/interviews/:id/scores', (req, res) => {
    const { scores } = req.body;
    const stmt = db.prepare('INSERT OR REPLACE INTO interview_scores (interview_id, criteria_id, score) VALUES (?, ?, ?)');
    const tx = db.transaction(() => {
      for (const [criteriaId, score] of Object.entries(scores)) {
        stmt.run(req.params.id, criteriaId, score);
      }
    });
    tx();
    const avg = db.prepare('SELECT AVG(score) as avg FROM interview_scores WHERE interview_id = ?').get(req.params.id);
    db.prepare('UPDATE interviews SET score = ?, status = ? WHERE id = ?').run(Math.round(avg.avg * 10) / 10, 'done', req.params.id);
    res.json({ average: avg.avg });
  });

  router.get('/interview-criteria', (req, res) => {
    res.json(db.prepare('SELECT * FROM interview_criteria ORDER BY sort_order').all());
  });

  // ---------- Offers ----------
  router.get('/offers', (req, res) => {
    res.json(db.prepare('SELECT * FROM offers').all());
  });

  router.patch('/offers/:id', (req, res) => {
    const { status } = req.body;
    db.prepare('UPDATE offers SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json(db.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id));
  });

  router.post('/offers', (req, res) => {
    const { id, cand_name, pos, base, position_allow, travel, attend, bonus, pf, status, created_at } = req.body;
    db.prepare(`INSERT INTO offers (id, cand_name, pos, base, position_allow, travel, attend, bonus, pf, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, cand_name, pos, base||0, position_allow||0, travel||0, attend||0, bonus, pf, status||'draft', created_at);
    res.status(201).json(db.prepare('SELECT * FROM offers WHERE id = ?').get(id));
  });

  // ---------- Onboarding ----------
  router.get('/onboarding', (req, res) => {
    res.json({
      persons: db.prepare('SELECT * FROM onboarding_persons').all(),
      tasks: db.prepare('SELECT * FROM onboarding_tasks').all(),
    });
  });

  router.patch('/onboarding/tasks/:id', (req, res) => {
    const task = db.prepare('SELECT * FROM onboarding_tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });
    const newDone = task.done ? 0 : 1;
    db.prepare('UPDATE onboarding_tasks SET done = ? WHERE id = ?').run(newDone, req.params.id);
    res.json({ ...task, done: newDone });
  });

  // ---------- Job Descriptions ----------
  router.get('/jds', (req, res) => {
    res.json(db.prepare('SELECT * FROM job_descriptions').all());
  });

  router.patch('/jds/:code', (req, res) => {
    const { status, rev } = req.body;
    db.prepare('UPDATE job_descriptions SET status = COALESCE(?, status), rev = COALESCE(?, rev) WHERE code = ?')
      .run(status, rev, req.params.code);
    res.json(db.prepare('SELECT * FROM job_descriptions WHERE code = ?').get(req.params.code));
  });

  router.post('/jds', (req, res) => {
    const { code, title, dept, reports_to, rev, date, status } = req.body;
    db.prepare(`INSERT INTO job_descriptions (code, title, dept, reports_to, rev, date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(code, title, dept, reports_to, rev || 'v1.0', date, status || 'draft');
    res.status(201).json(db.prepare('SELECT * FROM job_descriptions WHERE code = ?').get(code));
  });

  // ---------- Notifications ----------
  router.get('/notifications', (req, res) => {
    const rows = db.prepare('SELECT * FROM notifications ORDER BY id DESC').all();
    res.json(rows.map(r => ({ ...r, ch: JSON.parse(r.channels || '[]'), read: !!r.read })));
  });

  router.patch('/notifications/:id/read', (req, res) => {
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---------- AI Insights ----------
  router.get('/ai-insights', (req, res) => {
    res.json(db.prepare('SELECT * FROM ai_insights').all());
  });

  // ---------- Chart Data ----------
  router.get('/charts/headcount', (req, res) => {
    res.json(db.prepare('SELECT month as m, value as v FROM chart_headcount').all());
  });

  router.get('/charts/recruit', (req, res) => {
    res.json(db.prepare('SELECT month as m, open_count as open, hired_count as hired FROM chart_recruit').all());
  });

  router.get('/charts/hiring', (req, res) => {
    res.json(db.prepare('SELECT month as m, value as v FROM chart_hiring').all());
  });

  router.get('/charts/funnel', (req, res) => {
    res.json(db.prepare('SELECT stage, value as v, color FROM chart_funnel ORDER BY sort_order').all());
  });

  router.get('/charts/sources', (req, res) => {
    res.json(db.prepare('SELECT name, value as v, eff, color FROM chart_sources').all());
  });

  // ---------- Bulk data endpoint (loads everything for frontend) ----------
  router.get('/init', (req, res) => {
    const roles = db.prepare('SELECT * FROM roles').all();

    const permRows = db.prepare('SELECT module, role_id FROM permissions').all();
    const permissions = {};
    for (const r of permRows) {
      if (!permissions[r.module]) permissions[r.module] = [];
      permissions[r.module].push(r.role_id);
    }

    const matrixRows = db.prepare('SELECT module, role_id, level FROM perm_matrix').all();
    const permMatrix = {};
    for (const r of matrixRows) {
      if (!permMatrix[r.module]) permMatrix[r.module] = { module: r.module };
      permMatrix[r.module][r.role_id] = r.level;
    }

    const configRows = db.prepare('SELECT key, value FROM company_config').all();
    const config = {};
    for (const r of configRows) config[r.key] = r.value;

    const summary = {};
    const execKpi = {};
    for (const [k, v] of Object.entries(config)) {
      if (k.startsWith('exec.')) {
        const parts = k.split('.');
        if (!execKpi[parts[1]]) execKpi[parts[1]] = {};
        execKpi[parts[1]][parts[2]] = isNaN(v) ? v : Number(v);
      } else if (!k.includes('.') && k !== 'permLegend') {
        summary[k] = isNaN(v) ? v : Number(v);
      }
    }

    const candidates = db.prepare('SELECT * FROM candidates ORDER BY match_score DESC').all()
      .map(c => ({ ...c, skills: JSON.parse(c.skills || '[]'), match: c.match_score }));

    const interviews = db.prepare('SELECT * FROM interviews ORDER BY date, time').all()
      .map(i => ({ ...i, panel: JSON.parse(i.panel || '[]') }));

    const notifications = db.prepare('SELECT * FROM notifications ORDER BY id DESC').all()
      .map(n => ({ ...n, ch: JSON.parse(n.channels || '[]'), read: !!n.read }));

    const onboarding = {
      persons: db.prepare('SELECT * FROM onboarding_persons').all(),
      tasks: db.prepare('SELECT * FROM onboarding_tasks').all(),
    };

    res.json({
      roles,
      permissions,
      permMatrix: Object.values(permMatrix),
      permLegend: JSON.parse(config.permLegend || '{}'),
      departments: db.prepare('SELECT * FROM departments').all(),
      shifts: db.prepare('SELECT * FROM shifts').all(),
      summary,
      execKpi,
      stages: db.prepare('SELECT * FROM pipeline_stages ORDER BY sort_order').all(),
      candidates,
      requisitions: db.prepare('SELECT * FROM requisitions').all(),
      interviews,
      interviewCriteria: db.prepare('SELECT * FROM interview_criteria ORDER BY sort_order').all(),
      offers: db.prepare('SELECT * FROM offers').all(),
      onboarding: onboarding.persons,
      onboardTasks: onboarding.tasks,
      jds: db.prepare('SELECT * FROM job_descriptions').all(),
      notifications,
      aiInsights: db.prepare('SELECT * FROM ai_insights').all(),
      headcountTrend: db.prepare('SELECT month as m, value as v FROM chart_headcount').all(),
      recruitTrend: db.prepare('SELECT month as m, open_count as open, hired_count as hired FROM chart_recruit').all(),
      monthlyHiring: db.prepare('SELECT month as m, value as v FROM chart_hiring').all(),
      funnel: db.prepare('SELECT stage, value as v, color FROM chart_funnel ORDER BY sort_order').all(),
      sources: db.prepare('SELECT name, value as v, eff, color FROM chart_sources').all(),
      reqStatus: {
        draft:       { th:'ร่าง', color:'#7a8694', bg:'#eef1f5' },
        pending_hr:  { th:'รอ HR', color:'#d98a16', bg:'var(--amber-soft)' },
        pending_dir: { th:'รอกรรมการผู้จัดการ', color:'#6b4fd1', bg:'var(--violet-soft)' },
        approved:    { th:'อนุมัติแล้ว', color:'#1f9d63', bg:'var(--green-soft)' },
        rejected:    { th:'ไม่อนุมัติ', color:'#d6453d', bg:'var(--red-soft)' },
        closed:      { th:'ปิดงาน', color:'#2f6fd6', bg:'var(--accent-soft)' },
      },
      offerStatus: {
        draft:       { th:'ร่าง', color:'#7a8694', bg:'#eef1f5' },
        pending_dir: { th:'รออนุมัติ (MD)', color:'#6b4fd1', bg:'var(--violet-soft)' },
        sent:        { th:'ส่งให้ผู้สมัครแล้ว', color:'#d98a16', bg:'var(--amber-soft)' },
        accepted:    { th:'ตอบรับแล้ว', color:'#1f9d63', bg:'var(--green-soft)' },
        declined:    { th:'ปฏิเสธ', color:'#d6453d', bg:'var(--red-soft)' },
      },
    });
  });

  return router;
};
