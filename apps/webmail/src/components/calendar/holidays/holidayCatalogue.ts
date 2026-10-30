import Holidays from "date-holidays";

export type HolidayTraditionId =
  | "islam"
  | "christianity"
  | "orthodox"
  | "hinduism"
  | "buddhism"
  | "judaism"
  | "shinto"
  | "astronomy"
  | "national"
  | "sports";

export type DateTypeCategory = "fixed" | "calculated" | "provisional";

export interface HolidayEventDefinition {
  id: string;
  feedId: string;
  title: string;
  /** ISO date YYYY-MM-DD or year-specific mapping */
  date: string;
  isAllDay: boolean;
  isPublicHoliday: boolean;
  isObservance: boolean;
  tradition: HolidayTraditionId;
  dateType: DateTypeCategory;
  provisionalNote?: string;
  regionalDifferences?: string;
  description: string;
}

export interface HolidayCalendarFeed {
  id: string;
  category: "country" | "religion" | "other" | "sports";
  countryCode?: string;
  name: string;
  regionOrTradition: string;
  defaultColor: string;
  description: string;
  supportsObservances: boolean;
  provider: string;
  lastUpdated: string;
  disclaimer?: string;
  updateFrequency?: string;
  regionalApplicability?: string;
  events: HolidayEventDefinition[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. BANGLADESH GAZETTED & REGIONAL DATASET (Roadmap Priority Focus)
// ─────────────────────────────────────────────────────────────────────────────
const BANGLADESH_MULTI_YEAR_RAW: {
  slug: string;
  title: string;
  dates: Record<number, string>;
  isPublic: boolean;
  isObservance: boolean;
  dateType: DateTypeCategory;
  provisionalNote?: string;
  regionalDifferences?: string;
  description: string;
}[] = [
  {
    slug: "lang-martyrs",
    title: "Language Martyrs' Day (Shaheed Dibosh & International Mother Language Day)",
    dates: { 2024: "2024-02-21", 2025: "2025-02-21", 2026: "2026-02-21", 2027: "2027-02-21", 2028: "2028-02-21" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "Honors the martyrs of the 1952 Bengali Language Movement, recognized globally by UNESCO as International Mother Language Day.",
  },
  {
    slug: "shab-e-barat",
    title: "Shab-e-Barat (Laylat al-Bara'at)",
    dates: { 2024: "2024-02-26", 2025: "2025-02-15", 2026: "2026-02-04", 2027: "2027-01-24", 2028: "2028-01-13" },
    isPublic: true,
    isObservance: false,
    dateType: "provisional",
    provisionalNote: "Subject to moon sighting by National Moon Sighting Committee of Bangladesh.",
    description: "The Night of Records and Forgiveness, observed with special night prayers, Quran recitation, and charity.",
  },
  {
    slug: "bangabandhu-bday",
    title: "Birthday of the Father of the Nation & National Children's Day",
    dates: { 2024: "2024-03-17", 2025: "2025-03-17", 2026: "2026-03-17", 2027: "2027-03-17", 2028: "2028-03-17" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "Celebrates the birth anniversary of Sheikh Mujibur Rahman and national youth activities across Bangladesh.",
  },
  {
    slug: "genocide-day",
    title: "Genocide Remembrance Day (National Genocide Day)",
    dates: { 2024: "2024-03-25", 2025: "2025-03-25", 2026: "2026-03-25", 2027: "2027-03-25", 2028: "2028-03-25" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Solemn observance commemorating victims of Operation Searchlight on March 25, 1971.",
  },
  {
    slug: "independence-day",
    title: "Independence and National Day",
    dates: { 2024: "2024-03-26", 2025: "2025-03-26", 2026: "2026-03-26", 2027: "2027-03-26", 2028: "2028-03-26" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "Commemorates the declaration of independence of Bangladesh in 1971 with state parades and ceremonies at National Martyrs' Memorial.",
  },
  {
    slug: "shab-e-qadr",
    title: "Laylat al-Qadr (Shab-e-Qadr)",
    dates: { 2024: "2024-04-06", 2025: "2025-03-27", 2026: "2026-03-17", 2027: "2027-03-06", 2028: "2028-02-23" },
    isPublic: true,
    isObservance: false,
    dateType: "provisional",
    provisionalNote: "Subject to moon sighting of Ramadan.",
    description: "Commemorates the holy night the Quran was revealed, observed with extensive overnight prayer.",
  },
  {
    slug: "jumatul-wida",
    title: "Jumatul Wida (Last Friday of Ramadan)",
    dates: { 2024: "2024-04-05", 2025: "2025-03-28", 2026: "2026-03-18", 2027: "2027-03-07", 2028: "2028-02-24" },
    isPublic: true,
    isObservance: false,
    dateType: "provisional",
    description: "The concluding Friday congregation of the sacred month of Ramadan.",
  },
  {
    slug: "eid-ul-fitr",
    title: "Eid-ul-Fitr (Day 1 - Festival of Breaking the Fast)",
    dates: { 2024: "2024-04-11", 2025: "2025-03-31", 2026: "2026-03-20", 2027: "2027-03-10", 2028: "2028-02-28" },
    isPublic: true,
    isObservance: false,
    dateType: "provisional",
    provisionalNote: "Subject to Shawwal crescent sighting.",
    regionalDifferences: "Observed as a 3-day public holiday across Bangladesh.",
    description: "Grand Islamic celebration concluding Ramadan with Eid jamaat, feasts, new clothes, and Fitra charity.",
  },
  {
    slug: "eid-ul-fitr-d2",
    title: "Eid-ul-Fitr (Day 2)",
    dates: { 2024: "2024-04-12", 2025: "2025-04-01", 2026: "2026-03-21", 2027: "2027-03-11", 2028: "2028-02-29" },
    isPublic: true,
    isObservance: false,
    dateType: "provisional",
    description: "Second day of Eid-ul-Fitr celebrations and family visits.",
  },
  {
    slug: "eid-ul-fitr-d3",
    title: "Eid-ul-Fitr (Day 3)",
    dates: { 2024: "2024-04-13", 2025: "2025-04-02", 2026: "2026-03-22", 2027: "2027-03-12", 2028: "2028-03-01" },
    isPublic: true,
    isObservance: false,
    dateType: "provisional",
    description: "Third day of official Eid-ul-Fitr national holiday.",
  },
  {
    slug: "pohela-boishakh",
    title: "Pohela Boishakh (Bengali New Year 1433)",
    dates: { 2024: "2024-04-14", 2025: "2025-04-14", 2026: "2026-04-14", 2027: "2027-04-14", 2028: "2028-04-14" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "The first day of the Bengali solar calendar celebrated with Mangal Shobhajatra processions, Panta Ilish, and cultural fairs.",
  },
  {
    slug: "may-day",
    title: "May Day (International Workers' Day)",
    dates: { 2024: "2024-05-01", 2025: "2025-05-01", 2026: "2026-05-01", 2027: "2027-05-01", 2028: "2028-05-01" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "National public holiday commemorating the international labor movement.",
  },
  {
    slug: "buddha-purnima",
    title: "Buddha Purnima (Vesak)",
    dates: { 2024: "2024-05-22", 2025: "2025-05-12", 2026: "2026-05-19", 2027: "2027-05-20", 2028: "2028-05-08" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "Commemorates the birth, enlightenment, and parinirvana of Gautama Buddha; national gazetted holiday in Bangladesh.",
  },
  {
    slug: "eid-ul-adha",
    title: "Eid-ul-Adha (Day 1 - Feast of Sacrifice)",
    dates: { 2024: "2024-06-17", 2025: "2025-06-07", 2026: "2026-05-27", 2027: "2027-05-17", 2028: "2028-05-05" },
    isPublic: true,
    isObservance: false,
    dateType: "provisional",
    provisionalNote: "Subject to Dhu al-Hijjah crescent sighting.",
    description: "Honors the willingness of Prophet Ibrahim to sacrifice his son in obedience to God; celebrated with Qurbani sacrifice.",
  },
  {
    slug: "eid-ul-adha-d2",
    title: "Eid-ul-Adha (Day 2)",
    dates: { 2024: "2024-06-18", 2025: "2025-06-08", 2026: "2026-05-28", 2027: "2027-05-18", 2028: "2028-05-06" },
    isPublic: true,
    isObservance: false,
    dateType: "provisional",
    description: "Second day of Eid-ul-Adha public holiday.",
  },
  {
    slug: "eid-ul-adha-d3",
    title: "Eid-ul-Adha (Day 3)",
    dates: { 2024: "2024-06-19", 2025: "2025-06-09", 2026: "2026-05-29", 2027: "2027-05-19", 2028: "2028-05-07" },
    isPublic: true,
    isObservance: false,
    dateType: "provisional",
    description: "Third day of Eid-ul-Adha public holiday.",
  },
  {
    slug: "ashura",
    title: "Ashura (10th Muharram)",
    dates: { 2024: "2024-07-17", 2025: "2025-07-06", 2026: "2026-06-25", 2027: "2027-06-15", 2028: "2028-06-03" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "Holy day observing voluntary fasting, the deliverance of Moses, and martyrdom of Imam Husayn at Karbala.",
  },
  {
    slug: "mourning-day",
    title: "National Mourning Day",
    dates: { 2024: "2024-08-15", 2025: "2025-08-15", 2026: "2026-08-15", 2027: "2027-08-15", 2028: "2028-08-15" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "Observed in memory of the tragic events of August 15, 1975.",
  },
  {
    slug: "janmashtami",
    title: "Krishna Janmashtami",
    dates: { 2024: "2024-08-26", 2025: "2025-08-16", 2026: "2026-08-24", 2027: "2027-08-25", 2028: "2028-08-13" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "Celebration of the birth anniversary of Lord Krishna with grand processions at Dhakeshwari National Temple.",
  },
  {
    slug: "eid-milad",
    title: "Eid Milad-un-Nabi (Mawlid al-Nabi)",
    dates: { 2024: "2024-09-16", 2025: "2025-09-05", 2026: "2026-08-25", 2027: "2027-08-15", 2028: "2028-08-03" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "National public holiday celebrating the birth and life of Prophet Muhammad.",
  },
  {
    slug: "durga-puja",
    title: "Durga Puja (Bijoya Dashami)",
    dates: { 2024: "2024-10-13", 2025: "2025-10-02", 2026: "2026-10-08", 2027: "2027-10-10", 2028: "2028-09-29" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "The grandest Hindu festival in Bangladesh, culminating in idol immersion rituals at Sadarghat and Buriganga River.",
  },
  {
    slug: "armed-forces-day",
    title: "Armed Forces Day",
    dates: { 2024: "2024-11-21", 2025: "2025-11-21", 2026: "2026-11-21", 2027: "2027-11-21", 2028: "2028-11-21" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "National observance marking the joint operations of Bangladesh Army, Navy, and Air Force in 1971.",
  },
  {
    slug: "martyred-intellectuals",
    title: "Martyred Intellectuals Day (Shaheed Buddhijibi Dibosh)",
    dates: { 2024: "2024-12-14", 2025: "2025-12-14", 2026: "2026-12-14", 2027: "2027-12-14", 2028: "2028-12-14" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Solemn observance commemorating intellectuals and scholars martyred in December 1971.",
  },
  {
    slug: "victory-day",
    title: "Victory Day (Bijoy Dibosh)",
    dates: { 2024: "2024-12-16", 2025: "2025-12-16", 2026: "2026-12-16", 2027: "2027-12-16", 2028: "2028-12-16" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "Commemorates the surrender of occupying forces on December 16, 1971, concluding the Liberation War of Bangladesh.",
  },
  {
    slug: "christmas-day",
    title: "Christmas Day (Boro Din)",
    dates: { 2024: "2024-12-25", 2025: "2025-12-25", 2026: "2026-12-25", 2027: "2027-12-25", 2028: "2028-12-25" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "National public holiday celebrating Christmas across Bangladesh.",
  },
];

function generateBangladeshEventsForYear(year: number): HolidayEventDefinition[] {
  return BANGLADESH_MULTI_YEAR_RAW.filter((item) => item.dates[year] !== undefined).map((item) => {
    return {
      id: `bd-${item.slug}-${year}`,
      feedId: "holiday-bd",
      title: item.title,
      date: item.dates[year],
      isAllDay: true,
      isPublicHoliday: item.isPublic,
      isObservance: item.isObservance,
      tradition: "national",
      dateType: item.dateType,
      provisionalNote: item.provisionalNote,
      regionalDifferences: item.regionalDifferences,
      description: item.description,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ISLAMIC RELIGIOUS HOLIDAYS (Hijri Lunisolar Calculations)
// ─────────────────────────────────────────────────────────────────────────────
const ISLAMIC_MULTI_YEAR_RAW: {
  slug: string;
  title: string;
  dates: Record<number, string>;
  isPublic: boolean;
  isObservance: boolean;
  dateType: DateTypeCategory;
  provisionalNote?: string;
  regionalDifferences?: string;
  description: string;
}[] = [
  {
    slug: "ramadan-start",
    title: "First Day of Ramadan (Fasting Begins)",
    dates: { 2024: "2024-03-11", 2025: "2025-03-01", 2026: "2026-02-18", 2027: "2027-02-08", 2028: "2028-01-28" },
    isPublic: false,
    isObservance: true,
    dateType: "provisional",
    provisionalNote: "Subject to confirmation by national crescent moon sighting committees.",
    regionalDifferences: "May begin a day earlier or later depending on regional sunset visibility.",
    description: "Marks commencement of the holy month of fasting (Sawm) from dawn until dusk, Quranic contemplation, and charitable giving.",
  },
  {
    slug: "shab-e-qadr",
    title: "Laylat al-Qadr (Shab-e-Qadr / Night of Power)",
    dates: { 2024: "2024-04-06", 2025: "2025-03-26", 2026: "2026-03-16", 2027: "2027-03-05", 2028: "2028-02-23" },
    isPublic: false,
    isObservance: true,
    dateType: "provisional",
    provisionalNote: "Traditional observance during the 27th night of Ramadan.",
    description: "Commemorates the night the first verses of the Quran were revealed to Prophet Muhammad.",
  },
  {
    slug: "eid-ul-fitr",
    title: "Eid-ul-Fitr (Festival of Breaking the Fast)",
    dates: { 2024: "2024-04-10", 2025: "2025-03-30", 2026: "2026-03-20", 2027: "2027-03-09", 2028: "2028-02-27" },
    isPublic: true,
    isObservance: false,
    dateType: "provisional",
    provisionalNote: "Subject to the sighting of the Shawwal crescent moon.",
    regionalDifferences: "Observed for 3 days; official gazetted public holiday across Muslim-majority nations.",
    description: "Celebration marking the conclusion of Ramadan with morning prayers, feasts, and charity (Zakat al-Fitr).",
  },
  {
    slug: "arafah",
    title: "Day of Arafah (Hajj Culmination)",
    dates: { 2024: "2024-06-15", 2025: "2025-06-05", 2026: "2026-05-26", 2027: "2027-05-16", 2028: "2028-05-04" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    provisionalNote: "Aligned with Hajj pilgrimages in Makkah (9th Dhu al-Hijjah).",
    description: "The holiest day of the Islamic year where pilgrims gather on the plains of Mount Arafat in prayer.",
  },
  {
    slug: "eid-ul-adha",
    title: "Eid-ul-Adha (Feast of the Sacrifice)",
    dates: { 2024: "2024-06-16", 2025: "2025-06-06", 2026: "2026-05-27", 2027: "2027-05-17", 2028: "2028-05-05" },
    isPublic: true,
    isObservance: false,
    dateType: "provisional",
    provisionalNote: "Commences on 10th Dhu al-Hijjah following moon sighting.",
    regionalDifferences: "Celebrated across 3 to 4 days with animal sacrifice (Qurbani) and distribution to the poor.",
    description: "Honors the willingness of Prophet Ibrahim to sacrifice his son in obedience to God.",
  },
  {
    slug: "new-year",
    title: "Islamic New Year (1st Muharram)",
    dates: { 2024: "2024-07-07", 2025: "2025-06-26", 2026: "2026-06-16", 2027: "2027-06-06", 2028: "2028-05-25" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Marks the arrival of the new Islamic lunar year and the historic Hijra from Makkah to Madinah.",
  },
  {
    slug: "ashura",
    title: "Ashura (10th Muharram)",
    dates: { 2024: "2024-07-16", 2025: "2025-07-05", 2026: "2026-06-25", 2027: "2027-06-15", 2028: "2028-06-03" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "A day of voluntary fasting, remembering the liberation of Moses and the martyrdom of Imam Husayn at Karbala.",
  },
  {
    slug: "mawlid",
    title: "Eid Milad-un-Nabi (Mawlid al-Nabi)",
    dates: { 2024: "2024-09-15", 2025: "2025-09-04", 2026: "2026-08-25", 2027: "2027-08-14", 2028: "2028-08-02" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    regionalDifferences: "Observed on 12th Rabi' al-Awwal in Sunni traditions and 17th in Shia traditions.",
    description: "Observance of the birth anniversary of Prophet Muhammad.",
  },
  {
    slug: "shab-e-barat",
    title: "Shab-e-Barat (Mid-Sha'ban / Laylat al-Bara'at)",
    dates: { 2024: "2024-02-25", 2025: "2025-02-14", 2026: "2026-02-03", 2027: "2027-01-23", 2028: "2028-01-12" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Night of records and forgiveness, observed on the 15th of Sha'ban.",
  },
  {
    slug: "isra-miraj",
    title: "Isra and Mi'raj (The Night Journey & Ascension)",
    dates: { 2024: "2024-02-08", 2025: "2025-01-27", 2026: "2026-01-16", 2027: "2027-01-06", 2028: "2028-12-25" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Commemorates the miraculous night journey of Prophet Muhammad from Makkah to Jerusalem and heaven.",
  },
];

function generateIslamicEventsForYear(year: number): HolidayEventDefinition[] {
  return ISLAMIC_MULTI_YEAR_RAW.filter((item) => item.dates[year] !== undefined).map((item) => {
    return {
      id: `islam-${item.slug}-${year}`,
      feedId: "religion-islam",
      title: item.title,
      date: item.dates[year],
      isAllDay: true,
      isPublicHoliday: item.isPublic,
      isObservance: item.isObservance,
      tradition: "islam",
      dateType: item.dateType,
      provisionalNote: item.provisionalNote,
      regionalDifferences: item.regionalDifferences,
      description: item.description,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. CHRISTIAN HOLIDAYS (Western & Ecumenical)
// ─────────────────────────────────────────────────────────────────────────────
const CHRISTIAN_MULTI_YEAR_RAW: {
  slug: string;
  title: string;
  dates: Record<number, string>;
  isPublic: boolean;
  isObservance: boolean;
  dateType: DateTypeCategory;
  description: string;
}[] = [
  {
    slug: "epiphany",
    title: "Epiphany (Three Kings' Day)",
    dates: { 2024: "2024-01-06", 2025: "2025-01-06", 2026: "2026-01-06", 2027: "2027-01-06", 2028: "2028-01-06" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Commemorates the manifestation of Christ to the Gentiles represented by the Magi.",
  },
  {
    slug: "ash-wednesday",
    title: "Ash Wednesday",
    dates: { 2024: "2024-02-14", 2025: "2025-03-05", 2026: "2026-02-18", 2027: "2027-02-10", 2028: "2028-03-01" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "First day of Lent, observed by fasting and prayer with the imposition of ashes.",
  },
  {
    slug: "palm-sunday",
    title: "Palm Sunday",
    dates: { 2024: "2024-03-24", 2025: "2025-04-13", 2026: "2026-03-29", 2027: "2027-03-21", 2028: "2028-04-09" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Commemorates Jesus' triumphal entry into Jerusalem, opening Holy Week.",
  },
  {
    slug: "maundy-thursday",
    title: "Maundy Thursday (Holy Thursday)",
    dates: { 2024: "2024-03-28", 2025: "2025-04-17", 2026: "2026-04-02", 2027: "2027-03-25", 2028: "2028-04-13" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Commemorates the Last Supper of Jesus Christ with the Apostles and the washing of feet.",
  },
  {
    slug: "good-friday",
    title: "Good Friday",
    dates: { 2024: "2024-03-29", 2025: "2025-04-18", 2026: "2026-04-03", 2027: "2027-03-26", 2028: "2028-04-14" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "Commemorates the crucifixion and death of Jesus Christ at Calvary.",
  },
  {
    slug: "holy-saturday",
    title: "Holy Saturday (Easter Eve)",
    dates: { 2024: "2024-03-30", 2025: "2025-04-19", 2026: "2026-04-04", 2027: "2027-03-27", 2028: "2028-04-15" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Commemorates the day Jesus lay in the tomb and the descent into hell.",
  },
  {
    slug: "easter-sunday",
    title: "Easter Sunday (The Resurrection of the Lord)",
    dates: { 2024: "2024-03-31", 2025: "2025-04-20", 2026: "2026-04-05", 2027: "2027-03-28", 2028: "2028-04-16" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "The primary festival of the Christian year celebrating the resurrection of Jesus Christ from the dead.",
  },
  {
    slug: "easter-monday",
    title: "Easter Monday",
    dates: { 2024: "2024-04-01", 2025: "2025-04-21", 2026: "2026-04-06", 2027: "2027-03-29", 2028: "2028-04-17" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "Day following Easter Sunday, widely celebrated as a public or bank holiday.",
  },
  {
    slug: "ascension",
    title: "Ascension of Jesus",
    dates: { 2024: "2024-05-09", 2025: "2025-05-29", 2026: "2026-05-14", 2027: "2027-05-06", 2028: "2028-05-25" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Celebrated on the 40th day after Easter, commemorating the ascension of Jesus into heaven.",
  },
  {
    slug: "pentecost",
    title: "Pentecost (Whit Sunday)",
    dates: { 2024: "2024-05-19", 2025: "2025-06-08", 2026: "2026-05-24", 2027: "2027-05-16", 2028: "2028-06-04" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Commemorates the descent of the Holy Spirit upon the Apostles and disciples.",
  },
  {
    slug: "corpus-christi",
    title: "Corpus Christi (Most Holy Body and Blood of Christ)",
    dates: { 2024: "2024-05-30", 2025: "2025-06-19", 2026: "2026-06-04", 2027: "2027-05-27", 2028: "2028-06-15" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Solemnity celebrating the real presence of the body and blood of Jesus Christ in the Eucharist.",
  },
  {
    slug: "assumption",
    title: "Assumption of Mary",
    dates: { 2024: "2024-08-15", 2025: "2025-08-15", 2026: "2026-08-15", 2027: "2027-08-15", 2028: "2028-08-15" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Christian feast day commemorating the bodily taking up of the Virgin Mary into heaven.",
  },
  {
    slug: "all-saints",
    title: "All Saints' Day",
    dates: { 2024: "2024-11-01", 2025: "2025-11-01", 2026: "2026-11-01", 2027: "2027-11-01", 2028: "2028-11-01" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Solemnity in honor of all Christian saints and martyrs.",
  },
  {
    slug: "all-souls",
    title: "All Souls' Day",
    dates: { 2024: "2024-11-02", 2025: "2025-11-02", 2026: "2026-11-02", 2027: "2027-11-02", 2028: "2028-11-02" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Day of prayer and remembrance for the faithful departed.",
  },
  {
    slug: "advent-1",
    title: "First Sunday of Advent",
    dates: { 2024: "2024-12-01", 2025: "2025-11-30", 2026: "2026-11-29", 2027: "2027-11-28", 2028: "2028-12-03" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Beginning of the liturgical year and season of preparation for Christmas.",
  },
  {
    slug: "christmas-eve",
    title: "Christmas Eve",
    dates: { 2024: "2024-12-24", 2025: "2025-12-24", 2026: "2026-12-24", 2027: "2027-12-24", 2028: "2028-12-24" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "The evening or day before Christmas Day celebrating the Nativity of Jesus.",
  },
  {
    slug: "christmas-day",
    title: "Christmas Day",
    dates: { 2024: "2024-12-25", 2025: "2025-12-25", 2026: "2026-12-25", 2027: "2027-12-25", 2028: "2028-12-25" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "Annual Christian commemoration of the birth of Jesus Christ.",
  },
  {
    slug: "boxing-day",
    title: "Saint Stephen's Day / Boxing Day",
    dates: { 2024: "2024-12-26", 2025: "2025-12-26", 2026: "2026-12-26", 2027: "2027-12-26", 2028: "2028-12-26" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "Feast of Saint Stephen, the first Christian martyr.",
  },
];

function generateChristianEventsForYear(year: number): HolidayEventDefinition[] {
  return CHRISTIAN_MULTI_YEAR_RAW.filter((item) => item.dates[year] !== undefined).map((item) => {
    return {
      id: `chris-${item.slug}-${year}`,
      feedId: "religion-christianity",
      title: item.title,
      date: item.dates[year],
      isAllDay: true,
      isPublicHoliday: item.isPublic,
      isObservance: item.isObservance,
      tradition: "christianity",
      dateType: item.dateType,
      description: item.description,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. ORTHODOX CHRISTIAN HOLIDAYS (Eastern Orthodox / Julian Paschalion)
// ─────────────────────────────────────────────────────────────────────────────
const ORTHODOX_MULTI_YEAR_RAW: {
  slug: string;
  title: string;
  dates: Record<number, string>;
  isPublic: boolean;
  isObservance: boolean;
  dateType: DateTypeCategory;
  description: string;
}[] = [
  {
    slug: "orthodox-xmas-eve",
    title: "Orthodox Christmas Eve",
    dates: { 2024: "2024-01-06", 2025: "2025-01-06", 2026: "2026-01-06", 2027: "2027-01-06", 2028: "2028-01-06" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Holy Eve of the Nativity of Christ according to the Julian liturgical calendar.",
  },
  {
    slug: "orthodox-xmas",
    title: "Orthodox Christmas Day (Nativity of Christ)",
    dates: { 2024: "2024-01-07", 2025: "2025-01-07", 2026: "2026-01-07", 2027: "2027-01-07", 2028: "2028-01-07" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "Celebration of the birth of Jesus Christ in the Eastern Orthodox Church.",
  },
  {
    slug: "orthodox-theophany",
    title: "Theophany / Epiphany (Baptism of the Lord)",
    dates: { 2024: "2024-01-19", 2025: "2025-01-19", 2026: "2026-01-19", 2027: "2027-01-19", 2028: "2028-01-19" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "Feast of the Great Blessing of the Waters and baptism of Jesus in the Jordan River.",
  },
  {
    slug: "clean-monday",
    title: "Clean Monday (Great Lent Begins)",
    dates: { 2024: "2024-03-18", 2025: "2025-03-03", 2026: "2026-02-23", 2027: "2027-03-15", 2028: "2028-02-28" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Commencement of the 40-day Great Lent preceding Holy Pascha.",
  },
  {
    slug: "orthodox-palm-sunday",
    title: "Orthodox Palm Sunday (Entry into Jerusalem)",
    dates: { 2024: "2024-04-28", 2025: "2025-04-13", 2026: "2026-04-05", 2027: "2027-04-25", 2028: "2028-04-09" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Commemorates the triumphal entry of Jesus into Jerusalem before His passion.",
  },
  {
    slug: "orthodox-good-friday",
    title: "Orthodox Great and Holy Friday",
    dates: { 2024: "2024-05-03", 2025: "2025-04-18", 2026: "2026-04-10", 2027: "2027-04-30", 2028: "2028-04-14" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "Commemoration of the suffering, crucifixion, and death of Jesus Christ on the cross.",
  },
  {
    slug: "orthodox-pascha",
    title: "Orthodox Easter Sunday (Holy Pascha)",
    dates: { 2024: "2024-05-05", 2025: "2025-04-20", 2026: "2026-04-12", 2027: "2027-05-02", 2028: "2028-04-16" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "The Feast of Feasts celebrating the glorious resurrection of Jesus Christ according to the Julian Paschal computus.",
  },
  {
    slug: "orthodox-bright-monday",
    title: "Orthodox Bright Monday",
    dates: { 2024: "2024-05-06", 2025: "2025-04-21", 2026: "2026-04-13", 2027: "2027-05-03", 2028: "2028-04-17" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "The day after Holy Pascha marking the beginning of Bright Week.",
  },
  {
    slug: "orthodox-ascension",
    title: "Orthodox Ascension of Christ",
    dates: { 2024: "2024-06-13", 2025: "2025-05-29", 2026: "2026-05-21", 2027: "2027-06-10", 2028: "2028-05-25" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "The 40th day after Pascha celebrating Christ's bodily ascension into heaven.",
  },
  {
    slug: "orthodox-pentecost",
    title: "Orthodox Pentecost (Holy Trinity Day)",
    dates: { 2024: "2024-06-23", 2025: "2025-06-08", 2026: "2026-05-31", 2027: "2027-06-20", 2028: "2028-06-04" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "The 50th day after Pascha celebrating the descent of the Holy Spirit on the Apostles.",
  },
  {
    slug: "dormition",
    title: "Dormition of the Theotokos",
    dates: { 2024: "2024-08-28", 2025: "2025-08-28", 2026: "2026-08-28", 2027: "2027-08-28", 2028: "2028-08-28" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Great feast commemorating the falling asleep and assumption of the Mother of God.",
  },
];

function generateOrthodoxEventsForYear(year: number): HolidayEventDefinition[] {
  return ORTHODOX_MULTI_YEAR_RAW.filter((item) => item.dates[year] !== undefined).map((item) => {
    return {
      id: `ortho-${item.slug}-${year}`,
      feedId: "religion-orthodox",
      title: item.title,
      date: item.dates[year],
      isAllDay: true,
      isPublicHoliday: item.isPublic,
      isObservance: item.isObservance,
      tradition: "orthodox",
      dateType: item.dateType,
      description: item.description,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. JEWISH HOLIDAYS (Hebrew Calendar Lunisolar Computations)
// ─────────────────────────────────────────────────────────────────────────────
const JEWISH_MULTI_YEAR_RAW: {
  slug: string;
  title: string;
  dates: Record<number, string>;
  isPublic: boolean;
  isObservance: boolean;
  dateType: DateTypeCategory;
  description: string;
}[] = [
  {
    slug: "purim",
    title: "Purim (Feast of Lots)",
    dates: { 2024: "2024-03-24", 2025: "2025-03-14", 2026: "2026-03-03", 2027: "2027-03-23", 2028: "2028-03-12" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Celebrates the salvation of the Jewish people from Haman's plot as recorded in the Book of Esther.",
  },
  {
    slug: "passover",
    title: "Passover (Pesach - Day 1)",
    dates: { 2024: "2024-04-23", 2025: "2025-04-13", 2026: "2026-04-02", 2027: "2027-04-22", 2028: "2028-04-11" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "Major biblical festival celebrating the liberation of the Israelites from slavery in ancient Egypt.",
  },
  {
    slug: "shavuot",
    title: "Shavuot (Feast of Weeks)",
    dates: { 2024: "2024-06-12", 2025: "2025-06-02", 2026: "2026-05-22", 2027: "2027-06-11", 2028: "2028-05-31" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "Commemorates the revelation of the Torah at Mount Sinai to the assembled Jewish nation.",
  },
  {
    slug: "tisha-bav",
    title: "Tisha B'Av (The Ninth of Av)",
    dates: { 2024: "2024-08-13", 2025: "2025-08-03", 2026: "2026-07-23", 2027: "2027-08-12", 2028: "2028-08-01" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Annual fast day mourning the destruction of the First and Second Temples in Jerusalem.",
  },
  {
    slug: "rosh-hashanah",
    title: "Rosh Hashanah (Jewish New Year)",
    dates: { 2024: "2024-10-03", 2025: "2025-09-23", 2026: "2026-09-12", 2027: "2027-10-02", 2028: "2028-09-21" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "The Jewish New Year, marked by the sounding of the Shofar and solemn introspection.",
  },
  {
    slug: "yom-kippur",
    title: "Yom Kippur (Day of Atonement)",
    dates: { 2024: "2024-10-12", 2025: "2025-10-02", 2026: "2026-09-21", 2027: "2027-10-11", 2028: "2028-09-30" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "The holiest day in Judaism, observed with a strict 25-hour fast and intensive prayer for forgiveness.",
  },
  {
    slug: "sukkot",
    title: "Sukkot (Feast of Tabernacles)",
    dates: { 2024: "2024-10-17", 2025: "2025-10-07", 2026: "2026-09-26", 2027: "2027-10-16", 2028: "2028-10-05" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "Week-long autumn festival commemorating the 40 years of wandering in the wilderness.",
  },
  {
    slug: "hanukkah",
    title: "Hanukkah (Festival of Lights - Day 1)",
    dates: { 2024: "2024-12-26", 2025: "2025-12-15", 2026: "2026-12-05", 2027: "2027-12-25", 2028: "2028-12-13" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Eight-day festival of lights commemorating the rededication of the Second Temple in Jerusalem.",
  },
];

function generateJewishEventsForYear(year: number): HolidayEventDefinition[] {
  return JEWISH_MULTI_YEAR_RAW.filter((item) => item.dates[year] !== undefined).map((item) => {
    return {
      id: `jewish-${item.slug}-${year}`,
      feedId: "religion-judaism",
      title: item.title,
      date: item.dates[year],
      isAllDay: true,
      isPublicHoliday: item.isPublic,
      isObservance: item.isObservance,
      tradition: "judaism",
      dateType: item.dateType,
      description: item.description,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. HINDU FESTIVALS (Panchang / Vikram Samvat Lunar Tithi)
// ─────────────────────────────────────────────────────────────────────────────
const HINDU_MULTI_YEAR_RAW: {
  slug: string;
  title: string;
  dates: Record<number, string>;
  isPublic: boolean;
  isObservance: boolean;
  dateType: DateTypeCategory;
  description: string;
}[] = [
  {
    slug: "sankranti",
    title: "Makar Sankranti / Pongal",
    dates: { 2024: "2024-01-15", 2025: "2025-01-14", 2026: "2026-01-14", 2027: "2027-01-15", 2028: "2028-01-15" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "Solar festival marking the transition of the Sun into Capricorn (Makara), celebrating the winter harvest.",
  },
  {
    slug: "shivaratri",
    title: "Maha Shivaratri",
    dates: { 2024: "2024-03-08", 2025: "2025-02-26", 2026: "2026-02-15", 2027: "2027-03-06", 2028: "2028-02-24" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "The Great Night of Shiva, celebrated with overnight fasting, meditation, and lingam offerings.",
  },
  {
    slug: "holi",
    title: "Holi (Festival of Colours & Doljatra)",
    dates: { 2024: "2024-03-25", 2025: "2025-03-14", 2026: "2026-03-04", 2027: "2027-03-22", 2028: "2028-03-11" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "Spring festival of love, forgiveness, and victory of good over evil, celebrated with vibrant colored powders.",
  },
  {
    slug: "rama-navami",
    title: "Rama Navami",
    dates: { 2024: "2024-04-17", 2025: "2025-04-06", 2026: "2026-03-27", 2027: "2027-04-15", 2028: "2028-04-03" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Celebrates the birth anniversary of Lord Rama, the seventh avatar of Vishnu.",
  },
  {
    slug: "raksha-bandhan",
    title: "Raksha Bandhan",
    dates: { 2024: "2024-08-19", 2025: "2025-08-09", 2026: "2026-08-28", 2027: "2027-08-17", 2028: "2028-08-05" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Celebration of the sacred bond of protection and affection between brothers and sisters.",
  },
  {
    slug: "janmashtami",
    title: "Krishna Janmashtami",
    dates: { 2024: "2024-08-26", 2025: "2025-08-16", 2026: "2026-09-03", 2027: "2027-08-25", 2028: "2028-08-13" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "Annual Hindu festival celebrating the birth of Lord Krishna.",
  },
  {
    slug: "ganesh-chaturthi",
    title: "Ganesh Chaturthi (Vinayaka Chavithi)",
    dates: { 2024: "2024-09-07", 2025: "2025-08-27", 2026: "2026-09-14", 2027: "2027-09-04", 2028: "2028-08-24" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "Grand festival celebrating the arrival of Lord Ganesha, the remover of obstacles.",
  },
  {
    slug: "navratri",
    title: "Sharad Navratri Begins (Day 1)",
    dates: { 2024: "2024-10-03", 2025: "2025-09-22", 2026: "2026-10-11", 2027: "2027-09-30", 2028: "2028-10-19" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Nine nights dedicated to the divine feminine Shakti and nine forms of Goddess Durga.",
  },
  {
    slug: "durga-puja",
    title: "Durga Puja (Maha Saptami to Vijaya Dashami)",
    dates: { 2024: "2024-10-10", 2025: "2025-10-01", 2026: "2026-10-17", 2027: "2027-10-08", 2028: "2028-09-27" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "Celebrates the victory of Goddess Durga over the demon Mahishasura.",
  },
  {
    slug: "diwali",
    title: "Diwali (Deepavali & Kali Puja)",
    dates: { 2024: "2024-11-01", 2025: "2025-10-20", 2026: "2026-11-08", 2027: "2027-10-29", 2028: "2028-10-17" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "The Festival of Lights, symbolizing the spiritual victory of light over darkness and knowledge over ignorance.",
  },
];

function generateHinduEventsForYear(year: number): HolidayEventDefinition[] {
  return HINDU_MULTI_YEAR_RAW.filter((item) => item.dates[year] !== undefined).map((item) => {
    return {
      id: `hindu-${item.slug}-${year}`,
      feedId: "religion-hinduism",
      title: item.title,
      date: item.dates[year],
      isAllDay: true,
      isPublicHoliday: item.isPublic,
      isObservance: item.isObservance,
      tradition: "hinduism",
      dateType: item.dateType,
      description: item.description,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. BUDDHIST HOLIDAYS (Theravada & Mahayana Full Moon Uposatha)
// ─────────────────────────────────────────────────────────────────────────────
const BUDDHIST_MULTI_YEAR_RAW: {
  slug: string;
  title: string;
  dates: Record<number, string>;
  isPublic: boolean;
  isObservance: boolean;
  dateType: DateTypeCategory;
  description: string;
}[] = [
  {
    slug: "magha-puja",
    title: "Magha Puja (Fourfold Assembly Day)",
    dates: { 2024: "2024-02-24", 2025: "2025-02-12", 2026: "2026-03-03", 2027: "2027-02-21", 2028: "2028-02-10" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Commemorates the spontaneous gathering of 1,250 enlightened monks to hear the Ovada Patimokkha discourse.",
  },
  {
    slug: "songkran",
    title: "Songkran / Theravada Buddhist New Year",
    dates: { 2024: "2024-04-13", 2025: "2025-04-13", 2026: "2026-04-13", 2027: "2027-04-13", 2028: "2028-04-13" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "Traditional solar new year celebrated across Southeast Asian Buddhist nations with water cleansing rituals.",
  },
  {
    slug: "vesak",
    title: "Vesak (Buddha Purnima / Day of the Full Moon)",
    dates: { 2024: "2024-05-23", 2025: "2025-05-12", 2026: "2026-05-31", 2027: "2027-05-20", 2028: "2028-05-08" },
    isPublic: true,
    isObservance: false,
    dateType: "calculated",
    description: "The holiest day in Buddhism celebrating the birth, supreme enlightenment (Bodhi), and passing (Parinirvana) of Gautama Buddha.",
  },
  {
    slug: "asalha-puja",
    title: "Asalha Puja (Dharma Day)",
    dates: { 2024: "2024-07-20", 2025: "2025-07-10", 2026: "2026-07-29", 2027: "2027-07-18", 2028: "2028-07-07" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Commemorates the Buddha's first sermon, setting into motion the Wheel of Dharma.",
  },
  {
    slug: "pavarana",
    title: "Pavarana (End of Vassa Rains Retreat)",
    dates: { 2024: "2024-10-17", 2025: "2025-10-06", 2026: "2026-10-25", 2027: "2027-10-14", 2028: "2028-10-03" },
    isPublic: false,
    isObservance: true,
    dateType: "calculated",
    description: "Marks the conclusion of the three-month monsoon monastic retreat.",
  },
  {
    slug: "bodhi-day",
    title: "Bodhi Day (Rohatsu)",
    dates: { 2024: "2024-12-08", 2025: "2025-12-08", 2026: "2026-12-08", 2027: "2027-12-08", 2028: "2028-12-08" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Commemorates the day Siddhartha Gautama achieved supreme awakening under the Bodhi tree.",
  },
];

function generateBuddhistEventsForYear(year: number): HolidayEventDefinition[] {
  return BUDDHIST_MULTI_YEAR_RAW.filter((item) => item.dates[year] !== undefined).map((item) => {
    return {
      id: `buddh-${item.slug}-${year}`,
      feedId: "religion-buddhism",
      title: item.title,
      date: item.dates[year],
      isAllDay: true,
      isPublicHoliday: item.isPublic,
      isObservance: item.isObservance,
      tradition: "buddhism",
      dateType: item.dateType,
      description: item.description,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. SHINTO & EAST ASIAN TRADITIONAL OBSERVANCES
// ─────────────────────────────────────────────────────────────────────────────
const SHINTO_MULTI_YEAR_RAW: {
  slug: string;
  title: string;
  dates: Record<number, string>;
  isPublic: boolean;
  isObservance: boolean;
  dateType: DateTypeCategory;
  description: string;
}[] = [
  {
    slug: "shogatsu",
    title: "Shogatsu (Japanese New Year)",
    dates: { 2024: "2024-01-01", 2025: "2025-01-01", 2026: "2026-01-01", 2027: "2027-01-01", 2028: "2028-01-01" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "Traditional Japanese New Year festival featuring Hatsumode shrine visits and family gatherings.",
  },
  {
    slug: "setsubun",
    title: "Setsubun (Bean-Throwing Festival)",
    dates: { 2024: "2024-02-03", 2025: "2025-02-03", 2026: "2026-02-03", 2027: "2027-02-03", 2028: "2028-02-03" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Shinto eve of spring ritual driving away evil spirits and welcoming good fortune.",
  },
  {
    slug: "hinamatsuri",
    title: "Hinamatsuri (Doll Festival / Girls' Day)",
    dates: { 2024: "2024-03-03", 2025: "2025-03-03", 2026: "2026-03-03", 2027: "2027-03-03", 2028: "2028-03-03" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Celebration praying for the health and happiness of young girls with elaborate tiered doll displays.",
  },
  {
    slug: "kodomo-no-hi",
    title: "Kodomo no Hi (Children's Day)",
    dates: { 2024: "2024-05-05", 2025: "2025-05-05", 2026: "2026-05-05", 2027: "2027-05-05", 2028: "2028-05-05" },
    isPublic: true,
    isObservance: false,
    dateType: "fixed",
    description: "National holiday celebrating children's personalities and happiness, celebrated with flying carp streamers (koinobori).",
  },
  {
    slug: "tanabata",
    title: "Tanabata (Star Festival)",
    dates: { 2024: "2024-07-07", 2025: "2025-07-07", 2026: "2026-07-07", 2027: "2027-07-07", 2028: "2028-07-07" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Celebrates the annual celestial reunion of lovers Orihime and Hikoboshi across the Milky Way.",
  },
  {
    slug: "obon",
    title: "Obon (Festival of the Ancestors)",
    dates: { 2024: "2024-08-15", 2025: "2025-08-15", 2026: "2026-08-15", 2027: "2027-08-15", 2028: "2028-08-15" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Traditional summer Buddhist-Shinto custom of welcoming, honoring, and guiding the spirits of ancestors.",
  },
  {
    slug: "shichi-go-san",
    title: "Shichi-Go-San (Seven-Five-Three Day)",
    dates: { 2024: "2024-11-15", 2025: "2025-11-15", 2026: "2026-11-15", 2027: "2027-11-15", 2028: "2028-11-15" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Traditional Shinto rite of passage festival for three- and seven-year-old girls and five-year-old boys.",
  },
  {
    slug: "omisoka",
    title: "Omisoka (New Year's Eve)",
    dates: { 2024: "2024-12-31", 2025: "2025-12-31", 2026: "2026-12-31", 2027: "2027-12-31", 2028: "2028-12-31" },
    isPublic: false,
    isObservance: true,
    dateType: "fixed",
    description: "Final day of the Japanese year, celebrated with Toshikoshi soba noodles and Joya no Kane temple bells.",
  },
];

function generateShintoEventsForYear(year: number): HolidayEventDefinition[] {
  return SHINTO_MULTI_YEAR_RAW.filter((item) => item.dates[year] !== undefined).map((item) => {
    return {
      id: `shinto-${item.slug}-${year}`,
      feedId: "religion-shinto",
      title: item.title,
      date: item.dates[year],
      isAllDay: true,
      isPublicHoliday: item.isPublic,
      isObservance: item.isObservance,
      tradition: "shinto",
      dateType: item.dateType,
      description: item.description,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. PHASES OF THE MOON (Astronomical Lunar Phases)
// ─────────────────────────────────────────────────────────────────────────────
function generateMoonPhasesForYear(year: number): HolidayEventDefinition[] {
  const events: HolidayEventDefinition[] = [];
  // Known reference New Moon: 2025-01-29 12:36 UTC
  const refTime = Date.UTC(2025, 0, 29, 12, 36, 0);
  const synodicMonthMs = 29.53058867 * 86400 * 1000;

  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year, 11, 31, 23, 59, 59);

  // Approximate cycle count from ref
  const startCycle = Math.floor((yearStart - refTime) / synodicMonthMs) - 1;
  const endCycle = Math.ceil((yearEnd - refTime) / synodicMonthMs) + 1;

  for (let c = startCycle; c <= endCycle; c++) {
    const newMoonTime = refTime + c * synodicMonthMs;
    const firstQuarterTime = newMoonTime + 0.25 * synodicMonthMs;
    const fullMoonTime = newMoonTime + 0.5 * synodicMonthMs;
    const thirdQuarterTime = newMoonTime + 0.75 * synodicMonthMs;

    const phases = [
      { name: "New Moon", icon: "🌑", time: newMoonTime, slug: "new-moon" },
      { name: "First Quarter Moon", icon: "🌓", time: firstQuarterTime, slug: "first-quarter" },
      { name: "Full Moon", icon: "🌕", time: fullMoonTime, slug: "full-moon" },
      { name: "Third Quarter Moon", icon: "🌗", time: thirdQuarterTime, slug: "third-quarter" },
    ];

    for (const p of phases) {
      if (p.time >= yearStart && p.time <= yearEnd) {
        const d = new Date(p.time);
        const iso = d.toISOString().slice(0, 10);
        events.push({
          id: `moon-${p.slug}-${iso}`,
          feedId: "other-moon-phases",
          title: `${p.icon} ${p.name}`,
          date: iso,
          isAllDay: true,
          isPublicHoliday: false,
          isObservance: true,
          tradition: "astronomy",
          dateType: "calculated",
          description: `Primary astronomical lunar phase: ${p.name}.`,
        });
      }
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9B. SPORTS CALENDAR GENERATORS (Cricket, Football, Basketball, Hockey, Rugby)
// ─────────────────────────────────────────────────────────────────────────────

export function generateIccCricketEventsForYear(year: number): HolidayEventDefinition[] {
  const events: HolidayEventDefinition[] = [];
  const feedId = "sports-cricket-icc";

  // ICC Multi-Year Schedule (2024-2028)
  const schedule: Record<number, { slug: string; title: string; date: string; desc: string }[]> = {
    2024: [
      { slug: "t20-wc-opener", title: "ICC Men's T20 World Cup - Opening Match", date: "2024-06-01", desc: "USA vs Canada opening clash in Dallas, Texas." },
      { slug: "t20-wc-ind-pak", title: "ICC Men's T20 World Cup - India vs Pakistan", date: "2024-06-09", desc: "High-octane group clash at Nassau County International Stadium, NY." },
      { slug: "t20-wc-final", title: "ICC Men's T20 World Cup - Final", date: "2024-06-29", desc: "Grand final championship match at Kensington Oval, Barbados." },
    ],
    2025: [
      { slug: "ct-opener", title: "ICC Champions Trophy - Tournament Opening", date: "2025-02-19", desc: "Opening match of the premier 8-nation ICC Champions Trophy." },
      { slug: "ct-final", title: "ICC Champions Trophy - Grand Final", date: "2025-03-09", desc: "Championship final of the 2025 ICC Champions Trophy." },
      { slug: "wtc-final", title: "ICC World Test Championship - Final", date: "2025-06-11", desc: "Ultimate Test clash at Lord's Cricket Ground, London." },
    ],
    2026: [
      { slug: "t20-wc-2026-open", title: "ICC Men's T20 World Cup 2026 - Opening Match", date: "2026-02-08", desc: "Jointly hosted in India & Sri Lanka - Tournament opening fixtures." },
      { slug: "t20-wc-2026-super8", title: "ICC Men's T20 World Cup 2026 - Super 8s Stage", date: "2026-02-24", desc: "Super 8 decisive qualification stage matches across host venues." },
      { slug: "t20-wc-2026-final", title: "ICC Men's T20 World Cup 2026 - Final", date: "2026-03-15", desc: "Championship final match at Eden Gardens, Kolkata." },
      { slug: "icc-u19-final", title: "ICC U19 Men's Cricket World Cup - Final", date: "2026-01-31", desc: "Next-generation stars championship match." },
      { slug: "icc-women-t20-final", title: "ICC Women's T20 World Cup - Final", date: "2026-06-28", desc: "Women's world championship final in England & Wales." },
    ],
    2027: [
      { slug: "cwc-2027-open", title: "ICC Men's Cricket World Cup 2027 - Opening Ceremony", date: "2027-10-08", desc: "Opening match hosted across South Africa, Zimbabwe, and Namibia." },
      { slug: "cwc-2027-final", title: "ICC Men's Cricket World Cup 2027 - Grand Final", date: "2027-11-21", desc: "50-over World Cup Final at the Wanderers, Johannesburg." },
    ],
    2028: [
      { slug: "t20-wc-2028-final", title: "ICC Men's T20 World Cup 2028 - Final", date: "2028-10-22", desc: "Tournament final hosted across Australia and New Zealand." },
    ],
  };

  const list = schedule[year] || [
    { slug: "icc-tourney-start", title: `ICC International Tournaments ${year}`, date: `${year}-03-15`, desc: "ICC international fixture series." },
    { slug: "icc-tourney-final", title: `ICC Championship Final ${year}`, date: `${year}-06-20`, desc: "ICC championship final encounter." },
  ];

  for (const item of list) {
    events.push({
      id: `${feedId}-${year}-${item.slug}`,
      feedId,
      title: item.title,
      date: item.date,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: item.desc,
    });
  }

  return events;
}

export function generateBangladeshTigersEventsForYear(year: number): HolidayEventDefinition[] {
  const events: HolidayEventDefinition[] = [];
  const feedId = "sports-cricket-tigers";

  const schedule: Record<number, { slug: string; title: string; date: string; desc: string }[]> = {
    2024: [
      { slug: "tigers-sl-series", title: "Bangladesh vs Sri Lanka - Test Series", date: "2024-03-22", desc: "ICC World Test Championship fixture at Sylhet International Cricket Stadium." },
      { slug: "tigers-ind-tour", title: "Bangladesh Tour of India - 1st Test", date: "2024-09-19", desc: "Historic series clash at MA Chidambaram Stadium, Chennai." },
    ],
    2025: [
      { slug: "bpl-final-2025", title: "Bangladesh Premier League (BPL) - Grand Finale", date: "2025-02-07", desc: "Franchise cricket showpiece at Sher-e-Bangla National Stadium, Mirpur." },
      { slug: "tigers-pak-series", title: "Bangladesh vs Pakistan - Home ODI Series", date: "2025-05-15", desc: "Bilateral white-ball battle at Zahur Ahmed Chowdhury Stadium, Chattogram." },
    ],
    2026: [
      { slug: "bpl-final-2026", title: "Bangladesh Premier League (BPL 2026) - Final", date: "2026-02-14", desc: "Title decider under lights at SBNCS, Mirpur, Dhaka." },
      { slug: "tigers-wc-match1", title: "ICC T20 World Cup - Bangladesh Opening Match", date: "2026-02-18", desc: "Bangladesh Tigers campaign opener in the T20 World Cup." },
      { slug: "tigers-eng-series", title: "Bangladesh vs England - Home Test Series", date: "2026-03-28", desc: "England tour of Bangladesh for ICC World Test Championship series." },
      { slug: "tigers-aus-tour", title: "Bangladesh Tour of Australia - Boxing Day Special", date: "2026-10-18", desc: "Tigers historic away bilateral series against the Aussies." },
      { slug: "tigers-asia-cup", title: "Asia Cup 2026 - Bangladesh vs India Derby", date: "2026-09-12", desc: "High stakes Asia Cup continental derby match." },
    ],
    2027: [
      { slug: "bpl-final-2027", title: "Bangladesh Premier League (BPL 2027) - Final", date: "2027-02-12", desc: "Mirpur national stadium championship showdown." },
      { slug: "tigers-cwc-2027-match1", title: "Cricket World Cup 2027 - Tigers Match 1", date: "2027-10-12", desc: "Tigers 50-over World Cup campaign match in South Africa." },
    ],
  };

  const list = schedule[year] || [
    { slug: "tigers-home-series", title: `Bangladesh Tigers Home Series ${year}`, date: `${year}-02-20`, desc: "International cricket home series at Mirpur." },
    { slug: "tigers-away-tour", title: `Bangladesh Tigers Overseas Tour ${year}`, date: `${year}-08-15`, desc: "Bilateral overseas tour." },
  ];

  for (const item of list) {
    events.push({
      id: `${feedId}-${year}-${item.slug}`,
      feedId,
      title: item.title,
      date: item.date,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: item.desc,
    });
  }

  return events;
}

export function generatePremierLeagueEventsForYear(year: number): HolidayEventDefinition[] {
  const events: HolidayEventDefinition[] = [];
  const feedId = "sports-football-premier";

  events.push(
    {
      id: `${feedId}-${year}-opening`,
      feedId,
      title: `Premier League ${year}/${year + 1} - Opening Weekend`,
      date: `${year}-08-15`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Matchday 1 kicks off the new English Premier League campaign.",
    },
    {
      id: `${feedId}-${year}-boxing-day`,
      feedId,
      title: "Premier League Festive Boxing Day Matchday",
      date: `${year}-12-26`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "fixed",
      description: "Iconic Boxing Day football tradition with packed nationwide fixtures.",
    },
    {
      id: `${feedId}-${year}-derby-north-london`,
      feedId,
      title: "Premier League - North London Derby Weekend",
      date: `${year}-03-14`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Arsenal vs Tottenham Hotspur marquee rivalry match.",
    },
    {
      id: `${feedId}-${year}-championship-sunday`,
      feedId,
      title: `Premier League Championship Sunday (${year} Season Finale)`,
      date: `${year}-05-24`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Simultaneous 10-match final day deciding the title, top 4, and relegation.",
    }
  );

  return events;
}

export function generateChampionsLeagueEventsForYear(year: number): HolidayEventDefinition[] {
  const events: HolidayEventDefinition[] = [];
  const feedId = "sports-football-ucl";

  events.push(
    {
      id: `${feedId}-${year}-round16`,
      feedId,
      title: "UEFA Champions League - Round of 16 Knockouts",
      date: `${year}-02-17`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "First legs of the knockout round among Europe's top 16 football clubs.",
    },
    {
      id: `${feedId}-${year}-qf`,
      feedId,
      title: "UEFA Champions League - Quarter-Finals",
      date: `${year}-04-07`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "High-stakes European elite quarter-final ties.",
    },
    {
      id: `${feedId}-${year}-sf`,
      feedId,
      title: "UEFA Champions League - Semi-Finals",
      date: `${year}-04-28`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Penultimate home-and-away battles for a place in the UCL Final.",
    },
    {
      id: `${feedId}-${year}-final`,
      feedId,
      title: `UEFA Champions League Final ${year}`,
      date: `${year}-05-30`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "The crown jewel of European club football deciding the Champions of Europe.",
    },
    {
      id: `${feedId}-${year}-new-season-md1`,
      feedId,
      title: `UEFA Champions League ${year}/${year + 1} - League Phase Matchday 1`,
      date: `${year}-09-15`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Autumn kickoff of the expanded 36-club Swiss model league phase.",
    }
  );

  return events;
}

export function generateWorldCup2026EventsForYear(year: number): HolidayEventDefinition[] {
  const events: HolidayEventDefinition[] = [];
  const feedId = "sports-football-worldcup";

  if (year === 2026) {
    events.push(
      {
        id: `${feedId}-2026-opener`,
        feedId,
        title: "FIFA World Cup 2026 - Opening Match (Mexico)",
        date: "2026-06-11",
        isAllDay: true,
        isPublicHoliday: false,
        isObservance: true,
        tradition: "sports",
        dateType: "fixed",
        description: "Inaugural match at Estadio Azteca, Mexico City.",
      },
      {
        id: `${feedId}-2026-usa-opener`,
        feedId,
        title: "FIFA World Cup 2026 - USA Opening Match",
        date: "2026-06-12",
        isAllDay: true,
        isPublicHoliday: false,
        isObservance: true,
        tradition: "sports",
        dateType: "fixed",
        description: "United States national team opens campaign at SoFi Stadium, Los Angeles.",
      },
      {
        id: `${feedId}-2026-round32`,
        feedId,
        title: "FIFA World Cup 2026 - Round of 32 Begins",
        date: "2026-06-28",
        isAllDay: true,
        isPublicHoliday: false,
        isObservance: true,
        tradition: "sports",
        dateType: "fixed",
        description: "Single-elimination knockout tournament stage commences.",
      },
      {
        id: `${feedId}-2026-qf`,
        feedId,
        title: "FIFA World Cup 2026 - Quarter-Finals",
        date: "2026-07-09",
        isAllDay: true,
        isPublicHoliday: false,
        isObservance: true,
        tradition: "sports",
        dateType: "fixed",
        description: "Final 8 nations battle across Boston, Los Angeles, Miami, and Kansas City.",
      },
      {
        id: `${feedId}-2026-sf`,
        feedId,
        title: "FIFA World Cup 2026 - Semi-Finals",
        date: "2026-07-14",
        isAllDay: true,
        isPublicHoliday: false,
        isObservance: true,
        tradition: "sports",
        dateType: "fixed",
        description: "Semi-final double-header at AT&T Stadium (Dallas) and Mercedes-Benz Stadium (Atlanta).",
      },
      {
        id: `${feedId}-2026-final`,
        feedId,
        title: "FIFA World Cup 2026 - Grand Final",
        date: "2026-07-19",
        isAllDay: true,
        isPublicHoliday: false,
        isObservance: true,
        tradition: "sports",
        dateType: "fixed",
        description: "World champion crowned at MetLife Stadium, New York / New Jersey.",
      }
    );
  } else {
    events.push({
      id: `${feedId}-${year}-qualifiers`,
      feedId,
      title: `FIFA World Cup International Qualifiers ${year}`,
      date: `${year}-10-10`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Continental qualifying window across UEFA, CONMEBOL, CONCACAF, AFC, and CAF.",
    });
  }

  return events;
}

export function generateNbaEventsForYear(year: number): HolidayEventDefinition[] {
  const events: HolidayEventDefinition[] = [];
  const feedId = "sports-basketball-nba";

  events.push(
    {
      id: `${feedId}-${year}-allstar`,
      feedId,
      title: `NBA All-Star Game ${year}`,
      date: `${year}-02-15`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Annual midseason showcase featuring the league's top basketball superstars.",
    },
    {
      id: `${feedId}-${year}-playoffs`,
      feedId,
      title: `NBA Playoffs ${year} - Opening Weekend`,
      date: `${year}-04-18`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Postseason first round action commences across Eastern and Western Conferences.",
    },
    {
      id: `${feedId}-${year}-finals`,
      feedId,
      title: `NBA Finals ${year} - Game 1`,
      date: `${year}-06-04`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Best-of-seven championship series for the Larry O'Brien Trophy.",
    },
    {
      id: `${feedId}-${year}-tipoff`,
      feedId,
      title: `NBA ${year}/${year + 1} Regular Season - Opening Night`,
      date: `${year}-10-20`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Ring ceremony and marquee opening double-header.",
    },
    {
      id: `${feedId}-${year}-xmas`,
      feedId,
      title: `NBA Christmas Day Showcase ${year}`,
      date: `${year}-12-25`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "fixed",
      description: "Tradition-rich 5-game national basketball television extravaganza.",
    }
  );

  return events;
}

export function generateNhlEventsForYear(year: number): HolidayEventDefinition[] {
  const events: HolidayEventDefinition[] = [];
  const feedId = "sports-hockey-nhl";

  events.push(
    {
      id: `${feedId}-${year}-winter-classic`,
      feedId,
      title: `NHL Winter Classic ${year}`,
      date: `${year}-01-01`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "fixed",
      description: "Premier outdoor regular season ice hockey game played in iconic stadium venues.",
    },
    {
      id: `${feedId}-${year}-playoffs`,
      feedId,
      title: `Stanley Cup Playoffs ${year} - First Round`,
      date: `${year}-04-20`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Grueling quest for sports' oldest trophy begins.",
    },
    {
      id: `${feedId}-${year}-iihf-final`,
      feedId,
      title: `IIHF World Ice Hockey Championship ${year} - Gold Medal Game`,
      date: `${year}-05-24`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "International ice hockey world championship final.",
    },
    {
      id: `${feedId}-${year}-stanley-cup`,
      feedId,
      title: `Stanley Cup Finals ${year} - Game 1`,
      date: `${year}-06-06`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "National Hockey League championship showdown.",
    },
    {
      id: `${feedId}-${year}-puck-drop`,
      feedId,
      title: `NHL ${year}/${year + 1} Season - Opening Night`,
      date: `${year}-10-06`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "New 82-game regular season puck drop.",
    }
  );

  return events;
}

export function generateRugbyEventsForYear(year: number): HolidayEventDefinition[] {
  const events: HolidayEventDefinition[] = [];
  const feedId = "sports-rugby-sixnations";

  events.push(
    {
      id: `${feedId}-${year}-round1`,
      feedId,
      title: `Six Nations Rugby ${year} - Round 1 Opening Weekend`,
      date: `${year}-02-06`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Northern Hemisphere championship kicks off between England, France, Ireland, Italy, Scotland & Wales.",
    },
    {
      id: `${feedId}-${year}-calcutta-cup`,
      feedId,
      title: `Six Nations - Calcutta Cup (England vs Scotland ${year})`,
      date: `${year}-02-21`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Oldest international rugby trophy contested annually since 1879.",
    },
    {
      id: `${feedId}-${year}-super-saturday`,
      feedId,
      title: `Six Nations Super Saturday ${year} (Final Round)`,
      date: `${year}-03-21`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Triple-header championship deciding day concluding the tournament.",
    },
    {
      id: `${feedId}-${year}-autumn-nations`,
      feedId,
      title: `World Rugby Autumn Nations Series ${year}`,
      date: `${year}-11-07`,
      isAllDay: true,
      isPublicHoliday: false,
      isObservance: true,
      tradition: "sports",
      dateType: "calculated",
      description: "Marquee cross-hemisphere test clashes between North and South giants.",
    }
  );

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. CONTINENT MAP & COUNTRY DIRECTORY (All 207 ISO-3166 Countries)
// ─────────────────────────────────────────────────────────────────────────────
const ISO_CONTINENT_MAP: Record<string, string> = {
  // Asia
  AF: "Asia", AM: "Asia", AZ: "Asia", BH: "Asia", BD: "Asia", BT: "Asia", BN: "Asia",
  KH: "Asia", CN: "Asia", CY: "Asia", GE: "Asia", IN: "Asia", ID: "Asia", IR: "Asia",
  IQ: "Asia", IL: "Asia", JP: "Asia", JO: "Asia", KZ: "Asia", KW: "Asia", KG: "Asia",
  LA: "Asia", LB: "Asia", MY: "Asia", MV: "Asia", MN: "Asia", MM: "Asia", NP: "Asia",
  KP: "Asia", OM: "Asia", PK: "Asia", PS: "Asia", PH: "Asia", QA: "Asia", SA: "Asia",
  SG: "Asia", KR: "Asia", LK: "Asia", SY: "Asia", TW: "Asia", TJ: "Asia", TH: "Asia",
  TL: "Asia", TR: "Asia", TM: "Asia", AE: "Asia", UZ: "Asia", VN: "Asia", YE: "Asia",
  // Europe
  AL: "Europe", AD: "Europe", AT: "Europe", BY: "Europe", BE: "Europe", BA: "Europe",
  BG: "Europe", HR: "Europe", CZ: "Europe", DK: "Europe", EE: "Europe", FI: "Europe",
  FR: "Europe", DE: "Europe", GR: "Europe", HU: "Europe", IS: "Europe", IE: "Europe",
  IT: "Europe", LV: "Europe", LI: "Europe", LT: "Europe", LU: "Europe", MT: "Europe",
  MD: "Europe", MC: "Europe", ME: "Europe", NL: "Europe", MK: "Europe", NO: "Europe",
  PL: "Europe", PT: "Europe", RO: "Europe", RU: "Europe", SM: "Europe", RS: "Europe",
  SK: "Europe", SI: "Europe", ES: "Europe", SE: "Europe", CH: "Europe", UA: "Europe",
  GB: "Europe", VA: "Europe", JE: "Europe", GG: "Europe", IM: "Europe", GI: "Europe",
  FO: "Europe", AX: "Europe",
  // Africa
  DZ: "Africa", AO: "Africa", BJ: "Africa", BW: "Africa", BF: "Africa", BI: "Africa",
  CV: "Africa", CM: "Africa", CF: "Africa", TD: "Africa", KM: "Africa", CG: "Africa",
  CD: "Africa", CI: "Africa", DJ: "Africa", EG: "Africa", GQ: "Africa", ER: "Africa",
  SZ: "Africa", ET: "Africa", GA: "Africa", GM: "Africa", GH: "Africa", GN: "Africa",
  GW: "Africa", KE: "Africa", LS: "Africa", LR: "Africa", LY: "Africa", MG: "Africa",
  MW: "Africa", ML: "Africa", MR: "Africa", MU: "Africa", MA: "Africa", MZ: "Africa",
  NA: "Africa", NE: "Africa", NG: "Africa", RW: "Africa", ST: "Africa", SN: "Africa",
  SC: "Africa", SL: "Africa", SO: "Africa", ZA: "Africa", SS: "Africa", SD: "Africa",
  TZ: "Africa", TG: "Africa", TN: "Africa", UG: "Africa", ZM: "Africa", ZW: "Africa",
  RE: "Africa", YT: "Africa",
  // Americas
  AG: "Americas", AR: "Americas", BS: "Americas", BB: "Americas", BZ: "Americas",
  BO: "Americas", BR: "Americas", CA: "Americas", CL: "Americas", CO: "Americas",
  CR: "Americas", CU: "Americas", DM: "Americas", DO: "Americas", EC: "Americas",
  SV: "Americas", GD: "Americas", GT: "Americas", GY: "Americas", HT: "Americas",
  HN: "Americas", JM: "Americas", MX: "Americas", NI: "Americas", PA: "Americas",
  PY: "Americas", PE: "Americas", KN: "Americas", LC: "Americas", VC: "Americas",
  SR: "Americas", TT: "Americas", US: "Americas", UY: "Americas", VE: "Americas",
  AW: "Americas", BM: "Americas", KY: "Americas", CW: "Americas", GL: "Americas",
  GP: "Americas", MQ: "Americas", PR: "Americas", TC: "Americas", VI: "Americas",
  // Oceania
  AU: "Oceania", FJ: "Oceania", KI: "Oceania", MH: "Oceania", FM: "Oceania",
  NR: "Oceania", NZ: "Oceania", PW: "Oceania", PG: "Oceania", WS: "Oceania",
  SB: "Oceania", TO: "Oceania", TV: "Oceania", VU: "Oceania", GU: "Oceania",
  NC: "Oceania", PF: "Oceania", MP: "Oceania", AS: "Oceania",
};

export interface SupportedCountryItem {
  code: string;
  name: string;
  nativeName?: string;
  continent: string;
}

let cachedCountriesList: SupportedCountryItem[] | null = null;

export function getAllSupportedCountries(): SupportedCountryItem[] {
  if (cachedCountriesList) return cachedCountriesList;
  try {
    const hd = new Holidays();
    const rawCountries = hd.getCountries();
    let displayNames: Intl.DisplayNames | null = null;
    try {
      displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {}

    const list: SupportedCountryItem[] = [];
    for (const [code, nativeVal] of Object.entries(rawCountries)) {
      const upper = code.toUpperCase();
      const englishName = displayNames?.of(upper) || String(nativeVal);
      const continent = ISO_CONTINENT_MAP[upper] || "Americas";
      list.push({
        code: upper,
        name: englishName,
        nativeName: typeof nativeVal === "string" ? nativeVal : undefined,
        continent,
      });
    }

    list.sort((a, b) => a.name.localeCompare(b.name));
    cachedCountriesList = list;
    return list;
  } catch (err) {
    console.warn("[holidayCatalogue] Failed to load date-holidays countries:", err);
    return [
      { code: "BD", name: "Bangladesh", continent: "Asia" },
      { code: "US", name: "United States", continent: "Americas" },
      { code: "GB", name: "United Kingdom", continent: "Europe" },
    ];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. BASE CURATED FEEDS (Includes 2026 default baseline for backward compat)
// ─────────────────────────────────────────────────────────────────────────────
export const HOLIDAY_FEEDS: HolidayCalendarFeed[] = [
  // ── Bangladesh ──
  {
    id: "holiday-bd",
    category: "country",
    countryCode: "BD",
    name: "Bangladesh Holidays",
    regionOrTradition: "South Asia",
    defaultColor: "#15803D", // Forest Emerald (Bangladesh National Color)
    description: "Official gazetted public holidays and observances of the People's Republic of Bangladesh.",
    supportsObservances: true,
    provider: "Ministry of Public Administration, Government of the People's Republic of Bangladesh",
    lastUpdated: "2026-01-01T00:00:00Z",
    disclaimer: "Religious holidays in Bangladesh follow national moon-sighting committee announcements and official gazette notifications.",
    events: generateBangladeshEventsForYear(2026),
  },

  // ── United States ──
  {
    id: "holiday-us",
    category: "country",
    countryCode: "US",
    name: "United States Holidays",
    regionOrTradition: "North America",
    defaultColor: "#1E3A8A", // US Blue
    description: "Federal public holidays and major traditional observances of the United States of America.",
    supportsObservances: true,
    provider: "Office of Personnel Management (OPM), Federal Government of the United States",
    lastUpdated: "2026-01-01T00:00:00Z",
    events: [],
  },

  // ── United Kingdom ──
  {
    id: "holiday-gb",
    category: "country",
    countryCode: "GB",
    name: "United Kingdom Bank Holidays",
    regionOrTradition: "Europe",
    defaultColor: "#065F46", // British Racing Green
    description: "Statutory bank holidays and major observances across England and Wales.",
    supportsObservances: true,
    provider: "UK Government Digital Service (gov.uk)",
    lastUpdated: "2026-01-01T00:00:00Z",
    events: [],
  },

  // ── Islam ──
  {
    id: "religion-islam",
    category: "religion",
    name: "Islamic Holidays (Hijri 1446–1449)",
    regionOrTradition: "Islam",
    defaultColor: "#047857", // Deep Islamic Emerald
    description: "Major holy days, fasting periods, and Eid festivals of the Islamic lunar calendar.",
    supportsObservances: true,
    provider: "International Astronomical Centre & Official Moon Sighting Committees",
    lastUpdated: "2026-01-01T00:00:00Z",
    disclaimer: "Islamic calendar dates are calculated based on astronomical lunar visibility forecasts. Exact Gregorian dates are provisional and subject to local crescent moon-sighting confirmations.",
    events: generateIslamicEventsForYear(2026),
  },

  // ── Christianity ──
  {
    id: "religion-christianity",
    category: "religion",
    name: "Christian Holidays (Western & Ecumenical)",
    regionOrTradition: "Christianity",
    defaultColor: "#9333EA", // Liturgical Purple / Royal
    description: "Major liturgical feasts and solemnities of the Western Christian ecclesiastical calendar.",
    supportsObservances: true,
    provider: "World Council of Churches & Western Liturgical Almanac",
    lastUpdated: "2026-01-01T00:00:00Z",
    disclaimer: "Dates correspond to the Western Gregorian computation. Eastern Orthodox traditions compute Paschal dates via the Julian lunar reckoning.",
    events: generateChristianEventsForYear(2026),
  },

  // ── Orthodox Christianity ──
  {
    id: "religion-orthodox",
    category: "religion",
    name: "Orthodox Christian Holidays (Eastern / Byzantine)",
    regionOrTradition: "Christianity",
    defaultColor: "#7C3AED", // Byzantine Imperial Purple
    description: "Feasts of the Eastern Orthodox Church calculated via the Julian liturgical Paschal computus.",
    supportsObservances: true,
    provider: "Ecumenical Patriarchate & Eastern Orthodox Almanac",
    lastUpdated: "2026-01-01T00:00:00Z",
    events: generateOrthodoxEventsForYear(2026),
  },

  // ── Hinduism ──
  {
    id: "religion-hinduism",
    category: "religion",
    name: "Hindu Festivals (Panchang / Vikram Samvat)",
    regionOrTradition: "Hinduism",
    defaultColor: "#D97706", // Saffron / Marigold Amber
    description: "Major Vedic and traditional celebrations calculated from lunar tithi cycles in Hindu Panchang.",
    supportsObservances: true,
    provider: "All India Federation of Astrologers' Societies (Panchang Board)",
    lastUpdated: "2026-01-01T00:00:00Z",
    disclaimer: "Hindu festival dates depend on tithi sunrise calculations and may vary by one solar day across regional Panchangs.",
    events: generateHinduEventsForYear(2026),
  },

  // ── Buddhism ──
  {
    id: "religion-buddhism",
    category: "religion",
    name: "Buddhist Holidays (Theravada & Mahayana)",
    regionOrTradition: "Buddhism",
    defaultColor: "#EA580C", // Saffron Robe Orange
    description: "Sacred Uposatha full-moon observances and festivals commemorating the life and teachings of Gautama Buddha.",
    supportsObservances: true,
    provider: "World Fellowship of Buddhists (WFB)",
    lastUpdated: "2026-01-01T00:00:00Z",
    disclaimer: "Full moon lunar dates vary by national Buddhist calendar reckoning across Theravada and Mahayana regions.",
    events: generateBuddhistEventsForYear(2026),
  },

  // ── Judaism ──
  {
    id: "religion-judaism",
    category: "religion",
    name: "Jewish Holidays (Hebrew Calendar 5785–5788)",
    regionOrTradition: "Judaism",
    defaultColor: "#2563EB", // Tallit Blue
    description: "Solemnities, fasts, and joyous pilgrim festivals of the traditional Hebrew lunisolar calendar.",
    supportsObservances: true,
    provider: "Hebcal & Chief Rabbinate Astronomical Commission",
    lastUpdated: "2026-01-01T00:00:00Z",
    disclaimer: "All Jewish holidays commence at sundown on the evening preceding the recorded date.",
    events: generateJewishEventsForYear(2026),
  },

  // ── Shinto & East Asian Traditional ──
  {
    id: "religion-shinto",
    category: "religion",
    name: "Shinto & East Asian Observances",
    regionOrTradition: "East Asia",
    defaultColor: "#DC2626", // Torii Vermillion Red
    description: "Seasonal festivals, rites of passage, and ancestor honoring observances of the Shinto tradition.",
    supportsObservances: true,
    provider: "Jinja Honcho (Association of Shinto Shrines)",
    lastUpdated: "2026-01-01T00:00:00Z",
    events: generateShintoEventsForYear(2026),
  },

  // ── Phases of the Moon ──
  {
    id: "other-moon-phases",
    category: "other",
    name: "Phases of the Moon",
    regionOrTradition: "Astronomy",
    defaultColor: "#4B5563", // Slate Gray
    description: "Astronomical lunar phases showing New Moon, First Quarter, Full Moon, and Third Quarter.",
    supportsObservances: true,
    provider: "Astronomical Ephemeris & NASA Lunar Computations",
    lastUpdated: "2026-01-01T00:00:00Z",
    updateFrequency: "Astronomical calculation (Continuous / Multi-Year)",
    regionalApplicability: "Global (Synchronous Lunar Cycles)",
    events: generateMoonPhasesForYear(2026),
  },

  // ── Cricket: ICC International Tournaments ──
  {
    id: "sports-cricket-icc",
    category: "sports",
    name: "ICC Cricket (World Cups & Tournaments)",
    regionOrTradition: "Cricket",
    defaultColor: "#0284C7", // ICC Sky Blue
    description: "Major international tournaments including ICC T20 World Cup, Champions Trophy, and World Test Championship Final.",
    supportsObservances: true,
    provider: "International Cricket Council (ICC Public Domain Schedule)",
    lastUpdated: "2026-01-01T00:00:00Z",
    updateFrequency: "Quarterly / Pre-tournament announcements",
    regionalApplicability: "Global (Full & Associate Cricket Members)",
    disclaimer: "Match fixtures and reserve day activations follow ICC tournament playing conditions.",
    events: generateIccCricketEventsForYear(2026),
  },

  // ── Cricket: Bangladesh Tigers Series ──
  {
    id: "sports-cricket-tigers",
    category: "sports",
    name: "Bangladesh Tigers International Series",
    regionOrTradition: "Cricket",
    defaultColor: "#15803D", // Bangladesh Emerald Green
    description: "Bangladesh National Cricket Team (The Tigers) bilateral home and away test/ODI series and BPL Finals.",
    supportsObservances: true,
    provider: "Bangladesh Cricket Board (BCB FTP Fixture Registry)",
    lastUpdated: "2026-01-01T00:00:00Z",
    updateFrequency: "Bimonthly based on ICC Future Tours Programme",
    regionalApplicability: "Bangladesh & Touring Host Nations",
    events: generateBangladeshTigersEventsForYear(2026),
  },

  // ── Football: English Premier League ──
  {
    id: "sports-football-premier",
    category: "sports",
    name: "English Premier League (Key Matchdays & Finals)",
    regionOrTradition: "Football",
    defaultColor: "#7C3AED", // Premier League Purple
    description: "Key fixtures, opening matchdays, Boxing Day specials, and Championship Sunday of the English Premier League.",
    supportsObservances: true,
    provider: "Premier League Association (Public Domain Calendar)",
    lastUpdated: "2026-01-01T00:00:00Z",
    updateFrequency: "Annual season launch and monthly broadcast windows",
    regionalApplicability: "United Kingdom & Global Fans",
    events: generatePremierLeagueEventsForYear(2026),
  },

  // ── Football: UEFA Champions League ──
  {
    id: "sports-football-ucl",
    category: "sports",
    name: "UEFA Champions League",
    regionOrTradition: "Football",
    defaultColor: "#1E3A8A", // Champions League Navy
    description: "Europe's premier club football tournament from knockout rounds to the grand final showpiece.",
    supportsObservances: true,
    provider: "UEFA (Union of European Football Associations)",
    lastUpdated: "2026-01-01T00:00:00Z",
    updateFrequency: "Seasonal draw-phase announcements",
    regionalApplicability: "Europe & Global Broadcast",
    events: generateChampionsLeagueEventsForYear(2026),
  },

  // ── Football: FIFA World Cup 2026 ──
  {
    id: "sports-football-worldcup",
    category: "sports",
    name: "FIFA World Cup 2026 (USA, Canada, Mexico)",
    regionOrTradition: "Football",
    defaultColor: "#047857", // Tournament Gold/Emerald
    description: "The 48-nation FIFA World Cup 2026 tournament hosted across the United States, Mexico, and Canada.",
    supportsObservances: true,
    provider: "FIFA International Match Calendar",
    lastUpdated: "2026-01-01T00:00:00Z",
    updateFrequency: "Quadrennial with qualification draws",
    regionalApplicability: "North America & Worldwide",
    events: generateWorldCup2026EventsForYear(2026),
  },

  // ── Basketball: NBA ──
  {
    id: "sports-basketball-nba",
    category: "sports",
    name: "NBA (National Basketball Association)",
    regionOrTradition: "Basketball",
    defaultColor: "#B91C1C", // NBA Crimson
    description: "Opening Night, Christmas Day Showcase, NBA All-Star Weekend, Playoffs, and the NBA Finals.",
    supportsObservances: true,
    provider: "National Basketball Association (NBA Public Calendar)",
    lastUpdated: "2026-01-01T00:00:00Z",
    updateFrequency: "Annual season calendar release",
    regionalApplicability: "North America & Global",
    events: generateNbaEventsForYear(2026),
  },

  // ── Hockey: NHL & IIHF ──
  {
    id: "sports-hockey-nhl",
    category: "sports",
    name: "NHL & International Ice Hockey",
    regionOrTradition: "Hockey",
    defaultColor: "#0F766E", // Ice Hockey Teal
    description: "NHL Winter Classic, Stanley Cup Playoffs, Stanley Cup Finals, and the IIHF World Championship.",
    supportsObservances: true,
    provider: "National Hockey League (NHL) & IIHF",
    lastUpdated: "2026-01-01T00:00:00Z",
    updateFrequency: "Seasonal schedule releases",
    regionalApplicability: "North America & Europe",
    events: generateNhlEventsForYear(2026),
  },

  // ── Rugby: Six Nations & World Rugby ──
  {
    id: "sports-rugby-sixnations",
    category: "sports",
    name: "Six Nations & World Rugby",
    regionOrTradition: "Rugby",
    defaultColor: "#B45309", // Rugby Amber
    description: "Six Nations Championship, Calcutta Cup, Super Saturday final round, and World Rugby Autumn Series.",
    supportsObservances: true,
    provider: "Six Nations Rugby Ltd & World Rugby",
    lastUpdated: "2026-01-01T00:00:00Z",
    updateFrequency: "Annual tournament schedule",
    regionalApplicability: "Six Nations (UK, Ireland, France, Italy) & Global Rugby",
    events: generateRugbyEventsForYear(2026),
  },
];

// Initialize US & GB events for 2026 in baseline
const usBaseline = generateFeedForCountry("US", 2026);
if (usBaseline) {
  const usFeed = HOLIDAY_FEEDS.find((f) => f.id === "holiday-us");
  if (usFeed) usFeed.events = usBaseline.events;
}
const gbBaseline = generateFeedForCountry("GB", 2026);
if (gbBaseline) {
  const gbFeed = HOLIDAY_FEEDS.find((f) => f.id === "holiday-gb");
  if (gbFeed) gbFeed.events = gbBaseline.events;
}


export function generateFeedForCountry(countryCode: string, year = 2026): HolidayCalendarFeed | undefined {
  const upper = countryCode.toUpperCase();

  // If Bangladesh, use the gazetted dataset
  if (upper === "BD") {
    const bdEvents = generateBangladeshEventsForYear(year);
    return {
      id: "holiday-bd",
      category: "country",
      countryCode: "BD",
      name: "Bangladesh Holidays",
      regionOrTradition: "South Asia",
      defaultColor: "#15803D",
      description: "Official gazetted public holidays and observances of the People's Republic of Bangladesh.",
      supportsObservances: true,
      provider: "Ministry of Public Administration, Government of the People's Republic of Bangladesh",
      lastUpdated: new Date().toISOString(),
      disclaimer: "Religious holidays in Bangladesh follow national moon-sighting committee announcements and official gazette notifications.",
      events: bdEvents,
    };
  }

  const countries = getAllSupportedCountries();
  const info = countries.find((c) => c.code === upper);
  if (!info) return undefined;

  try {
    const hd = new Holidays(upper, { languages: ["en"] });
    const rawHolidays = hd.getHolidays(year) || [];

    const events: HolidayEventDefinition[] = rawHolidays.map((h, idx) => {
      const isPublic = h.type === "public" || h.type === "bank";
      const dateStr = typeof h.date === "string" ? h.date.slice(0, 10) : new Date(h.start).toISOString().slice(0, 10);
      const slugTitle = (h.name || "holiday").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return {
        id: `${upper.toLowerCase()}-${slugTitle}-${year}-${idx}`,
        feedId: `holiday-${upper.toLowerCase()}`,
        title: h.name || "Holiday",
        date: dateStr,
        isAllDay: true,
        isPublicHoliday: isPublic,
        isObservance: !isPublic,
        tradition: "national",
        dateType: h.rule ? "calculated" : "fixed",
        description: `${isPublic ? "Official public holiday" : "Observance"} in ${info.name}.`,
      };
    });

    const defaultColor = upper === "US" ? "#1E3A8A" : upper === "GB" ? "#065F46" : "#2563EB";

    return {
      id: `holiday-${upper.toLowerCase()}`,
      category: "country",
      countryCode: upper,
      name: `${info.name} Holidays`,
      regionOrTradition: info.continent,
      defaultColor,
      description: `Official public holidays and observances of ${info.name}.`,
      supportsObservances: true,
      provider: `date-holidays (${upper})`,
      lastUpdated: new Date().toISOString(),
      events,
    };
  } catch (err) {
    console.warn(`[holidayCatalogue] Failed to generate holidays for ${upper}:`, err);
    return undefined;
  }
}

/**
 * Get all feeds or filter by category
 */
export function getAvailableFeeds(): HolidayCalendarFeed[] {
  return HOLIDAY_FEEDS;
}

export function getFeedById(feedOrId: string | HolidayCalendarFeed | any, year = 2026): HolidayCalendarFeed | undefined {
  if (!feedOrId) return undefined;
  const feedId = typeof feedOrId === "string" ? feedOrId : (typeof feedOrId === "object" ? feedOrId.id : String(feedOrId));
  if (!feedId || typeof feedId !== "string") return undefined;

  if (feedId === "holiday-bd") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "holiday-bd")!;
    return {
      ...feed,
      events: generateBangladeshEventsForYear(year),
    };
  }

  if (feedId === "religion-islam") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "religion-islam")!;
    return {
      ...feed,
      events: generateIslamicEventsForYear(year),
    };
  }

  if (feedId === "religion-christianity") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "religion-christianity")!;
    return {
      ...feed,
      events: generateChristianEventsForYear(year),
    };
  }

  if (feedId === "religion-orthodox") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "religion-orthodox")!;
    return {
      ...feed,
      events: generateOrthodoxEventsForYear(year),
    };
  }

  if (feedId === "religion-judaism") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "religion-judaism")!;
    return {
      ...feed,
      events: generateJewishEventsForYear(year),
    };
  }

  if (feedId === "religion-hinduism") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "religion-hinduism")!;
    return {
      ...feed,
      events: generateHinduEventsForYear(year),
    };
  }

  if (feedId === "religion-buddhism") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "religion-buddhism")!;
    return {
      ...feed,
      events: generateBuddhistEventsForYear(year),
    };
  }

  if (feedId === "religion-shinto") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "religion-shinto")!;
    return {
      ...feed,
      events: generateShintoEventsForYear(year),
    };
  }

  if (feedId === "other-moon-phases") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "other-moon-phases")!;
    return {
      ...feed,
      events: generateMoonPhasesForYear(year),
    };
  }

  // Sports Feeds
  if (feedId === "sports-cricket-icc") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "sports-cricket-icc")!;
    return { ...feed, events: generateIccCricketEventsForYear(year) };
  }
  if (feedId === "sports-cricket-tigers") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "sports-cricket-tigers")!;
    return { ...feed, events: generateBangladeshTigersEventsForYear(year) };
  }
  if (feedId === "sports-football-premier") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "sports-football-premier")!;
    return { ...feed, events: generatePremierLeagueEventsForYear(year) };
  }
  if (feedId === "sports-football-ucl") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "sports-football-ucl")!;
    return { ...feed, events: generateChampionsLeagueEventsForYear(year) };
  }
  if (feedId === "sports-football-worldcup") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "sports-football-worldcup")!;
    return { ...feed, events: generateWorldCup2026EventsForYear(year) };
  }
  if (feedId === "sports-basketball-nba") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "sports-basketball-nba")!;
    return { ...feed, events: generateNbaEventsForYear(year) };
  }
  if (feedId === "sports-hockey-nhl") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "sports-hockey-nhl")!;
    return { ...feed, events: generateNhlEventsForYear(year) };
  }
  if (feedId === "sports-rugby-sixnations") {
    const feed = HOLIDAY_FEEDS.find((f) => f.id === "sports-rugby-sixnations")!;
    return { ...feed, events: generateRugbyEventsForYear(year) };
  }

  // Country feed
  if (typeof feedId === "string" && feedId.startsWith("holiday-")) {
    const code = feedId.replace("holiday-", "").toUpperCase();
    return generateFeedForCountry(code, year);
  }

  const curated = HOLIDAY_FEEDS.find((f) => f.id === feedId);
  return curated;
}

export function getFeedsByCategory(category: "country" | "religion" | "other" | "sports"): HolidayCalendarFeed[] {
  return HOLIDAY_FEEDS.filter((f) => f.category === category);
}

/**
 * Get feed events with options
 */
export function getFeedEvents(
  feedOrId: string | HolidayCalendarFeed | any,
  options?: {
    includeObservances?: boolean;
    hiddenEventIds?: string[];
    year?: number;
  }
): HolidayEventDefinition[] {
  if (!feedOrId) return [];
  const feed = getFeedById(feedOrId, options?.year ?? 2026);
  if (!feed) return [];

  const includeObs = options?.includeObservances ?? true;
  const hiddenSet = new Set(options?.hiddenEventIds || []);

  return feed.events.filter((ev) => {
    if (hiddenSet.has(ev.id)) return false;
    if (!includeObs && ev.isObservance) return false;
    return true;
  });
}

export function getFeedEventsForYearRange(
  feedOrId: string | HolidayCalendarFeed | any,
  startYear: number,
  endYear: number,
  options?: {
    includeObservances?: boolean;
    hiddenEventIds?: string[];
  }
): HolidayEventDefinition[] {
  if (!feedOrId) return [];
  const allEvents: HolidayEventDefinition[] = [];
  const seenIds = new Set<string>();

  for (let y = startYear; y <= endYear; y++) {
    const yearEvents = getFeedEvents(feedOrId, { ...options, year: y });
    for (const ev of yearEvents) {
      if (!seenIds.has(ev.id)) {
        seenIds.add(ev.id);
        allEvents.push(ev);
      }
    }
  }

  return allEvents;
}
