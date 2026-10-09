import type { NewsItem } from "@solyx/core/news";

type Item = Pick<NewsItem, "title" | "snippet">;

/** Why two synthetic items do or do not tell one story. */
export const PairKind = {
  /** One event worded again in the same language. */
  Reworded: "reworded",
  /** One event told in Chinese and in English. */
  AcrossLanguages: "across languages",
  /** One headline under different sites' labels. */
  Relabelled: "relabelled",
  /** Different events of one company on one day: the pairs a line must keep apart. */
  SameCompany: "same company",
  /** Different companies in one headline's mould, as monthly revenue and dividend news are. */
  SameMould: "same mould",
  /** Unrelated headlines under one site's label. */
  SameSite: "same site",
} as const;

export type PairKind = (typeof PairKind)[keyof typeof PairKind];

export interface StoryPair {
  a: Item;
  b: Item;
  kind: PairKind;
}

/** Whether a pair's items tell one story. */
export const isSameStory = ({ kind }: StoryPair) =>
  kind === PairKind.Reworded ||
  kind === PairKind.AcrossLanguages ||
  kind === PairKind.Relabelled;

const item = (title: string, snippet = ""): Item => ({ title, snippet });

const TSMC_OUTLOOK = item(
  "台積電上調全年營收成長預估至三成五",
  "台積電在法說會表示，受 AI 需求帶動，今年美元營收成長預估由三成調升至三成五左右。"
);

const TSMC_OUTLOOK_EN = item(
  "TSMC lifts full-year revenue growth forecast on AI demand",
  "Taiwan Semiconductor raised its 2026 sales growth outlook to about 35% in US dollar terms."
);

const FOXCONN_SALES = item(
  "鴻海9月營收創同期新高 年增逾兩成",
  "鴻海公布9月合併營收，較去年同期成長約22%，雲端網路產品貢獻最大。"
);

const MEDIATEK_CHIP = item(
  "聯發科發表新一代旗艦手機晶片",
  "聯發科今日推出採用 2 奈米製程的天璣旗艦晶片，預計第四季搭載於多款新機。"
);

const ASUS_DIVIDEND = item(
  "華碩董事會通過每股配發現金股利 20 元",
  "華碩今日董事會決議，每股配發現金股利 20 元，配發率約七成。"
);

const WIWYNN_RESULTS = item(
  "緯穎第三季獲利季增三成 毛利率走高",
  "緯穎公布第三季財報，稅後純益季增約 30%，毛利率提升至 10.5%。"
);

const DELTA_PLANT = item(
  "台達電斥資十億美元擴建泰國廠",
  "台達電宣布投資約 10 億美元擴充泰國生產基地，以因應資料中心電源需求。"
);

const ASE_OUTLOOK = item(
  "日月光投控上調全年封測營收成長目標",
  "日月光投控表示，先進封裝訂單能見度延長，今年封測事業營收成長目標上調至兩成。"
);

const NVIDIA_GPU = item(
  "Nvidia unveils next-generation data center GPU",
  "Nvidia introduced its new accelerator at its annual conference, promising twice the inference performance."
);

