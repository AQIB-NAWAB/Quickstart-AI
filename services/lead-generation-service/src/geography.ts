/**
 * Hierarchical Geography Resolution and Disambiguation
 * Distinguishes country, state/province, and city hierarchies.
 * Fixes CA conflation between California (US state) and Canada (country).
 */

export type ParsedLocation = {
  raw: string;
  countryCode?: string; // ISO 3166-1 alpha-2, e.g. "US", "CA", "GB"
  countryName?: string;
  regionCode?: string;  // State/province, e.g. "CA" for California, "ON" for Ontario
  regionName?: string;  // e.g. "California", "Ontario"
  city?: string;        // e.g. "San Francisco", "Toronto", "London"
  neighborhood?: string;
  isAmbiguous?: boolean;
  ambiguityReason?: string;
};

// Normalized Country Mapping
const COUNTRIES: Record<string, { code: string; name: string; aliases: string[] }> = {
  US: {
    code: "US",
    name: "United States",
    aliases: ["united states", "united states of america", "usa", "us", "america", "u.s.", "u.s.a."],
  },
  CA: {
    code: "CA",
    name: "Canada",
    aliases: ["canada", "can", "c.a."], // Note: 2-letter 'ca' defaults to California unless in Canadian province context
  },
  GB: {
    code: "GB",
    name: "United Kingdom",
    aliases: ["united kingdom", "uk", "great britain", "gb", "england", "scotland", "wales", "northern ireland", "u.k."],
  },
  AU: {
    code: "AU",
    name: "Australia",
    aliases: ["australia", "au", "oz"],
  },
  DE: {
    code: "DE",
    name: "Germany",
    aliases: ["germany", "deutschland", "de"],
  },
  FR: {
    code: "FR",
    name: "France",
    aliases: ["france", "fr"],
  },
  PK: {
    code: "PK",
    name: "Pakistan",
    aliases: ["pakistan", "pk"],
  },
  IN: {
    code: "IN",
    name: "India",
    aliases: ["india", "in", "bharat"],
  },
  AE: {
    code: "AE",
    name: "United Arab Emirates",
    aliases: ["united arab emirates", "uae", "u.a.e.", "dubai", "abu dhabi"],
  },
};

