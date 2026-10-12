/** Which way a synthetic fact bears on its company's share price. */
export const FactBearing = {
  Good: "good",
  Bad: "bad",
  Neutral: "neutral",
} as const;

export type FactBearing = (typeof FactBearing)[keyof typeof FactBearing];

/** A synthetic fact with the quote it rests on, shaped like what a forecast cites, and how it bears on the price. */
export interface FactSample {
  fact: string;
  quote: string;
  bearing: FactBearing;
}

const sample =
  (bearing: FactBearing) =>
  (fact: string, quote: string): FactSample => ({ fact, quote, bearing });

const good = sample(FactBearing.Good);

const bad = sample(FactBearing.Bad);

const neutral = sample(FactBearing.Neutral);

export const FACT_SAMPLES: FactSample[] = [
  good("9月營收年增87.2%。", "2026-09 營收 3,808.06 億元，年增 87.2%"),
  good("第二季每股盈餘年增114.5%。", "2026Q2 EPS 4.72 元，年增 114.5%"),
  good("外資近5日買超31,470張。", "外資 近5日買賣超 +31,470 張"),
  good(
    "收盤站上20日與60日均線，兩條均線上升。",
    "收盤 189.5，MA20 185.53 上升，MA60 181.28 上升"
  ),
  good(
    "股價放量突破前高194.5元。",
    "收盤 197，成交量為20日均量 1.8 倍，前高 194.5"
  ),
  good("投信連續8個交易日買超。", "投信 連續買超 8 日，合計 +12,400 張"),
  good("董事會通過買回庫藏股10,000張。", "董事會決議買回本公司股份 10,000 張"),
  good(
    "The company raised its full-year revenue guidance.",
    "We now expect full-year revenue to grow about 30%, up from the 20% we guided in July."
  ),
  good(
    "Gross margin rose to 59.5% from 53.2% a year earlier.",
    "Gross margin 59.5% (53.2% in the same quarter last year)"
  ),
  good(
    "Operating cash flow more than doubled on the year.",
    "Net cash from operating activities: 4,210 million, against 1,930 million a year earlier"
  ),

  bad("近四季自由現金流為負2,682.59億元。", "近四季 自由現金流 -2,682.59 億元"),
  bad("負債占資產比率升至82.4%。", "負債占資產比率 82.4%，前一季 78.1%"),
  bad("外資近20日賣超28,315張。", "外資 近20日買賣超 -28,315 張"),
  bad("9月營收年減23.5%。", "2026-09 營收 412.30 億元，年減 23.5%"),
  bad("收盤跌破60日均線，均線轉為下彎。", "收盤 176，MA60 181.28 下彎"),
  bad(
    "董事長申報轉讓持股5,000張。",
    "內部人持股轉讓事前申報：董事長，一般交易 5,000,000 股"
  ),
  bad(
    "股價帶量跌破前低182.5元。",
    "收盤 179，成交量為20日均量 2.1 倍，前低 182.5"
  ),
  bad(
    "The company cut its full-year guidance.",
    "We are lowering our full-year revenue outlook to a decline of 5% to 8%, from flat."
  ),
  bad(
    "Gross margin fell to 41.0% from 47.3% a year earlier.",
    "Gross margin 41.0% (47.3% in the same quarter last year)"
  ),
  bad(
    "Inventories rose 60% on the year while sales fell 5%.",
    "Inventories up 60% year on year; net sales down 5%"
  ),

  neutral("法人說明會訂於10月29日舉行。", "2026-10-29 14:00 法人說明會"),
  neutral("10月8日的低點為182.5元。", "2026-10-08 最低 182.5"),
  neutral("10月12日收盤為189.5元。", "2026-10-12 收盤 189.5"),
  neutral(
    "近20日成交密集區為186.27至188.73元。",
    "近20日 成交密集區 186.27 ~ 188.73"
  ),
  neutral("外銷訂單統計將於10月20日公布。", "2026-10-20 16:00 外銷訂單統計"),
  neutral("9月營收年增12%，但月減15%。", "2026-09 營收 年增 12.0%，月減 15.0%"),
  neutral(
    "The company makes servers and notebook computers.",
    "Principal products: servers, notebook computers and their components"
  ),
  neutral(
    "The annual shareholders' meeting is on June 12.",
    "Annual General Meeting: June 12, 2027"
  ),
  neutral(
    "The company has 2.8 billion shares outstanding.",
    "Shares outstanding: 2,800,000,000"
  ),
  neutral(
    "Revenue rose 8% while net income fell 6%.",
    "Revenue +8% year on year; net income -6% year on year"
  ),
];
