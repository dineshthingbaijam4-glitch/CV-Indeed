import type { NextApiRequest, NextApiResponse } from 'next'
import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'
import os from 'os'

function send(res: NextApiResponse, line: string) { res.write(line + '\n') }
function log(res: NextApiResponse, msg: string) { send(res, `LOG: ${msg}`) }

async function getDriveClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}')
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  return google.drive({ version: 'v3', auth })
}

async function uploadToDrive(drive: any, folderId: string, filePath: string, fileName: string, mimeType: string) {
  const fileStream = fs.createReadStream(filePath)
  const stats = fs.statSync(filePath)
  const sizeKb = (stats.size / 1024).toFixed(0) + ' KB'
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: fileStream },
    fields: 'id, webViewLink',
  })
  return { id: res.data.id, webViewLink: res.data.webViewLink, size: sizeKb }
}

async function scrapeAndDownload(cookies: any[], jobUrl: string, logFn: (m: string) => void) {
  let chromium: any, puppeteer: any
  try {
    chromium = await import('@sparticuz/chromium')
    puppeteer = await import('puppeteer-core')
  } catch (e) {
    throw new Error('Browser dependencies unavailable')
  }

  const browser = await puppeteer.default.launch({
    args: chromium.default.args,
    defaultViewport: chromium.default.defaultViewport,
    executablePath: await chromium.default.executablePath(),
    headless: true,
  })

  const page = await browser.newPage()
  logFn('🍪 Setting session cookies...')
  await page.setCookie(...cookies.map((c: any) => ({ ...c, domain: '.indeed.com' })))

  logFn('🌐 Opening candidates page...')
  await page.goto(jobUrl, { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise(r => setTimeout(r, 2000))

  logFn('🔍 Finding candidates...')
  const candidateLinks: { name: string; url: string }[] = await page.evaluate(() => {
    const results: { name: string; url: string }[] = []
    const selectors = [
      'a[data-tn-element="candidate-name-link"]',
      'a[href*="/resume/"]',
      'a[href*="candidate"]',
      '.candidate-name a',
    ]
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => {
        const href = (el as HTMLAnchorElement).href
        const name = el.textContent?.trim() || 'Unknown'
        if (href && name && !results.find(r => r.url === href)) {
          results.push({ name, url: href })
        }
      })
      if (results.length > 0) break
    }
    return results.slice(0, 200)
  })

  logFn(`📋 Found ${candidateLinks.length} candidate(s)`)

  const tmpDir = os.tmpdir()
  const downloaded: { name: string; filePath: string; mimeType: string }[] = []

  for (let i = 0; i < candidateLinks.length; i++) {
    const { name, url } = candidateLinks[i]
    logFn(`⬇ [${i + 1}/${candidateLinks.length}] ${name}`)
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 })
      const client = await page.createCDPSession()
      await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: tmpDir })
      const btn = await page.$('a[href*="resumes/download"], a[download], button[aria-label*="download"], a[aria-label*="Download"]')
      if (!btn) { logFn(`  ⚠ No download button for ${name}`); continue }
      const beforeFiles = new Set(fs.readdirSync(tmpDir))
      await btn.click()
      await new Promise(r => setTimeout(r, 3500))
      const afterFiles = fs.readdirSync(tmpDir).filter(f => !f.endsWith('.crdownload') && !beforeFiles.has(f))
      if (afterFiles.length === 0) { logFn(`  ⚠ No file appeared for ${name}`); continue }
      const file = afterFiles[0]
      const filePath = path.join(tmpDir, file)
      const ext = path.extname(file).toLowerCase()
      const mimeType = ext === '.pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      downloaded.push({ name, filePath, mimeType })
      logFn(`  ✅ Downloaded`)
    } catch (e: any) {
      logFn(`  ❌ Failed: ${e.message}`)
    }
  }

  await browser.close()
  return downloaded
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Transfer-Encoding', 'chunked')
  res.setHeader('Cache-Control', 'no-cache')

  const { cookies, jobUrl, driveFolder } = req.body
  const logFn = (msg: string) => log(res, msg)

  try {
    let parsedCookies: any[]
    try {
      parsedCookies = JSON.parse(cookies)
      if (!Array.isArray(parsedCookies)) throw new Error()
    } catch {
      send(res, 'ERROR: Cookie JSON is invalid.')
      return res.end()
    }

    log(res, '🔑 Connecting to Google Drive...')
    const drive = await getDriveClient()
    const cvFiles = await scrapeAndDownload(parsedCookies, jobUrl, logFn)

    if (cvFiles.length === 0) {
      send(res, 'ERROR: No CVs found. Check your cookies and job URL.')
      return res.end()
    }

    log(res, `\n☁ Uploading ${cvFiles.length} CV(s) to Google Drive...`)
    const results = []
    const now = new Date()

    for (const cv of cvFiles) {
      try {
        const ext = path.extname(cv.filePath)
        const safeName = cv.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim()
        const fileName = `${safeName}${ext}`
        const { webViewLink, size } = await uploadToDrive(drive, driveFolder, cv.filePath, fileName, cv.mimeType)
        results.push({ name: cv.name, fileName, driveUrl: webViewLink, size, uploadedAt: now.toLocaleTimeString() })
        log(res, `  ✅ Uploaded: ${fileName} (${size})`)
        fs.unlinkSync(cv.filePath)
      } catch (e: any) {
        log(res, `  ❌ Upload failed for ${cv.name}: ${e.message}`)
      }
    }

    log(res, `\n✅ All done! ${results.length} CVs saved to Drive.`)
    send(res, `RESULT: ${JSON.stringify(results)}`)
  } catch (e: any) {
    send(res, `ERROR: ${e.message}`)
  }

  res.end()
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
    responseLimit: false,
  },
}
