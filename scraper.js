/**
 * Threads 命理熱文爬蟲 v2
 * 大寶老師專用 | @read_urface
 * 新增：搜尋排名、文章 URL
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
// 語言過濾：只保留繁中文章
// 規則：中文字符比例 > 15%，且韓文字符 < 10 個
function isChinesePost(text) {
  if (!text || text.length < 10) return false;
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const koreanChars  = (text.match(/[\uAC00-\uD7A3]/g) || []).length;
  const meaningfulChars = text.replace(/[\s\n\r]/g, '').length;
  if (meaningfulChars === 0) return false;
  const chineseRatio = chineseChars / meaningfulChars;
  // 韓文太多直接排除；中文比例不足也排除
  return koreanChars < 10 && chineseRatio > 0.15;
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
  if (isTestMode) console.log(`🧪 測試模式：只抓「${testKeyword}」（資料將標記為 is_test=true，不影響主列表）\n`);
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
        let rank = 1;
        containers.forEach((el) => {
          const textNodes = el.querySelectorAll('span[dir="auto"]');
          let postText = '';
          textNodes.forEach(n => {
            const t = clean(n.innerText || '');
            if (t.length > 5) postText += t + '\n';
          });
          // 抓 username 和文章連結
          const usernameEl = el.querySelector('a[href*="/@"]');
          const href = usernameEl ? usernameEl.getAttribute('href') || '' : '';
          const username = clean(href).replace(/.*\/@/, '@').split('?')[0].split('/')[0];
          // 抓文章直連 URL（格式通常是 /@username/post/XXXXX）
          const postLinkEl = el.querySelector('a[href*="/post/"]');
          let postUrl = '';
          if (postLinkEl) {
            const rawHref = postLinkEl.getAttribute('href') || '';
            postUrl = rawHref.startsWith('http')
              ? rawHref
              : 'https://www.threads.com' + rawHref.split('?')[0];
          }
          const timeEl = el.querySelector('time');
          const timeStr = timeEl
            ? clean(timeEl.getAttribute('datetime') || timeEl.innerText || '')
            : '';
          if (postText.length > 20) {
            results.push({
              username,
              time: timeStr || null,
              text: clean(postText).substring(0, 400),
              post_url: postUrl || null,
              search_rank: rank
            });
            rank++;
          }
        });
        return results;
      });
      console.log(`   找到 ${posts.length} 篇貼文`);
      // 過濾非中文文章
      const filteredPosts = posts.filter(p => isChinesePost(p.text));
      const skipped = posts.length - filteredPosts.length;
      if (skipped > 0) console.log(`   🈲 過濾掉 ${skipped} 篇非中文貼文`);
      if (filteredPosts.length > 0) {
        const rows = filteredPosts.map(p => ({
          keyword,
          username: p.username || '',
          post_time: p.time || null,
          post_text: p.text || '',
          post_url: p.post_url || null,
          search_rank: p.search_rank || null,
          batch_id: batchId,
          is_test: isTestMode   // ← 測試模式標記，正式抓取為 false
        }));
        const result = await writeToSupabase(rows);
        if (result.success) {
          console.log(`   ✅ 已寫入 Supabase: ${result.count} 筆${isTestMode ? '（測試資料，可在 Dashboard 預覽後刪除）' : ''}`);
          totalCount += result.count;
        } else {
          console.log(`   ❌ 寫入失敗: ${result.error}`);
        }
        // 正式模式才更新關鍵字統計
        if (!isTestMode) {
          await updateKeywordStats(keyword, filteredPosts.length);
        }
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
