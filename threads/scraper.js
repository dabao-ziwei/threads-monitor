/**
 * Threads 命理關鍵字爬取腳本
 * 由 Claude 排程執行，透過 Claude in Chrome 操作瀏覽器
 *
 * 關鍵字清單（可自行新增）
 */
const KEYWORDS = [
  "命理", "算命", "紫微", "流年", "八字",
  "占星", "感情運", "財運",
  "外遇", "分手", "戀愛", "結婚", "定盤"
];

const BASE_URL = "https://www.threads.com/search?q=";
const DATA_FILE = "./data.json";

/**
 * 主要爬取邏輯（Claude in Chrome 執行）
 *
 * 步驟：
 * 1. 用已登入的 Chrome 打開 threads.com/search
 * 2. 逐一搜尋每個關鍵字
 * 3. 抓取貼文：作者、內容、按讚數、留言數、轉發數、時間
 * 4. 存入 data.json（追加到 scrape_sessions）
 * 5. 更新 tracked_accounts（偵測到的新帳號）
 */

module.exports = {
  KEYWORDS,
  BASE_URL,
  DATA_FILE,

  // 這個函式由排程任務呼叫
  getSearchUrl: (keyword) => `${BASE_URL}${encodeURIComponent(keyword)}`,

  // 合並互動分數
  engagementScore: (post) => (post.likes || 0) + (post.comments || 0) * 2 + (post.reposts || 0) * 3,
};
