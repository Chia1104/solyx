/** A synthetic claim with the quote it rests on, and whether the quote states it. */
export interface ClaimSample {
  claim: string;
  quote: string;
  supported: boolean;
  /** How the quote bears the claim out, or where the claim outruns it. */
  note: string;
}

const held = (claim: string, quote: string, note = "stated"): ClaimSample => ({
  claim,
  quote,
  supported: true,
  note,
});

const outrun = (claim: string, quote: string, note: string): ClaimSample => ({
  claim,
  quote,
  supported: false,
  note,
});

export const CLAIM_SAMPLES: ClaimSample[] = [
  held(
    "八月營收年增約五成三。",
    "Aug. 514,806 / YoY 53.3%",
    "figure, across languages"
  ),
  held(
    "2 奈米已進入量產。",
    "Our 2-nanometer technology successfully entered high volume manufacturing in 4Q'25, with good yield.",
    "fact, across languages"
  ),
  held(
    "毛利率連續三季上升。",
    "毛利率 57.8%、58.6%、59.5%",
    "follows from the figures"
  ),
  held(
    "The company raised its full-year revenue outlook.",
    "We now expect full-year revenue to grow in the mid-30s percent, up from our earlier view of around 30 percent."
  ),
  held("董事會通過每股配發 5 元現金股利。", "董事會決議每股配發現金股利 5 元"),
  held(
    "第二季營收季增約 12%。",
    "q1 1,134,103; q2 1,270,381; qoq +12.0%",
    "figure"
  ),
  held(
    "Sales are concentrated in a few customers.",
    "Our largest customer accounted for 25% of net revenue and our ten largest customers for 76%.",
    "follows from the figures"
  ),
  held("存貨週轉天數下降。", "存貨週轉天數由 85 天降至 76 天"),
  held(
    "The shares closed above their 20-day average.",
    "close 2585; MA20 2466.25",
    "follows from the figures"
  ),
  held(
    "近四季每股盈餘合計 86.28 元。",
    "trailing eps 86.28 (four quarters through 2026-06-30)"
  ),
  held(
    "Management expects demand for AI chips to stay strong.",
    "Entering 2026, we expect AI-related demand to continue to be robust."
  ),
  held(
    "公司將在十月十五日舉行法說會。",
    "October 15, 2026 14:00 3Q'26 Results"
  ),
  held(
    "營業利益率較上季下滑。",
    "Operating margin was 49.6%, compared with 50.8% in the previous quarter."
  ),
  held(
    "本益比高於三年中位數。",
    "price to earnings 29.96; three-year median 22.4",
    "follows from the figures"
  ),
  held(
    "七、八月營收分別年增 11.8%、12.1%。",
    "2026-07,310,+11.8%,+3.9%；2026-08,296,+12.1%,-4.5%",
    "a table row restated"
  ),
  held(
    "第一季營業活動淨現金流入低於去年同期。",
    "營業活動之淨現金流入：本季 52,300 千元；去年同期 91,700 千元",
    "follows from the figures"
  ),
  held(
    "本季有效稅率約 8%，去年同期約 20%。",
    "本季有效稅率約為 8%，顯著低於去年同期的 20%"
  ),

  outrun(
    "AI 訂單明年將翻倍。",
    "Entering 2026, we expect AI-related demand to continue to be robust.",
    "a number the quote does not give"
  ),
  outrun(
    "八月營收年增六成三。",
    "Aug. 514,806 / YoY 53.3%",
    "a different figure"
  ),
  outrun(
    "毛利率創下歷史新高。",
    "The annual shareholders' meeting will be held on June 3.",
    "unrelated"
  ),
  outrun(
    "公司已確認取得蘋果的新訂單。",
    "市場傳出該公司可望打入蘋果供應鏈",
    "a rumour told as fact"
  ),
  outrun(
    "Revenue fell from a year earlier.",
    "Revenue rose 12% year over year.",
    "the opposite"
  ),
  outrun(
    "The company raised its full-year outlook.",
    "Management reiterated its full-year outlook.",
    "unchanged told as raised"
  ),
  outrun(
    "現金股利提高到每股 6 元。",
    "董事會決議每股配發現金股利 5 元",
    "a different figure"
  ),
  outrun(
    "N2P 已經量產。",
    "Volume production for both N2P and A16 is scheduled for the second half of 2026.",
    "a plan told as done"
  ),
  outrun(
    "股價相對同業便宜。",
    "price to earnings 29.96; three-year median 22.4",
    "a comparison the quote does not make"
  ),
  outrun("外資連續多日買超。", "外資昨日買超 1.2 萬張", "one day told as many"),
  outrun(
    "Operating margin widened from the previous quarter.",
    "Operating margin was 49.6%, compared with 50.8% in the previous quarter.",
    "the opposite"
  ),
  outrun(
    "營收成長主要來自 AI 需求。",
    "1–8 月累計營收年增 39.3%",
    "a cause the quote does not give"
  ),
  outrun(
    "The new fab will reach full capacity next year.",
    "We will continue to invest in leading edge facilities over the next several years across several locations.",
    "a date the quote does not give"
  ),
  outrun(
    "公司下修了資本支出。",
    "全年資本支出維持先前預估區間",
    "unchanged told as cut"
  ),
  outrun(
    "資安事件可能增加防護與法遵成本，財務影響尚未量化。",
    "約九萬筆資料遭未經授權讀取，相關影響仍在調查與評估中",
    "a reading of what the fact may lead to"
  ),
  outrun(
    "平台具有覆蓋優勢，惟公司自述不等同獨立的市占調查。",
    "上市櫃公司使用率 91.2%",
    "a judgement and a caveat the quote does not make"
  ),
  outrun(
    "第一季淨利受所得稅利益支持，不能全數視為本業成長。",
    "所得稅費用減少，係因認列研發投資抵減之所得稅利益",
    "a reading of what the fact means"
  ),
  outrun(
    "七月中旬的大跌是除息造成的。",
    "'26/07/15 198.5 '26/08/10 12.4",
    "a cause the quote does not give"
  ),
];
