/**
 * Threads 命理熱文爬蟲
 * 大寶老師專用 | @read_urface
 */

const { chromium } = require('playwright');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const THREADS_COOKIES_JSON = process.env.THREADS_COOKIES;

const DEFAULT_KEYWORDS = ['命理', '紫微', '算命', '感情運'];

function clean(str) {
  if (!str) return '';
  return str
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

async function fetchKeywords() {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/keywords?status=eq.active&select=keyword`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    const data = await resp.json();
    if (data && data.length > 0) {
      return data.map(r => r.keyword);
    }
  } catch (e) {
    console.log('無法從 Supabase 取得關鍵字，使用預設清單');
  }
  return DEFAULT_KEYWORDS;
}

async function writeToSupabase(rows) {
  if (rows.length === 0) return { success: true, count: 0 };
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/threads_posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(rows)
  });
  if (resp.ok) {
    return { success: true, count: rows.length };
  } else {
    const errText = await resp.text();
    return { success: false, error: errText.substring(0, 200) };
  }
}

async function updateKeywordStats(keyword, count) {
  await fetch(`${SUPABASE_URL}/rest/v1/keywords?keyword=eq.${encodeURIComponent(keyword)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify({
      last_scraped_at: new Date().toISOString(),
      post_count: count
    })
  });
}

async function main() {
  const startTime = new Date();
  const pad = n => String(n).padStart(2, '0');

  const testKeyword = (process.env.KEYWORD_TEST || '').trim();
  const isTestMode = testKeyword.length > 0;
  const batchId = isTestMode
    ? `test_${startTime.getFullYear()}${pad(startTime.getMonth()+1)}${pad(startTime.getDate())}${pad(startTime.getHours())}${pad(startTime.getMinutes())}_${testKeyword.substring(0,10)}`
    : `auto_${startTime.getFullYear()}${pad(startTime.getMonth()+1)}${pad(startTime.getDate())}${pad(startTime.getHours())}${pad(startTime.getMinutes())}`;

  console.log(`\n🌙 大寶老師命理監測站 - 開始抓取`);
  console.log(`📦 Batch ID: ${batchId}`);
  console.log(`⏰ 時間: ${startTime.toLocaleString('zh-TW')}`);
  if (isTestMode) console.log(`🧪 測試模式：只抓「${testKeyword}」\n`);
  else console.log('');

  const keywords = isTestMode ? [testKeyword] : await fetchKeywords();
  console.log(`🔑 關鍵字清單: ${keywords.join('、')}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  if (THREADS_COOKIES_JSON) {
    try {
      const cookies = JSON.parse(THREADS_COOKIES_JSON);
      await context.addCookies(cookies);
      console.log(`🍪 已載入 ${cookies.length} 個 cookies`);
    } catch (e) {
      console.error('Cookie 解析失敗:', e.message);
    }
  }

  const page = await context.newPage();
  const summary = {};
  let totalCount = 0;

  for (const keyword of keywords) {
    console.log(`\n🔍 搜尋「${keyword}」...`);
    try {
      const encodedKw = encodeURIComponent(keyword);
      await page.goto(`https://www.threads.com/search?q=${encodedKw}&serp_type=default&lc=zh_TW`, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      await page.waitForTimeout(3000);
      await page.evaluate(() => window.scrollTo(0, 1500));
      await page.waitForTimeout(2000);

      const posts = await page.evaluate(() => {
        function clean(str) {
          if (!str) return '';
          return str
            .replace(/[\uD800-\uDFFF]/g, '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            .trim();
        }
        const containers = document.querySelectorAll('[data-pressable-container]');
        const results = [];
        containers.forEach((el) => {
          const textNodes = el.querySelectorAll('span[dir="auto"]');
          let postText = '';
          textNodes.forEach(n => {
            const t = clean(n.innerText || '');
            if (t.length > 5) postText += t + '\n';
          });
          const usernameEl = el.querySelector('a[href*="/@"]');
          const href = usernameEl ? usernameEl.getAttribute('href') || '' : '';
          const username = clean(href).replace(/.*\/@/, '@').split('?')[0];
          const timeEl = el.querySelector('time');
          const timeStr = timeEl
            ? clean(timeEl.getAttribute('datetime') || timeEl.innerText || '')
            : '';
          if (postText.length > 20) {
            results.push({
              username,
              time: timeStr || null,
              text: clean(postText).substring(0, 400)
            });
          }
        });
        return results;
      });

      console.log(`   找到 ${posts.length} 篇貼文`);

      if (posts.length > 0) {
        const rows = posts.map(p => ({
          keyword,
          username: p.username || '',
          post_time: p.time || null,
          post_text: p.text || '',
          batch_id: batchId
        }));
        const result = await writeToSupabase(rows);
        if (result.success) {
          console.log(`   ✅ 已寫入 Supabase: ${result.count} 筆`);
          totalCount += result.count;
        } else {
          console.log(`   ❌ 寫入失敗: ${result.error}`);
        }
        await updateKeywordStats(keyword, posts.length);
      }

      summary[keyword] = posts.length;

    } catch (e) {
      console.log(`   ⚠️ 錯誤: ${e.message}`);
      summary[keyword] = 0;
    }
    await page.waitForTimeout(2000);
  }

  await browser.close();

  const endTime = new Date();
  const duration = Math.round((endTime - startTime) / 1000);
  console.log('\n' + '═'.repeat(50));
  console.log('本次抓取完成');
  console.log(`Batch ID：${batchId}`);
  console.log(`耗時：${duration} 秒`);
  Object.entries(summary).forEach(([kw, count]) => {
    console.log(`  ${kw}：${count} 篇`);
  });
  console.log(`合計：${totalCount} 篇`);
  console.log('═'.repeat(50) + '\n');
}

main().catch(err => {
  console.error('執行失敗:', err);
  process.exit(1);
});