export const STORY_PAIRS: StoryPair[] = [
  {
    kind: PairKind.Reworded,
    a: TSMC_OUTLOOK,
    b: item(
      "AI 需求強勁 台積電法說會調高今年營收展望",
      "晶圓代工龍頭今日法說會上修全年營收成長目標，管理層指出先進製程產能持續吃緊。"
    ),
  },
  {
    kind: PairKind.Reworded,
    a: FOXCONN_SALES,
    b: item(
      "雲端產品撐腰 鴻海上月營收寫同期最佳",
      "鴻海9月營收年增兩成多，為歷年同期新高，伺服器機櫃出貨暢旺。"
    ),
  },
  {
    kind: PairKind.Reworded,
    a: MEDIATEK_CHIP,
    b: item(
      "聯發科天璣新旗艦登場 首度採2奈米",
      "IC 設計大廠發表新款旗艦行動處理器，強調 AI 運算效能提升四成。"
    ),
  },
  {
    kind: PairKind.Reworded,
    a: ASUS_DIVIDEND,
    b: item(
      "華碩宣布配息20元 殖利率約4%",
      "華碩公告股利政策，現金股利每股 20 元，以昨日收盤價計算殖利率約 4%。"
    ),
  },
  {
    kind: PairKind.Reworded,
    a: WIWYNN_RESULTS,
    b: item(
      "緯穎Q3每股賺逾10元 毛利率創新高",
      "伺服器廠緯穎第三季每股純益突破 10 元，毛利率改寫新高紀錄。"
    ),
  },
  {
    kind: PairKind.Reworded,
    a: DELTA_PLANT,
    b: item(
      "資料中心電源需求旺 台達電加碼泰國產能",
      "台達電董事會通過泰國新廠投資案，金額約新台幣 320 億元。"
    ),
  },
  {
    kind: PairKind.Reworded,
    a: ASE_OUTLOOK,
    b: item(
      "先進封裝需求暢旺 日月光調高今年營收展望",
      "封測龍頭上修全年封測營收成長目標，看好 AI 晶片封裝訂單延續到明年。"
    ),
  },
  {
    kind: PairKind.Reworded,
    a: item("[新聞] 台積電法說上修全年營收展望"),
    b: item("[新聞] 台積電調高今年營收成長預估至35%"),
  },
  {
    kind: PairKind.Reworded,
    a: TSMC_OUTLOOK_EN,
    b: item(
      "TSMC raises annual sales outlook as AI chip orders surge",
      "The world's largest contract chipmaker now expects revenue to grow in the mid-30s percent this year."
    ),
  },
  {
    kind: PairKind.Reworded,
    a: NVIDIA_GPU,
    b: item(
      "Nvidia launches new AI chip, claims 2x inference speed",
      "The chip designer announced the successor to its flagship data center GPU on Tuesday."
    ),
  },
  {
    kind: PairKind.Reworded,
    a: item(
      "Apple to invest $5 billion in US chip packaging",
      "Apple said it would fund new advanced packaging capacity in Arizona over the next four years."
    ),
    b: item(
      "Apple pledges new US spending on advanced chip packaging",
      "The iPhone maker committed billions of dollars to packaging plants in Arizona."
    ),
  },
  { kind: PairKind.AcrossLanguages, a: TSMC_OUTLOOK, b: TSMC_OUTLOOK_EN },
  {
    kind: PairKind.AcrossLanguages,
    a: FOXCONN_SALES,
    b: item(
      "Foxconn September sales hit record for the month, up over 20%",
      "Hon Hai said revenue rose about 22% from a year earlier, led by cloud and networking products."
    ),
  },
  {
    kind: PairKind.AcrossLanguages,
    a: MEDIATEK_CHIP,
    b: item(
      "MediaTek unveils flagship 2nm smartphone chip",
      "The Dimensity processor will ship in new phones from the fourth quarter."
    ),
  },
  {
    kind: PairKind.AcrossLanguages,
    a: ASUS_DIVIDEND,
    b: item(
      "ASUS board approves cash dividend of NT$20 per share",
      "The payout amounts to about 70% of last year's earnings."
    ),
  },
  {
    kind: PairKind.AcrossLanguages,
    a: WIWYNN_RESULTS,
    b: item(
      "Wiwynn third-quarter profit rises 30% from prior quarter",
      "The server maker's gross margin improved to 10.5%."
    ),
  },
  {
    kind: PairKind.AcrossLanguages,
    a: DELTA_PLANT,
    b: item(
      "Delta Electronics to spend $1 billion expanding Thailand plant",
      "The power supplier is adding capacity for data center customers."
    ),
  },
  {
    kind: PairKind.AcrossLanguages,
    a: ASE_OUTLOOK,
    b: item(
      "ASE raises full-year packaging and testing revenue growth target",
      "The company cited longer visibility on advanced packaging orders."
    ),
  },
  {
    kind: PairKind.Relabelled,
    a: item("台積電上調全年營收展望｜豐雲學堂"),
    b: item("台積電上調全年營收展望 - 股市爆料同學會"),
  },
  {
    kind: PairKind.SameCompany,
    a: TSMC_OUTLOOK,
    b: item(
      "台積電股價創歷史新高 市值突破新台幣60兆",
      "台積電今日盤中大漲 3%，收盤價改寫歷史紀錄，外資連續五日買超。"
    ),
  },
  {
    kind: PairKind.SameCompany,
    a: TSMC_OUTLOOK,
    b: item(
      "台積電董事會核准資本預算 擴建亞利桑那廠",
      "台積電董事會通過約 150 億美元資本預算，用於美國廠第三期建置。"
    ),
  },
  {
    kind: PairKind.SameCompany,
    a: item(
      "台積電法說會：第四季毛利率估介於59%至61%",
      "台積電預估第四季毛利率介於 59% 至 61%，營業利益率介於 49% 至 51%。"
    ),
    b: item(
      "台積電9月營收年增31% 創單月新高",
      "台積電公布 9 月營收，年增 31%，月增 8%，改寫單月新高。"
    ),
  },
  {
    kind: PairKind.SameCompany,
    a: FOXCONN_SALES,
    b: item(
      "鴻海宣布與日本車廠合資生產電動車",
      "鴻海與日本車廠簽署合資協議，將在美國設廠生產電動休旅車。"
    ),
  },
  {
    kind: PairKind.SameCompany,
    a: MEDIATEK_CHIP,
    b: item(
      "聯發科第三季營收季減5% 低於市場預期",
      "聯發科第三季營收較上季減少約 5%，手機晶片出貨放緩。"
    ),
  },
  {
    kind: PairKind.SameCompany,
    a: ASUS_DIVIDEND,
    b: item(
      "華碩推出新款 AI 筆電 搭載自家散熱技術",
      "華碩發表輕薄 AI 筆電新品，主打長效電池與靜音散熱。"
    ),
  },
  {
    kind: PairKind.SameCompany,
    a: WIWYNN_RESULTS,
    b: item(
      "緯穎董事長：明年資本支出將倍增",
      "緯穎董事長在股東會表示，為因應客戶需求，明年資本支出將較今年倍增。"
    ),
  },
  {
    kind: PairKind.SameCompany,
    a: DELTA_PLANT,
    b: item(
      "台達電9月營收年減3%",
      "台達電公布 9 月營收，年減約 3%，主因消費性電源需求疲弱。"
    ),
  },
  {
    kind: PairKind.SameCompany,
    a: item("[新聞] 台積電法說上修全年營收展望"),
    b: item("[新聞] 台積電美國廠第二期提前量產"),
  },
  {
    kind: PairKind.SameCompany,
    a: TSMC_OUTLOOK_EN,
    b: item(
      "TSMC shares hit record high as market value tops $1.5 trillion",
      "The stock rose 3% in Taipei trading after foreign investors added to positions."
    ),
  },
  {
    kind: PairKind.SameCompany,
    a: NVIDIA_GPU,
    b: item(
      "Nvidia faces new export curbs on China-bound chips",
      "The US Commerce Department tightened licensing rules for advanced accelerators."
    ),
  },
  {
    kind: PairKind.SameCompany,
    a: item(
      "台積電股價創歷史新高 市值突破新台幣60兆",
      "台積電今日盤中大漲 3%，收盤價改寫歷史紀錄，外資連續五日買超。"
    ),
    b: TSMC_OUTLOOK_EN,
  },
  {
    kind: PairKind.SameMould,
    a: FOXCONN_SALES,
    b: item(
      "廣達9月營收創同期新高 年增逾兩成",
      "廣達公布9月合併營收，較去年同期成長約25%，AI 伺服器出貨強勁。"
    ),
  },
  {
    kind: PairKind.SameMould,
    a: ASUS_DIVIDEND,
    b: item(
      "宏碁董事會通過每股配發現金股利 2 元",
      "宏碁今日董事會決議，每股配發現金股利 2 元。"
    ),
  },
  {
    kind: PairKind.SameMould,
    a: MEDIATEK_CHIP,
    b: item(
      "高通發表新一代旗艦手機晶片",
      "高通今日推出新款驍龍旗艦處理器，預計年底搭載於安卓旗艦機。"
    ),
  },
  {
    kind: PairKind.SameMould,
    a: ASE_OUTLOOK,
    b: item(
      "京元電上調全年測試營收成長目標",
      "京元電表示 AI 晶片測試需求強勁，今年營收成長目標上調。"
    ),
  },
  {
    kind: PairKind.SameSite,
    a: item("台積電上調全年營收展望｜豐雲學堂"),
    b: item("鴻海9月營收創同期新高｜豐雲學堂"),
  },
  {
    kind: PairKind.SameSite,
    a: item("2330 台積電 - 法說會重點整理 - 股市爆料同學會"),
    b: item("2330 台積電 - 除息行情預測 - 股市爆料同學會"),
  },
];
