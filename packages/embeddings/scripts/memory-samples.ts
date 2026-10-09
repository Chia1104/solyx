/** Two synthetic memories of one kind and listing, and whether the second only says the first again. */
export interface MemoryPair {
  a: string;
  b: string;
  same: boolean;
}

const again = (a: string, b: string): MemoryPair => ({ a, b, same: true });

const apart = (a: string, b: string): MemoryPair => ({ a, b, same: false });

export const MEMORY_PAIRS: MemoryPair[] = [
  again(
    "使用者偏好台股中長線，不做當沖",
    "使用者偏好中長期持有台股，不做當日沖銷"
  ),
  again("風險預算：單筆虧損不超過帳戶 1%", "每筆交易最多虧帳戶淨值的 1%"),
  again("回覆請用繁體中文並先給結論", "用繁中回答，結論放最前面"),
  again(
    "台積電論點：CoWoS 擴產支撐 AI 營收",
    "台積電：看好 CoWoS 產能擴張帶動 AI 相關營收"
  ),
  again(
    "User prefers limit orders only",
    "Never place market orders for the user; use limit orders"
  ),
  again(
    "使用者持有 0050 作為核心部位，不賣",
    "0050 是使用者的長期核心持股，不考慮出場"
  ),
  again("不要推薦市值低於 50 億的小型股", "避免建議市值 50 億以下的公司"),
  again(
    "使用者在半導體業工作，熟悉晶圓製程",
    "使用者本身從事半導體製造相關工作"
  ),
  apart("使用者偏好台股中長線，不做當沖", "使用者的美股部位只買 ETF"),
  apart("風險預算：單筆虧損不超過帳戶 1%", "單一個股持倉上限為帳戶 10%"),
  apart("回覆請用繁體中文並先給結論", "報告中的數字請附上資料日期"),
  apart(
    "台積電論點：CoWoS 擴產支撐 AI 營收",
    "台積電風險：美國廠成本拉低毛利率"
  ),
  apart(
    "User prefers limit orders only",
    "User trades only during the regular session"
  ),
  apart(
    "使用者持有 0050 作為核心部位，不賣",
    "使用者持有 00878 領息，不打算加碼"
  ),
  apart("不要推薦市值低於 50 億的小型股", "不要推薦金融股"),
  apart("聯發科論點：天璣旗艦晶片市佔提升", "聯發科風險：手機市場需求疲弱"),
  apart("使用者偏好看週線判斷趨勢", "使用者偏好看日線 KD 決定進場點"),
  apart("停損一律設在進場價下方 7%", "停利分兩批，第一批在 1.5R"),
];
