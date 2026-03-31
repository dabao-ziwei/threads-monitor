/**
 * Threads 爆文分析器
 * 大寶老師專用 | @read_urface
 * 支援 Claude (Anthropic) / Gemini (Google) 切換
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 預設用 Claude，可用環境變數切換
const AI_PROVIDER = (process.env.AI_PROVIDER || 'claude').toLowerCase();

// 分析 Prompt（兩個 AI 共用同一份）
function buildPrompt(postText) {
  return `你是一位專精台灣社群媒體的內容分析師，專門分析 Threads 平台上的命理、感情、人生議題爆文。
受眾主力為台灣女性，年齡 20～50 歲，關注感情、職場、自我成長。

請分析以下這篇 Threads 貼文，輸出嚴格的 JSON 格式，不要有任何額外說明文字。

貼文內容：
"""
${postText.substring(0, 600)}
"""

請輸出以下 JSON 結構：
{
  "hook_type": "痛點型 | 故事型 | 反直覺型 | 數字型 | 懸念型",
  "hook_sentence": "第一句或開頭鉤子的原文（不超過50字）",
  "emotion_trigger": ["焦慮", "共鳴", "好奇", "憤怒", "希望"],
  "rhythm_score": 1到10的整數（10=節奏感最強，短句密、換行頻繁）,
  "core_formula": "一句話說明這篇爆文的核心套路",
  "copy_elements": ["可複製的寫法1", "可複製的寫法2", "可複製的寫法3"],
  "dabao_suggestion": "給大寶老師的具體建議：如何把這個爆點套用到命理諮詢內容（50字以內）",
  "provider": "${AI_PROVIDER}"
}

emotion_trigger 只選符合的項目，可以是1到3個。
copy_elements 每項不超過30字，要具體可操作。
所有內容使用繁體中文。`;
}

// Claude API 分析
async function analyzeWithClaude(postText) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: buildPrompt(postText)
      }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API 錯誤: ${response.status} - ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  const raw = data.content[0].text.trim();
  return JSON.parse(raw);
}

// Gemini API 分析
async function analyzeWithGemini(postText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: buildPrompt(postText) }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 600
      }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API 錯誤: ${response.status} - ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  const raw = data.candidates[0].content.parts[0].text.trim()
    .replace(/^```json\n?/, '')
    .replace(/\n?```$/, '');
  return JSON.parse(raw);
}

// 主分析函式
async function analyzePost(postText) {
  if (AI_PROVIDER === 'gemini') {
    return await analyzeWithGemini(postText);
  } else {
    return await analyzeWithClaude(postText);
  }
}

// 從 Supabase 撈出尚未分析的貼文
async function fetchUnanalyzedPosts() {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/threads_posts?analysis_json=is.null&select=id,post_text,keyword&order=scraped_at.desc&limit=50`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    }
  );

  if (!resp.ok) {
    throw new Error(`Supabase 查詢失敗: ${await resp.text()}`);
  }

  return await resp.json();
}

// 把分析結果寫回 Supabase
async function saveAnalysis(postId, analysisJson) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/threads_posts?id=eq.${postId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({
        analysis_json: analysisJson,
        analyzed_at: new Date().toISOString()
      })
    }
  );

  return resp.ok;
}

// 延遲函式（避免 API rate limit）
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const startTime = new Date();
  console.log('\n🔮 大寶老師命理監測站 - 爆文分析開始');
  console.log(`🤖 使用 AI：${AI_PROVIDER === 'gemini' ? 'Google Gemini' : 'Anthropic Claude'}`);
  console.log(`⏰ 時間：${startTime.toLocaleString('zh-TW')}\n`);

  // 檢查 API Key
  if (AI_PROVIDER === 'gemini' && !GEMINI_API_KEY) {
    console.error('❌ 缺少 GEMINI_API_KEY，請在 GitHub Secrets 設定');
    process.exit(1);
  }
  if (AI_PROVIDER === 'claude' && !ANTHROPIC_API_KEY) {
    console.error('❌ 缺少 ANTHROPIC_API_KEY，請在 GitHub Secrets 設定');
    process.exit(1);
  }

  // 撈未分析的貼文
  console.log('📋 查詢尚未分析的貼文...');
  const posts = await fetchUnanalyzedPosts();
  console.log(`   找到 ${posts.length} 篇待分析\n`);

  if (posts.length === 0) {
    console.log('✅ 所有貼文已分析完畢，無需處理');
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const progress = `[${i + 1}/${posts.length}]`;

    console.log(`${progress} 分析中... (關鍵字：${post.keyword})`);
    console.log(`   內容預覽：${post.post_text.substring(0, 50).replace(/\n/g, ' ')}...`);

    try {
      const analysis = await analyzePost(post.post_text);
      const saved = await saveAnalysis(post.id, analysis);

      if (saved) {
        console.log(`   ✅ 完成 | 鉤子：${analysis.hook_type} | 情緒：${analysis.emotion_trigger?.join('+')} | 節奏：${analysis.rhythm_score}/10`);
        successCount++;
      } else {
        console.log(`   ⚠️ 分析完成但寫回失敗`);
        failCount++;
      }
    } catch (e) {
      console.log(`   ❌ 錯誤：${e.message}`);
      failCount++;
    }

    // 每篇之間稍作延遲，避免打爆 API rate limit
    if (i < posts.length - 1) {
      await sleep(1500);
    }
  }

  const duration = Math.round((new Date() - startTime) / 1000);
  console.log('\n' + '═'.repeat(50));
  console.log('分析完成');
  console.log(`耗時：${duration} 秒`);
  console.log(`成功：${successCount} 篇 | 失敗：${failCount} 篇`);
  console.log('═'.repeat(50) + '\n');
}

main().catch(err => {
  console.error('執行失敗:', err);
  process.exit(1);
});