// US States (code -> name and aliases)
const US_STATES: Record<string, { code: string; name: string; aliases: string[] }> = {
  AL: { code: "AL", name: "Alabama", aliases: ["alabama", "al"] },
  AK: { code: "AK", name: "Alaska", aliases: ["alaska", "ak"] },
  AZ: { code: "AZ", name: "Arizona", aliases: ["arizona", "az"] },
  AR: { code: "AR", name: "Arkansas", aliases: ["arkansas", "ar"] },
  CA: { code: "CA", name: "California", aliases: ["california", "calif", "ca"] },
  CO: { code: "CO", name: "Colorado", aliases: ["colorado", "co"] },
  CT: { code: "CT", name: "Connecticut", aliases: ["connecticut", "ct"] },
  DE: { code: "DE", name: "Delaware", aliases: ["delaware", "de"] },
  FL: { code: "FL", name: "Florida", aliases: ["florida", "fl"] },
  GA: { code: "GA", name: "Georgia", aliases: ["georgia", "ga"] },
  HI: { code: "HI", name: "Hawaii", aliases: ["hawaii", "hi"] },
  ID: { code: "ID", name: "Idaho", aliases: ["idaho", "id"] },
  IL: { code: "IL", name: "Illinois", aliases: ["illinois", "il"] },
  IN: { code: "IN", name: "Indiana", aliases: ["indiana", "in"] },
  IA: { code: "IA", name: "Iowa", aliases: ["iowa", "ia"] },
  KS: { code: "KS", name: "Kansas", aliases: ["kansas", "ks"] },
  KY: { code: "KY", name: "Kentucky", aliases: ["kentucky", "ky"] },
  LA: { code: "LA", name: "Louisiana", aliases: ["louisiana", "la"] },
  ME: { code: "ME", name: "Maine", aliases: ["maine", "me"] },
  MD: { code: "MD", name: "Maryland", aliases: ["maryland", "md"] },
  MA: { code: "MA", name: "Massachusetts", aliases: ["massachusetts", "ma"] },
  MI: { code: "MI", name: "Michigan", aliases: ["michigan", "mi"] },
  MN: { code: "MN", name: "Minnesota", aliases: ["minnesota", "mn"] },
  MS: { code: "MS", name: "Mississippi", aliases: ["mississippi", "ms"] },
  MO: { code: "MO", name: "Missouri", aliases: ["missouri", "mo"] },
  MT: { code: "MT", name: "Montana", aliases: ["montana", "mt"] },
  NE: { code: "NE", name: "Nebraska", aliases: ["nebraska", "ne"] },
  NV: { code: "NV", name: "Nevada", aliases: ["nevada", "nv"] },
  NH: { code: "NH", name: "New Hampshire", aliases: ["new hampshire", "nh"] },
  NJ: { code: "NJ", name: "New Jersey", aliases: ["new jersey", "nj"] },
  NM: { code: "NM", name: "New Mexico", aliases: ["new mexico", "nm"] },
  NY: { code: "NY", name: "New York", aliases: ["new york", "ny"] },
  NC: { code: "NC", name: "North Carolina", aliases: ["north carolina", "nc"] },
  ND: { code: "ND", name: "North Dakota", aliases: ["north dakota", "nd"] },
  OH: { code: "OH", name: "Ohio", aliases: ["ohio", "oh"] },
  OK: { code: "OK", name: "Oklahoma", aliases: ["oklahoma", "ok"] },
  OR: { code: "OR", name: "Oregon", aliases: ["oregon", "or"] },
  PA: { code: "PA", name: "Pennsylvania", aliases: ["pennsylvania", "pa"] },
  RI: { code: "RI", name: "Rhode Island", aliases: ["rhode island", "ri"] },
  SC: { code: "SC", name: "South Carolina", aliases: ["south carolina", "sc"] },
  SD: { code: "SD", name: "South Dakota", aliases: ["south dakota", "sd"] },
  TN: { code: "TN", name: "Tennessee", aliases: ["tennessee", "tn"] },
  TX: { code: "TX", name: "Texas", aliases: ["texas", "tx"] },
  UT: { code: "UT", name: "Utah", aliases: ["utah", "ut"] },
  VT: { code: "VT", name: "Vermont", aliases: ["vermont", "vt"] },
  VA: { code: "VA", name: "Virginia", aliases: ["virginia", "va"] },
  WA: { code: "WA", name: "Washington", aliases: ["washington", "wa"] },
  WV: { code: "WV", name: "West Virginia", aliases: ["west virginia", "wv"] },
  WI: { code: "WI", name: "Wisconsin", aliases: ["wisconsin", "wi"] },
  WY: { code: "WY", name: "Wyoming", aliases: ["wyoming", "wy"] },
  DC: { code: "DC", name: "District of Columbia", aliases: ["washington dc", "washington d.c.", "dc", "d.c."] },
};

// Canadian Provinces
const CA_PROVINCES: Record<string, { code: string; name: string; aliases: string[] }> = {
  ON: { code: "ON", name: "Ontario", aliases: ["ontario", "on"] },
  QC: { code: "QC", name: "Quebec", aliases: ["quebec", "québec", "qc"] },
  BC: { code: "BC", name: "British Columbia", aliases: ["british columbia", "bc"] },
  AB: { code: "AB", name: "Alberta", aliases: ["alberta", "ab"] },
  MB: { code: "MB", name: "Manitoba", aliases: ["manitoba", "mb"] },
  SK: { code: "SK", name: "Saskatchewan", aliases: ["saskatchewan", "sk"] },
  NS: { code: "NS", name: "Nova Scotia", aliases: ["nova scotia", "ns"] },
  NB: { code: "NB", name: "New Brunswick", aliases: ["new brunswick", "nb"] },
  NL: { code: "NL", name: "Newfoundland and Labrador", aliases: ["newfoundland", "nl"] },
  PE: { code: "PE", name: "Prince Edward Island", aliases: ["prince edward island", "pei", "pe"] },
};

