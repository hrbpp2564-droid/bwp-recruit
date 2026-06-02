const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'bwp.db');

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      th TEXT NOT NULL,
      color TEXT,
      initials TEXT,
      person TEXT
    );

    CREATE TABLE IF NOT EXISTS permissions (
      module TEXT NOT NULL,
      role_id TEXT NOT NULL REFERENCES roles(id),
      PRIMARY KEY (module, role_id)
    );

    CREATE TABLE IF NOT EXISTS perm_matrix (
      module TEXT NOT NULL,
      role_id TEXT NOT NULL REFERENCES roles(id),
      level TEXT NOT NULL DEFAULT '–',
      PRIMARY KEY (module, role_id)
    );

    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      en TEXT,
      plan INTEGER DEFAULT 0,
      actual INTEGER DEFAULT 0,
      type TEXT DEFAULT 'factory',
      color TEXT
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      time TEXT,
      plan INTEGER DEFAULT 0,
      actual INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS company_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pos TEXT,
      dept TEXT REFERENCES departments(id),
      dept_name TEXT,
      exp INTEGER DEFAULT 0,
      salary INTEGER DEFAULT 0,
      prov TEXT,
      source TEXT,
      applied TEXT,
      stage TEXT DEFAULT 'applied',
      match_score INTEGER DEFAULT 0,
      edu TEXT,
      skills TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS requisitions (
      id TEXT PRIMARY KEY,
      pos TEXT NOT NULL,
      dept TEXT,
      count INTEGER DEFAULT 1,
      type TEXT,
      reason TEXT,
      salary TEXT,
      urgency TEXT DEFAULT 'กลาง',
      start_date TEXT,
      status TEXT DEFAULT 'draft',
      created_by TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS interviews (
      id TEXT PRIMARY KEY,
      cand_name TEXT NOT NULL,
      pos TEXT,
      type TEXT DEFAULT 'onsite',
      date TEXT,
      time TEXT,
      panel TEXT DEFAULT '[]',
      round TEXT,
      status TEXT DEFAULT 'scheduled',
      score REAL
    );

    CREATE TABLE IF NOT EXISTS interview_criteria (
      id TEXT PRIMARY KEY,
      th TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS interview_scores (
      interview_id TEXT NOT NULL REFERENCES interviews(id),
      criteria_id TEXT NOT NULL REFERENCES interview_criteria(id),
      score INTEGER DEFAULT 0,
      PRIMARY KEY (interview_id, criteria_id)
    );

    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY,
      cand_name TEXT NOT NULL,
      pos TEXT,
      base INTEGER DEFAULT 0,
      position_allow INTEGER DEFAULT 0,
      travel INTEGER DEFAULT 0,
      attend INTEGER DEFAULT 0,
      bonus TEXT,
      pf TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS onboarding_persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      pos TEXT,
      start_date TEXT,
      done INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS onboarding_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      th TEXT NOT NULL,
      grp TEXT,
      done INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS job_descriptions (
      code TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      dept TEXT,
      reports_to TEXT,
      rev TEXT,
      date TEXT,
      status TEXT DEFAULT 'draft'
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      icon TEXT,
      th TEXT NOT NULL,
      who TEXT,
      time TEXT,
      channels TEXT DEFAULT '[]',
      read INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ai_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      icon TEXT,
      title TEXT NOT NULL,
      body TEXT,
      tone TEXT DEFAULT 'accent'
    );

    CREATE TABLE IF NOT EXISTS chart_headcount (
      month TEXT PRIMARY KEY,
      value INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chart_recruit (
      month TEXT PRIMARY KEY,
      open_count INTEGER DEFAULT 0,
      hired_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chart_hiring (
      month TEXT PRIMARY KEY,
      value INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chart_funnel (
      stage TEXT PRIMARY KEY,
      value INTEGER DEFAULT 0,
      color TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chart_sources (
      name TEXT PRIMARY KEY,
      value INTEGER DEFAULT 0,
      eff INTEGER DEFAULT 0,
      color TEXT
    );

    CREATE TABLE IF NOT EXISTS pipeline_stages (
      id TEXT PRIMARY KEY,
      th TEXT NOT NULL,
      color TEXT,
      sort_order INTEGER DEFAULT 0
    );
  `);
}

function seed(db) {
  const ins = (table, cols, rows) => {
    const placeholders = cols.map(() => '?').join(',');
    const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`);
    const tx = db.transaction((data) => { for (const r of data) stmt.run(...r); });
    tx(rows);
  };

  // Roles
  ins('roles', ['id','name','th','color','initials','person'], [
    ['super_admin','Super Admin','ผู้ดูแลระบบสูงสุด','#6b4fd1','SA','ก. ระบบาธิป'],
    ['hr_manager','HR Manager','ผู้จัดการฝ่ายบุคคล','#2f6fd6','HM','สุนิสา ภักดีงาม'],
    ['hr_officer','HR Officer','เจ้าหน้าที่สรรหา','#128a9c','HO','พิมพ์ชนก ศรีสุข'],
    ['dept_manager','Department Manager','ผู้จัดการแผนก','#1f9d63','DM','ธนกฤต วงศ์ไพบูลย์'],
    ['interviewer','Interviewer','ผู้สัมภาษณ์','#d98a16','IV','อนุชา เรืองศักดิ์'],
    ['md','Managing Director','กรรมการผู้จัดการ','#0f2747','MD','วิเชียร บุญประเสริฐ'],
  ]);

  // Permissions
  const perms = {
    dashboard:['super_admin','hr_manager','hr_officer','dept_manager','interviewer','md'],
    manpower:['super_admin','hr_manager','hr_officer','dept_manager','md'],
    requisition:['super_admin','hr_manager','hr_officer','dept_manager','md'],
    jd:['super_admin','hr_manager','hr_officer','dept_manager'],
    pipeline:['super_admin','hr_manager','hr_officer','dept_manager'],
    candidates:['super_admin','hr_manager','hr_officer'],
    interview:['super_admin','hr_manager','hr_officer','dept_manager','interviewer'],
    offer:['super_admin','hr_manager','md'],
    onboarding:['super_admin','hr_manager','hr_officer'],
    exec:['super_admin','hr_manager','md'],
    reports:['super_admin','hr_manager','hr_officer','md'],
    notifications:['super_admin','hr_manager','hr_officer'],
    ai:['super_admin','hr_manager','hr_officer','md'],
    settings:['super_admin'],
  };
  const permRows = [];
  for (const [mod, roles] of Object.entries(perms)) {
    for (const r of roles) permRows.push([mod, r]);
  }
  ins('permissions', ['module','role_id'], permRows);

  // Permission matrix
  const matrix = [
    ['Manpower Planning',    'F','F','E','V','–','V'],
    ['Requisition',          'F','A','E','C','–','A'],
    ['Job Description',      'F','F','E','C','–','V'],
    ['Pipeline',             'F','F','E','V','–','V'],
    ['Candidate DB',         'F','F','E','–','–','–'],
    ['Interview',            'F','F','E','V','E','V'],
    ['Offer',                'F','E','V','–','–','A'],
    ['Onboarding',           'F','F','E','V','–','–'],
    ['Executive Dashboard',  'F','V','–','–','–','F'],
    ['Reports',              'F','E','E','–','–','V'],
    ['Settings / RBAC',      'F','–','–','–','–','–'],
  ];
  const roleIds = ['super_admin','hr_manager','hr_officer','dept_manager','interviewer','md'];
  const matrixRows = [];
  for (const row of matrix) {
    const mod = row[0];
    for (let i = 0; i < 6; i++) matrixRows.push([mod, roleIds[i], row[i+1]]);
  }
  ins('perm_matrix', ['module','role_id','level'], matrixRows);

  // Departments
  ins('departments', ['id','name','en','plan','actual','type','color'], [
    ['prod','ฝ่ายผลิต','Production',182,171,'factory','#2f6fd6'],
    ['qc','ประกันคุณภาพ','QA / QC',34,30,'factory','#128a9c'],
    ['wh','คลังสินค้า','Warehouse',48,44,'factory','#1f9d63'],
    ['maint','ซ่อมบำรุง','Maintenance',26,21,'factory','#d98a16'],
    ['eng','วิศวกรรม','Engineering',18,16,'factory','#6b4fd1'],
    ['sales','ฝ่ายขาย','Sales',22,20,'office','#d6453d'],
    ['hr','ทรัพยากรบุคคล','HR',11,10,'office','#2a5288'],
    ['acc','บัญชีการเงิน','Accounting',14,14,'office','#7a8694'],
  ]);

  // Shifts
  ins('shifts', ['id','name','time','plan','actual'], [
    ['A','กะเช้า (A)','07:00–15:00',64,61],
    ['B','กะบ่าย (B)','15:00–23:00',60,55],
    ['C','กะดึก (C)','23:00–07:00',58,55],
  ]);

  // Company config
  const config = {
    totalEmployees:'326', planEmployees:'355', factory:'282', office:'58',
    vacancyRate:'8.2', turnoverRate:'1.7', openPositions:'14', newHiresMonth:'9',
    candidatesActive:'168', interviewsWeek:'11', offersOut:'4', probationCount:'17',
    'exec.timeToHire.value':'32','exec.timeToHire.unit':'วัน','exec.timeToHire.trend':'-4','exec.timeToHire.target':'35',
    'exec.timeToFill.value':'41','exec.timeToFill.unit':'วัน','exec.timeToFill.trend':'-2','exec.timeToFill.target':'45',
    'exec.costPerHire.value':'18400','exec.costPerHire.unit':'฿','exec.costPerHire.trend':'1200','exec.costPerHire.target':'20000',
    'exec.offerAccept.value':'86','exec.offerAccept.unit':'%','exec.offerAccept.trend':'3','exec.offerAccept.target':'85',
    'exec.probationTurnover.value':'11','exec.probationTurnover.unit':'%','exec.probationTurnover.trend':'-2','exec.probationTurnover.target':'12',
    'exec.sourceEffectiveness.value':'64','exec.sourceEffectiveness.unit':'%','exec.sourceEffectiveness.trend':'5','exec.sourceEffectiveness.target':'60',
    'permLegend': JSON.stringify({F:'เต็มสิทธิ์',A:'อนุมัติ',E:'แก้ไข',C:'สร้าง',V:'ดูอย่างเดียว','–':'ไม่มีสิทธิ์'}),
  };
  ins('company_config', ['key','value'], Object.entries(config));

  // Pipeline stages
  ins('pipeline_stages', ['id','th','color','sort_order'], [
    ['applied','ผู้สมัครใหม่','#2a5288',0],
    ['screening','คัดกรอง','#2f6fd6',1],
    ['phone','สัมภาษณ์ทางโทรศัพท์','#128a9c',2],
    ['interview1','สัมภาษณ์ครั้งที่ 1','#1f9d63',3],
    ['interview2','สัมภาษณ์ครั้งที่ 2','#7a9c1f',4],
    ['mgmt','สัมภาษณ์ผู้บริหาร','#d98a16',5],
    ['offer','เสนอ Offer','#d6453d',6],
    ['hired','รับเข้าทำงาน','#0f2747',7],
  ]);

  // Candidates
  ins('candidates', ['id','name','pos','dept','dept_name','exp','salary','prov','source','applied','stage','match_score','edu','skills'], [
    ['C-1042','ณัฐพล สุวรรณชาติ','หัวหน้ากะฝ่ายผลิต','prod','ฝ่ายผลิต',8,36000,'ระยอง','แนะนำพนักงาน','26 พ.ค.','mgmt',91,'ปวส. เทคนิคการผลิต','["Extrusion","Lean","ควบคุมกะ","TPM"]'],
    ['C-1041','กมลชนก ทองเปลว','วิศวกรกระบวนการผลิต','eng','วิศวกรรม',5,42000,'ชลบุรี','JobThai','25 พ.ค.','interview2',88,'วศ.บ. อุตสาหการ','["Process","Six Sigma","AutoCAD","Minitab"]'],
    ['C-1040','ธีรเดช คำแก้ว','ช่างซ่อมบำรุง','maint','ซ่อมบำรุง',6,22000,'ระยอง','Walk-in','25 พ.ค.','interview1',79,'ปวส. ไฟฟ้ากำลัง','["PLC","ไฟฟ้า","นิวเมติกส์","ซ่อมเครื่องจักร"]'],
    ['C-1039','ศุภวิชญ์ บุญมาก','QC Inline','qc','ประกันคุณภาพ',3,18000,'ระยอง','JobThai','24 พ.ค.','interview1',84,'ปวส. เคมีอุตสาหกรรม','["QC","ISO9001","วัดความหนาฟิล์ม"]'],
    ['C-1038','พรนภา จันทร์เพ็ญ','เจ้าหน้าที่ความปลอดภัย','eng','วิศวกรรม',4,24000,'กรุงเทพฯ','LinkedIn','24 พ.ค.','phone',76,'วท.บ. อาชีวอนามัย','["จป.วิชาชีพ","ISO45001","ประเมินความเสี่ยง"]'],
    ['C-1037','อรรถพล มีสุข','ผู้ควบคุมเครื่องอัดฟิล์ม','prod','ฝ่ายผลิต',2,15500,'ระยอง','จัดหางานจังหวัด','23 พ.ค.','screening',72,'ม.6','["เดินเครื่อง","งานกะ"]'],
    ['C-1036','วรรณวิสา เกตุแก้ว','เจ้าหน้าที่บัญชีต้นทุน','acc','บัญชีการเงิน',5,25000,'ชลบุรี','JobThai','23 พ.ค.','interview1',81,'บช.บ.','["ต้นทุนการผลิต","Express","SAP B1"]'],
    ['C-1035','ปิยะวัฒน์ ชูเกียรติ','พนักงานขายโครงการ','sales','ฝ่ายขาย',7,30000,'กรุงเทพฯ','แนะนำพนักงาน','22 พ.ค.','offer',87,'บธ.บ. การตลาด','["B2B Sales","บรรจุภัณฑ์","เจรจาต่อรอง"]'],
    ['C-1034','จิราพร แสงสว่าง','พนักงานคลังสินค้า','wh','คลังสินค้า',3,14500,'ระยอง','Walk-in','22 พ.ค.','screening',69,'ปวช.','["WMS","Forklift","จัดเก็บ"]'],
    ['C-1033','เอกราช พัฒนสิน','วิศวกรกระบวนการผลิต','eng','วิศวกรรม',9,48000,'ระยอง','LinkedIn','21 พ.ค.','hired',93,'วศ.ม. อุตสาหการ','["Process","Automation","Project","Lean"]'],
    ['C-1032','สิริมา ทรัพย์เจริญ','QC Inline','qc','ประกันคุณภาพ',1,16000,'ระยอง','JobThai','21 พ.ค.','applied',65,'ปวส. วิทยาศาสตร์','["QC พื้นฐาน","ตรวจสอบ"]'],
    ['C-1031','กฤษฎา รุ่งเรือง','หัวหน้ากะฝ่ายผลิต','prod','ฝ่ายผลิต',6,34000,'ชลบุรี','แนะนำพนักงาน','20 พ.ค.','applied',77,'ปวส. การผลิต','["ควบคุมกะ","5ส","ความปลอดภัย"]'],
    ['C-1030','ภัทรวดี นิลกาฬ','พนักงานขายโครงการ','sales','ฝ่ายขาย',4,27000,'กรุงเทพฯ','JobThai','19 พ.ค.','phone',74,'บธ.บ.','["Sales","CRM","นำเสนอ"]'],
  ]);

  // Requisitions
  ins('requisitions', ['id','pos','dept','count','type','reason','salary','urgency','start_date','status','created_by','created_at'], [
    ['REQ-2406-014','หัวหน้ากะฝ่ายผลิต (Extrusion)','ฝ่ายผลิต',1,'ประจำ','ทดแทน','32,000–38,000','สูง','15 มิ.ย. 69','pending_dir','ธนกฤต วงศ์ไพบูลย์','28 พ.ค. 69'],
    ['REQ-2406-013','วิศวกรกระบวนการผลิต','วิศวกรรม',1,'ประจำ','ขยายกำลังคน','35,000–45,000','กลาง','1 ก.ค. 69','pending_hr','ธนกฤต วงศ์ไพบูลย์','27 พ.ค. 69'],
    ['REQ-2406-012','เจ้าหน้าที่ควบคุมคุณภาพ (QC Inline)','ประกันคุณภาพ',2,'ประจำ','ทดแทน','16,000–20,000','สูง','10 มิ.ย. 69','approved','สมหญิง ทองดี','24 พ.ค. 69'],
    ['REQ-2406-011','พนักงานคลังสินค้า','คลังสินค้า',3,'รายวัน','ขยายกำลังคน','380/วัน','กลาง','5 มิ.ย. 69','approved','ประยุทธ์ คงเดช','22 พ.ค. 69'],
    ['REQ-2406-010','ช่างซ่อมบำรุงเครื่องจักร','ซ่อมบำรุง',2,'ประจำ','ทดแทน','18,000–24,000','สูง','8 มิ.ย. 69','pending_dir','วิรัตน์ แสงทอง','21 พ.ค. 69'],
    ['REQ-2406-009','พนักงานขายโครงการ (Industrial)','ฝ่ายขาย',1,'ประจำ','โครงการใหม่','25,000–32,000+คอมฯ','กลาง','1 ก.ค. 69','draft','กิตติพงษ์ ใจดี','20 พ.ค. 69'],
    ['REQ-2405-008','เจ้าหน้าที่บัญชีต้นทุน','บัญชีการเงิน',1,'ประจำ','ทดแทน','20,000–26,000','ต่ำ','15 มิ.ย. 69','rejected','นภัสสร พงษ์ศรี','15 พ.ค. 69'],
    ['REQ-2405-007','ผู้ควบคุมเครื่องอัดฟิล์ม (Operator)','ฝ่ายผลิต',4,'ประจำ','ขยายกำลังคน','14,000–17,000','สูง','1 มิ.ย. 69','closed','ธนกฤต วงศ์ไพบูลย์','10 พ.ค. 69'],
  ]);

  // Interviews
  ins('interviews', ['id','cand_name','pos','type','date','time','panel','round','status','score'], [
    ['IV-301','ณัฐพล สุวรรณชาติ','หัวหน้ากะฝ่ายผลิต','onsite','3 มิ.ย. 69','10:00','["อนุชา เรืองศักดิ์","ธนกฤต วงศ์ไพบูลย์"]','สัมภาษณ์ผู้บริหาร','scheduled',null],
    ['IV-300','กมลชนก ทองเปลว','วิศวกรกระบวนการผลิต','online','3 มิ.ย. 69','13:30','["อนุชา เรืองศักดิ์"]','สัมภาษณ์ครั้งที่ 2','scheduled',null],
    ['IV-299','ธีรเดช คำแก้ว','ช่างซ่อมบำรุง','onsite','2 มิ.ย. 69','09:30','["วิรัตน์ แสงทอง"]','สัมภาษณ์ครั้งที่ 1','done',4.1],
    ['IV-298','ศุภวิชญ์ บุญมาก','QC Inline','onsite','2 มิ.ย. 69','11:00','["สมหญิง ทองดี"]','สัมภาษณ์ครั้งที่ 1','done',3.8],
    ['IV-297','วรรณวิสา เกตุแก้ว','บัญชีต้นทุน','online','4 มิ.ย. 69','14:00','["นภัสสร พงษ์ศรี"]','สัมภาษณ์ครั้งที่ 1','scheduled',null],
  ]);

  // Interview criteria
  ins('interview_criteria', ['id','th','sort_order'], [
    ['tech','ทักษะเฉพาะตำแหน่ง (Technical)',0],
    ['exp','ประสบการณ์ (Experience)',1],
    ['person','บุคลิกภาพ / ทัศนคติ (Personality)',2],
    ['lead','ภาวะผู้นำ (Leadership)',3],
    ['comm','การสื่อสาร (Communication)',4],
    ['problem','การแก้ปัญหา (Problem Solving)',5],
  ]);

  // Offers
  ins('offers', ['id','cand_name','pos','base','position_allow','travel','attend','bonus','pf','status','created_at'], [
    ['OF-118','ปิยะวัฒน์ ชูเกียรติ','พนักงานขายโครงการ',30000,3000,2500,800,'2 เดือน/ปี','5%','sent','30 พ.ค. 69'],
    ['OF-117','เอกราช พัฒนสิน','วิศวกรกระบวนการผลิต',48000,5000,0,0,'2.5 เดือน/ปี','7%','accepted','24 พ.ค. 69'],
    ['OF-116','ณัฐพล สุวรรณชาติ','หัวหน้ากะฝ่ายผลิต',36000,4000,1500,1000,'2 เดือน/ปี','5%','pending_dir','1 มิ.ย. 69'],
  ]);

  // Onboarding persons
  ins('onboarding_persons', ['id','name','pos','start_date','done','total'], [
    [1,'เอกราช พัฒนสิน','วิศวกรกระบวนการผลิต','10 มิ.ย. 69',6,8],
    [2,'สมชาย ภักดี','ผู้ควบคุมเครื่องอัดฟิล์ม','5 มิ.ย. 69',4,8],
    [3,'ปวีณา ดอกไม้','QC Inline','3 มิ.ย. 69',8,8],
  ]);

  // Onboarding tasks
  ins('onboarding_tasks', ['id','th','grp','done'], [
    [1,'จัดเก็บเอกสารพนักงาน (สำเนาบัตร/ทะเบียนบ้าน/วุฒิ)','เอกสาร',1],
    [2,'ตรวจสุขภาพก่อนเริ่มงาน','เอกสาร',1],
    [3,'จัดเตรียมชุดยูนิฟอร์ม + รองเท้าเซฟตี้','อุปกรณ์',1],
    [4,'ทำบัตรพนักงาน + คีย์การ์ดเข้าโรงงาน','อุปกรณ์',1],
    [5,'สร้าง Email บริษัท','ระบบ',1],
    [6,'สร้าง User Account (ERP / HRIS)','ระบบ',1],
    [7,'อบรมความปลอดภัยในการทำงาน (Safety Induction)','อบรม',0],
    [8,'ปฐมนิเทศพนักงานใหม่ (Orientation)','อบรม',0],
  ]);

  // Job Descriptions
  ins('job_descriptions', ['code','title','dept','reports_to','rev','date','status'], [
    ['JD-PR-001','หัวหน้ากะฝ่ายผลิต','ฝ่ายผลิต','ผู้จัดการฝ่ายผลิต','v3.2','12 ก.พ. 69','approved'],
    ['JD-EN-004','วิศวกรกระบวนการผลิต','วิศวกรรม','ผู้จัดการวิศวกรรม','v2.0','5 ม.ค. 69','approved'],
    ['JD-QC-002','เจ้าหน้าที่ควบคุมคุณภาพ','ประกันคุณภาพ','หัวหน้าแผนก QA','v1.4','20 มี.ค. 69','review'],
    ['JD-MT-003','ช่างซ่อมบำรุงเครื่องจักร','ซ่อมบำรุง','หัวหน้าซ่อมบำรุง','v2.1','8 เม.ย. 69','approved'],
    ['JD-WH-001','พนักงานคลังสินค้า','คลังสินค้า','หัวหน้าคลังสินค้า','v1.0','15 พ.ค. 69','draft'],
    ['JD-SL-002','พนักงานขายโครงการ','ฝ่ายขาย','ผู้จัดการฝ่ายขาย','v1.2','2 พ.ค. 69','approved'],
  ]);

  // Notifications
  ins('notifications', ['id','type','icon','th','who','time','channels','read'], [
    [1,'approve','check','อนุมัติเปิดอัตรา REQ-2406-012 (QC Inline ×2)','กรรมการผู้จัดการ','5 นาทีที่แล้ว','["line","email"]',0],
    [2,'interview','calendar','นัดสัมภาษณ์ ณัฐพล สุวรรณชาติ — 3 มิ.ย. 10:00 (Onsite)','ระบบ','1 ชม.ที่แล้ว','["line","email"]',0],
    [3,'offer','mail','ส่ง Offer ปิยะวัฒน์ ชูเกียรติ เรียบร้อย','สุนิสา ภักดีงาม','3 ชม.ที่แล้ว','["email"]',1],
    [4,'result','star','ผลสัมภาษณ์ ธีรเดช คำแก้ว — คะแนนเฉลี่ย 4.1/5','วิรัตน์ แสงทอง','เมื่อวาน','["line"]',1],
    [5,'warn','alert','เอกสารขาด: เอกราช พัฒนสิน ยังไม่ส่งผลตรวจสุขภาพ','ระบบ Onboarding','เมื่อวาน','["line","email"]',1],
  ]);

  // AI Insights
  ins('ai_insights', ['id','icon','title','body','tone'], [
    [1,'search','ตำแหน่งที่หายาก','“ช่างซ่อมบำรุง (PLC)” และ “วิศวกรกระบวนการ” มีเวลาเฉลี่ยในการสรรหา 52 วัน สูงกว่าค่าเฉลี่ย 27% — แนะนำเพิ่มช่องทาง Agency เฉพาะทาง','amber'],
    [2,'x','สาเหตุปฏิเสธ Offer','38% ของผู้ปฏิเสธ Offer ระบุเรื่อง “ระยะทาง/ที่พัก” — พิจารณาเพิ่มสวัสดิการรถรับส่งสำหรับสายการผลิต','red'],
    [3,'trend','แนวโน้มลาออกช่วงทดลองงาน','กลุ่มพนักงานรายวันฝ่ายผลิตมีอัตราออกช่วงทดลองงาน 18% — ปัจจัยหลักคือความเข้าใจงานกะ แนะนำเสริม Buddy Program','violet'],
    [4,'check','ประสิทธิภาพช่องทางสรรหา','“แนะนำพนักงาน” ให้ Quality of Hire สูงสุด (81%) และต้นทุนต่ำสุด — ควรผลักดันโครงการ Referral เพิ่ม','green'],
  ]);

  // Chart data
  ins('chart_headcount', ['month','value'], [
    ['ก.ค.',308],['ส.ค.',312],['ก.ย.',315],['ต.ค.',319],['พ.ย.',321],['ธ.ค.',318],
    ['ม.ค.',322],['ก.พ.',325],['มี.ค.',324],['เม.ย.',327],['พ.ค.',326],['มิ.ย.',326],
  ]);
  ins('chart_recruit', ['month','open_count','hired_count'], [
    ['ม.ค.',9,6],['ก.พ.',11,7],['มี.ค.',8,8],['เม.ย.',13,9],['พ.ค.',12,7],['มิ.ย.',14,9],
  ]);
  ins('chart_hiring', ['month','value'], [
    ['ม.ค.',6],['ก.พ.',7],['มี.ค.',8],['เม.ย.',9],['พ.ค.',7],['มิ.ย.',9],
  ]);
  ins('chart_funnel', ['stage','value','color','sort_order'], [
    ['ผู้สมัคร',420,'#2a5288',0],['คัดกรอง',198,'#2f6fd6',1],
    ['สัมภาษณ์ครั้งที่ 1',96,'#128a9c',2],['สัมภาษณ์ครั้งที่ 2',48,'#1f9d63',3],
    ['สัมภาษณ์ผู้บริหาร',24,'#d98a16',4],['เสนอ Offer',14,'#d6453d',5],
    ['รับเข้าทำงาน',11,'#0f2747',6],
  ]);
  ins('chart_sources', ['name','value','eff','color'], [
    ['JobThai',38,72,'#2f6fd6'],['แนะนำพนักงาน',24,81,'#1f9d63'],
    ['LinkedIn',14,58,'#128a9c'],['Walk-in / ป้ายหน้าโรงงาน',12,49,'#d98a16'],
    ['จัดหางานจังหวัด',8,44,'#6b4fd1'],['Agency',4,38,'#d6453d'],
  ]);

  console.log('Database seeded successfully.');
}

if (require.main === module) {
  const db = getDb();
  initSchema(db);
  if (process.argv[2] === 'seed') seed(db);
  db.close();
  console.log('DB initialized at', DB_PATH);
}

module.exports = { getDb, initSchema, seed };
