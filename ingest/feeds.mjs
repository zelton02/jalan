// Official Malaysian GTFS feeds (data.gov.my). Static only — see DATA.md.
// `region` is for display and filtering; it is not part of the GTFS spec.
export const FEEDS = [
  // Klang Valley
  { key: "rail", label: "Rapid Rail KL", region: "Klang Valley", url: "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl" },
  { key: "bus", label: "Rapid Bus KL", region: "Klang Valley", url: "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl" },
  { key: "mrtfeeder", label: "Rapid Bus MRT Feeder", region: "Klang Valley", url: "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder" },

  // Other states (stage buses)
  { key: "penang", label: "Rapid Bus Penang", region: "Pulau Pinang", url: "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-penang" },
  { key: "kangar", label: "BAS.MY Kangar", region: "Perlis", url: "https://api.data.gov.my/gtfs-static/mybas-kangar" },
  { key: "alor-setar", label: "BAS.MY Alor Setar", region: "Kedah", url: "https://api.data.gov.my/gtfs-static/mybas-alor-setar" },
  { key: "kota-bharu", label: "BAS.MY Kota Bharu", region: "Kelantan", url: "https://api.data.gov.my/gtfs-static/mybas-kota-bharu" },
  { key: "kuala-terengganu", label: "BAS.MY Kuala Terengganu", region: "Terengganu", url: "https://api.data.gov.my/gtfs-static/mybas-kuala-terengganu" },
  { key: "ipoh", label: "BAS.MY Ipoh", region: "Perak", url: "https://api.data.gov.my/gtfs-static/mybas-ipoh" },
  { key: "melaka", label: "BAS.MY Melaka", region: "Melaka", url: "https://api.data.gov.my/gtfs-static/mybas-melaka" },
  { key: "johor", label: "BAS.MY Johor Bahru", region: "Johor", url: "https://api.data.gov.my/gtfs-static/mybas-johor" },
  { key: "kuching", label: "BAS.MY Kuching", region: "Sarawak", url: "https://api.data.gov.my/gtfs-static/mybas-kuching" },

  // National rail
  { key: "ktmb", label: "KTMB", region: "National", url: "https://api.data.gov.my/gtfs-static/ktmb" },
];

export const REGIONS = Object.fromEntries(FEEDS.map((f) => [f.key, f.region]));