// Common Ambiguous Cities Across Different Countries
const MULTI_COUNTRY_CITIES: Record<string, Array<{ city: string; countryCode: string; regionCode?: string }>> = {
  london: [
    { city: "London", countryCode: "GB" },
    { city: "London", countryCode: "CA", regionCode: "ON" },
    { city: "London", countryCode: "US", regionCode: "KY" },
  ],
  paris: [
    { city: "Paris", countryCode: "FR" },
    { city: "Paris", countryCode: "US", regionCode: "TX" },
  ],
  cambridge: [
    { city: "Cambridge", countryCode: "GB" },
    { city: "Cambridge", countryCode: "US", regionCode: "MA" },
    { city: "Cambridge", countryCode: "CA", regionCode: "ON" },
  ],
  melbourne: [
    { city: "Melbourne", countryCode: "AU" },
    { city: "Melbourne", countryCode: "US", regionCode: "FL" },
  ],
};

/** Parse a raw location string into structured hierarchy. */
export function parseLocation(raw: string): ParsedLocation {
  const clean = raw.trim();
  if (!clean) return { raw: clean };

  const segments = clean
    .split(/[,/|;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const lowerSegments = segments.map((s) => s.toLowerCase());

  // Check for standalone "CA" ambiguity
  if (segments.length === 1 && lowerSegments[0] === "ca") {
    return {
      raw: clean,
      isAmbiguous: true,
      ambiguityReason: "CA can mean California (US state) or Canada (country). Please specify 'California, US' or 'Canada'.",
    };
  }

  let countryCode: string | undefined;
  let countryName: string | undefined;
  let regionCode: string | undefined;
  let regionName: string | undefined;
  let city: string | undefined;

  // 1. Identify country from segments (usually the last segment)
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = lowerSegments[i];
    for (const c of Object.values(COUNTRIES)) {
      if (c.aliases.includes(seg)) {
        // Special case: if seg is "ca" and followed or preceded by a US state or US city, it might be California
        if (seg === "ca" && i === 0 && segments.length > 1) {
          // If first segment is "CA", check if second segment is "USA" or "US"
          if (["us", "usa", "united states"].includes(lowerSegments[1])) {
            countryCode = "US";
            countryName = "United States";
            regionCode = "CA";
            regionName = "California";
            break;
          }
        }
        countryCode = c.code;
        countryName = c.name;
        break;
      }
    }
    if (countryCode) break;
  }

  // 2. Identify region / state
  for (let i = 0; i < segments.length; i++) {
    const seg = lowerSegments[i];

    // If country is US or unspecified, test US states
    if (!countryCode || countryCode === "US") {
      for (const st of Object.values(US_STATES)) {
        if (st.aliases.includes(seg)) {
          // If segment is "ca", only match California if country is NOT Canada
          if (seg === "ca" && countryCode === "CA") {
            continue;
          }
          regionCode = st.code;
          regionName = st.name;
          if (!countryCode) {
            countryCode = "US";
            countryName = "United States";
          }
          break;
        }
      }
    }

    // If country is Canada or unspecified, test Canadian provinces
    if (!regionCode && (!countryCode || countryCode === "CA")) {
      for (const prov of Object.values(CA_PROVINCES)) {
        if (prov.aliases.includes(seg)) {
          regionCode = prov.code;
          regionName = prov.name;
          if (!countryCode) {
            countryCode = "CA";
            countryName = "Canada";
          }
          break;
        }
      }
    }
    if (regionCode) break;
  }

  // 3. Identify city (typically first segment if multiple segments exist, or the segment that isn't country/region)
  for (const seg of segments) {
    const lSeg = seg.toLowerCase();
    const isCountry = countryCode && COUNTRIES[countryCode]?.aliases.includes(lSeg);
    const isRegion = (regionCode && US_STATES[regionCode]?.aliases.includes(lSeg)) ||
                     (regionCode && CA_PROVINCES[regionCode]?.aliases.includes(lSeg));
    if (!isCountry && !isRegion) {
      if (!city) {
        city = seg;
      }
    }
  }

  // Check multi-country city ambiguity
  let isAmbiguous = false;
  let ambiguityReason: string | undefined;

  if (city && !countryCode && !regionCode) {
    const cityLower = city.toLowerCase();
    if (MULTI_COUNTRY_CITIES[cityLower]) {
      const options = MULTI_COUNTRY_CITIES[cityLower]
        .map((opt) => `${opt.city}, ${opt.regionCode ? opt.regionCode + ", " : ""}${opt.countryCode}`)
        .join(" or ");
      isAmbiguous = true;
      ambiguityReason = `'${city}' exists in multiple countries: ${options}. Please specify the country/state.`;
    }
  }

  return {
    raw: clean,
    countryCode,
    countryName,
    regionCode,
    regionName,
    city,
    isAmbiguous,
    ambiguityReason,
  };
}

/**
 * Checks if a found location is compatible with a target location requirement.
 * Replaces ambiguous substring matching with strict hierarchical matching.
 */
export function locationsHierarchicallyCompatible(targetRaw: string, foundRaw: string): boolean {
  const targetClean = targetRaw.trim();
  const foundClean = foundRaw.trim();
  if (!targetClean || !foundClean) return false;

  const target = parseLocation(targetClean);
  const found = parseLocation(foundClean);

  // If target is ambiguous without user resolution, reject false match
  if (target.isAmbiguous) {
    // If exact raw string matches, allow it
    return targetClean.toLowerCase() === foundClean.toLowerCase();
  }

  // 1. Country check
  if (target.countryCode && found.countryCode) {
    if (target.countryCode !== found.countryCode) {
      // Different countries CANNOT match!
      // Explicitly fixes California (US) vs Canada (CA)
      return false;
    }
  }

  // 2. Region / State check
  if (target.regionCode && found.regionCode) {
    if (target.regionCode !== found.regionCode) {
      return false;
    }
  }

  // If target specified a region (e.g. "California, US"), and found specified country "US" and region "NY", fail.
  if (target.regionCode && found.countryCode && !found.regionCode) {
    // Found only mentions "USA", but target required California -> not necessarily verified unless city matches
  }

  // 3. City check
  if (target.city && found.city) {
    const tCity = target.city.toLowerCase().replace(/[^a-z0-9]/g, "");
    const fCity = found.city.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (tCity === fCity) {
      // Cities match: verify country wasn't contradictory
      if (target.countryCode && found.countryCode && target.countryCode !== found.countryCode) {
        return false;
      }
      return true;
    }

    // Found city may be a sub-district or neighborhood of target city, or vice-versa
    const fRaw = foundRaw.toLowerCase();
    const tRaw = targetRaw.toLowerCase();
    if (fRaw.includes(target.city.toLowerCase()) || tRaw.includes(found.city.toLowerCase())) {
      if (target.countryCode && found.countryCode && target.countryCode !== found.countryCode) {
        return false;
      }
      return true;
    }
  }

  // 4. If target only specified city and country (e.g. "London, UK"),
  // check if found text contains target city and country
  if (target.city && target.countryCode) {
    const fLower = foundRaw.toLowerCase();
    const cityMatch = fLower.includes(target.city.toLowerCase());
    const countryAliases = COUNTRIES[target.countryCode]?.aliases ?? [];
    const countryMatch = countryAliases.some((alias) => fLower.includes(alias));

    // Must not match conflicting countries
    const conflictingCountries = Object.keys(COUNTRIES).filter((c) => c !== target.countryCode);
    const hasConflict = conflictingCountries.some((c) => {
      // Only conflict if explicit country alias is mentioned in found
      return COUNTRIES[c].aliases.some((a) => a.length > 2 && fLower.includes(a));
    });

    if (cityMatch && (countryMatch || !hasConflict)) {
      return true;
    }
  }

  // 5. If target is a region/state (e.g. "California, US"), check if found text has it
  if (target.regionCode && target.countryCode === "US") {
    const fLower = foundRaw.toLowerCase();
    const state = US_STATES[target.regionCode];
    if (state && state.aliases.some((a) => fLower.includes(a))) {
      // Must not match Canada
      if (fLower.includes("canada") && !fLower.includes("california")) {
        return false;
      }
      return true;
    }
  }

  // 6. If target is country-only (e.g. "Canada")
  if (target.countryCode && !target.city && !target.regionCode) {
    if (found.countryCode === target.countryCode) return true;
    const countryAliases = COUNTRIES[target.countryCode]?.aliases ?? [];
    const fLower = foundRaw.toLowerCase();
    if (countryAliases.some((alias) => fLower.includes(alias))) {
      // Must ensure not California US
      if (target.countryCode === "CA" && (fLower.includes("california") || fLower.includes("usa"))) {
        return false;
      }
      return true;
    }
  }

  return false;
}
