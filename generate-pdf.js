const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const htmlPath = 'file://' + path.resolve(__dirname, 'manual.html');
  await page.goto(htmlPath, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.pdf({
    path: path.resolve(__dirname, 'BWP_Recruitment_Manual.pdf'),
    format: 'A4',
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#6b7686;font-family:sans-serif;">หน้า <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  });
  await browser.close();
  console.log('PDF generated: BWP_Recruitment_Manual.pdf');
})();
