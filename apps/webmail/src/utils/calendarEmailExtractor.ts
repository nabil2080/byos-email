/**
 * BYOS Calendar - Category 13: Email and External Integrations
 * Client-Side Local Event Detection & Extraction Engine
 * 
 * PRIVACY GUARANTEE:
 * This parser operates exclusively on local decrypted email plaintext in client memory.
 * No decrypted content or email data is ever transmitted to a server or third-party service.
 */

export type EmailExtractionCategory = "flight" | "hotel" | "restaurant" | "ticket" | "event";

export interface DetectedEmailEvent {
  id: string; // Deterministic ID derived from messageId + category + confirmationCode
  messageId: string;
  messageSubject: string;
  category: EmailExtractionCategory;
  categoryLabel: string;
  title: string;
  description: string;
  location?: string;
  meetingUrl?: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
  allDay: boolean;
  confirmationCode?: string;
  provider?: string;
  isCancellation: boolean;
  confidence: "high" | "medium";
}

export interface EmailExtractionOptions {
  enabled?: boolean;
  categories?: {
    flights?: boolean;
    hotels?: boolean;
    restaurants?: boolean;
    tickets?: boolean;
    events?: boolean;
  };
}

/**
 * Cleans HTML markup from email content to safe plaintext for regex extraction.
 */
function cleanHtmlToPlaintext(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .replace(/\n\s*\n+/g, "\n\n");
}

/**
 * Normalizes dates and strings extracted from emails into safe Date objects.
 */
function parseDateFlexible(dateStr: string, timeStr?: string): Date | null {
  if (!dateStr) return null;
  const cleanDate = dateStr.trim();
  const cleanTime = (timeStr || "").trim();

  // Try standard Date.parse first
  const combined = cleanTime ? `${cleanDate} ${cleanTime}` : cleanDate;
  const parsed = new Date(combined);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  // Handle formats like "October 30, 2026" or "Oct 30, 2026"
  const monthMatch = cleanDate.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (monthMatch) {
    const months: Record<string, number> = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
      aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
      nov: 10, november: 10, dec: 11, december: 11,
    };
    const m = months[monthMatch[1].toLowerCase()];
    const d = parseInt(monthMatch[2], 10);
    const y = parseInt(monthMatch[3], 10);
    
    let hours = 9;
    let minutes = 0;
    if (cleanTime) {
      const timeMatch = cleanTime.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
      if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        minutes = parseInt(timeMatch[2], 10);
        if (timeMatch[3]?.toUpperCase() === "PM" && hours < 12) hours += 12;
        if (timeMatch[3]?.toUpperCase() === "AM" && hours === 12) hours = 0;
      }
    }
    const res = new Date(Date.UTC(y, m, d, hours, minutes, 0));
    if (!isNaN(res.getTime())) return res;
  }

  // Handle YYYY-MM-DD
  const isoMatch = cleanDate.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    let hours = 9;
    let minutes = 0;
    if (cleanTime) {
      const timeMatch = cleanTime.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
      if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        minutes = parseInt(timeMatch[2], 10);
        if (timeMatch[3]?.toUpperCase() === "PM" && hours < 12) hours += 12;
        if (timeMatch[3]?.toUpperCase() === "AM" && hours === 12) hours = 0;
      }
    }
    const res = new Date(Date.UTC(y, m, d, hours, minutes, 0));
    if (!isNaN(res.getTime())) return res;
  }

  return null;
}

const COMMON_IGNORE_WORDS = new Set([
  "confirmation", "reservation", "number", "booking", "reference",
  "flight", "hotel", "table", "order", "notice", "american", "delta",
  "united", "british", "airways", "southwest", "alaska", "jetblue",
  "lufthansa", "opentable", "ticketmaster", "eventbrite", "hilton",
  "marriott", "hyatt", "details", "summary", "information", "receipt",
  "invoice", "support", "customer", "account", "service", "welcome",
  "thank", "thanks", "please", "your", "about", "origin", "destination",
]);

/**
 * Extracts confirmation code from text avoiding common keywords.
 * Checks primary text (cleanBody) first, then falls back to fallbackText (subject).
 */
function extractConfirmationCode(primaryText: string, fallbackText?: string): string | undefined {
  const findIn = (text: string): string | undefined => {
    if (!text) return undefined;
    const matches = text.matchAll(/\b(?:Confirmation|Reservation|Booking Ref|Order|Record Locator|Ticket|Webinar ID|Barcode)(?:\s+(?:Number|No|Code|Ref|ID|Locator))?[\s#:]+([A-Z0-9-]{4,20})\b/gi);
    for (const match of matches) {
      const val = match[1].trim();
      if (!COMMON_IGNORE_WORDS.has(val.toLowerCase())) {
        return val.toUpperCase();
      }
    }
    return undefined;
  };

  return findIn(primaryText) || (fallbackText ? findIn(fallbackText) : undefined);
}

/**
 * Extracts event candidates from decrypted email plaintext.
 */
export function extractEventFromEmail(
  message: { id: string; subject: string; body: string },
  options?: EmailExtractionOptions
): DetectedEmailEvent | null {
  if (!message || !message.body || !message.subject) return null;
  if (options && options.enabled === false) return null;

  const cats = {
    flights: options?.categories?.flights !== false,
    hotels: options?.categories?.hotels !== false,
    restaurants: options?.categories?.restaurants !== false,
    tickets: options?.categories?.tickets !== false,
    events: options?.categories?.events !== false,
  };

  const subject = message.subject;
  const rawBody = message.body;
  const cleanBody = rawBody.includes("<") ? cleanHtmlToPlaintext(rawBody) : rawBody;
  const fullText = `${subject}\n${cleanBody}`;

  // Check for cancellation keywords
  const isCancellation = /\b(?:cancellation|cancelled|canceled|has been cancelled|has been canceled|reservation cancelled|booking cancelled)\b/i.test(fullText);

  // 1. FLIGHT EXTRACTION
  if (cats.flights) {
    const flightMatch = fullText.match(/\b(?:Flight|FLT)[\s#:]*([A-Z0-9]{2}\s?\d{2,4})\b/i);
    const airlineMatch = fullText.match(/\b(American Airlines|Delta Air Lines|Delta|United Airlines|United|Lufthansa|British Airways|Air France|KLM|Emirates|Qatar Airways|Singapore Airlines|Southwest Airlines|Southwest|Alaska Airlines|JetBlue)\b/i);
    
    if (flightMatch || (airlineMatch && /\b(?:flight|departing|arriving|boarding|terminal)\b/i.test(fullText))) {
      const flightNum = flightMatch ? flightMatch[1].replace(/\s+/g, "") : "Flight";
      const airline = airlineMatch ? airlineMatch[1] : "Airline";

      // Route detection: e.g. "From: New York (JFK) to San Francisco (SFO)"
      const routeMatch = fullText.match(/\b(?:from|departing)[:\s]+([A-Za-z\s]+?(?:\([A-Z]{3}\)|[A-Z]{3})?)\s+(?:to|arriving at)[:\s]+([A-Za-z\s]+?(?:\([A-Z]{3}\)|[A-Z]{3})?)(?:[.,\n\r<]|$)/i);
      const origin = routeMatch ? routeMatch[1].trim() : "Origin";
      const destination = routeMatch ? routeMatch[2].trim() : "Destination";

      // Confirmation / PNR code
      const pnr = extractConfirmationCode(cleanBody, subject);

      // Dates
      const dateMatch = fullText.match(/\b(?:Date|Departure Date|Departs)[\s:]*([A-Za-z0-9,\s\/-]+?)(?:\s+at|\s+time:|\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)|[,\n]|$)/i);
      const timeMatch = fullText.match(/\b(?:Time|Departure Time|Departs)[\s:]*(\d{1,2}:\d{2}(?:\s*[AP]M)?)\b/i);

      let startDate = parseDateFlexible(dateMatch ? dateMatch[1] : "", timeMatch ? timeMatch[1] : "");
      if (!startDate) {
        // Fallback: search for date within body
        const anyDate = fullText.match(/\b(?:20\d{2}-\d{2}-\d{2}|[A-Z][a-z]{2,8}\s+\d{1,2},?\s+20\d{2})\b/);
        if (anyDate) startDate = parseDateFlexible(anyDate[0], "09:00");
      }
      if (!startDate) {
        // Safe default: 3 days from now
        startDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      }

      // Default flight duration: 3 hours
      const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000);

      const title = isCancellation
        ? `[CANCELLED] ${airline} ${flightNum}: ${origin} to ${destination}`
        : `${airline} ${flightNum}: ${origin} to ${destination}`;

      const description = `Flight reservation for ${airline} ${flightNum}.\nRoute: ${origin} -> ${destination}${pnr ? `\nConfirmation Code: ${pnr}` : ""}\nSource: BYOS Mail extraction`;

      return {
        id: `email_flight_${message.id}_${pnr || flightNum}`,
        messageId: message.id,
        messageSubject: subject,
        category: "flight",
        categoryLabel: "Flight Reservation",
        title,
        description,
        location: `${origin} -> ${destination}`,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        allDay: false,
        confirmationCode: pnr,
        provider: airline,
        isCancellation,
        confidence: pnr && flightMatch ? "high" : "medium",
      };
    }
  }

  // 2. HOTEL EXTRACTION
  if (cats.hotels) {
    const hotelBrandMatch = fullText.match(/\b(Marriott|Hilton|Hyatt|Sheraton|Westin|Holiday Inn|InterContinental|Ritz-Carlton|Four Seasons|Accor|Airbnb|Booking\.com|Expedia|Hotels\.com)\b/i);
    const hotelKeywordMatch = fullText.match(/\b(hotel reservation|lodging confirmation|hotel booking|check-in|check in date)\b/i);

    if (hotelBrandMatch || hotelKeywordMatch) {
      const brand = hotelBrandMatch ? hotelBrandMatch[1] : "Hotel";

      // Confirmation code
      const confCode = extractConfirmationCode(cleanBody, subject);

      // Check-in and Check-out
      const checkInMatch = fullText.match(/\b(?:Check-in|Check in|Arrival)[\s:]*([A-Za-z0-9,\s\/-]+?)(?:[,\n]|$)/i);
      const checkOutMatch = fullText.match(/\b(?:Check-out|Check out|Departure)[\s:]*([A-Za-z0-9,\s\/-]+?)(?:[,\n]|$)/i);

      let checkInDate = parseDateFlexible(checkInMatch ? checkInMatch[1] : "", "15:00");
      let checkOutDate = parseDateFlexible(checkOutMatch ? checkOutMatch[1] : "", "11:00");

      if (!checkInDate) {
        const anyDate = fullText.match(/\b(?:20\d{2}-\d{2}-\d{2}|[A-Z][a-z]{2,8}\s+\d{1,2},?\s+20\d{2})\b/);
        checkInDate = anyDate ? parseDateFlexible(anyDate[0], "15:00") : new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      }
      if (!checkOutDate && checkInDate) {
        checkOutDate = new Date(checkInDate.getTime() + 2 * 24 * 60 * 60 * 1000);
      }

      // Address / Location
      const addressMatch = fullText.match(/\b(?:Address|Property Location)[\s:]*([^\n\r]+)/i);
      const location = addressMatch ? addressMatch[1].trim() : `${brand} Property`;

      const title = isCancellation
        ? `[CANCELLED] ${brand} Stay: ${location}`
        : `${brand} Stay: ${location}`;

      const description = `Hotel reservation at ${brand}.\nCheck-in: ${checkInDate?.toISOString().slice(0, 10)}\nCheck-out: ${checkOutDate?.toISOString().slice(0, 10)}${confCode ? `\nConfirmation Code: ${confCode}` : ""}\nSource: BYOS Mail extraction`;

      return {
        id: `email_hotel_${message.id}_${confCode || brand}`,
        messageId: message.id,
        messageSubject: subject,
        category: "hotel",
        categoryLabel: "Hotel Stay",
        title,
        description,
        location,
        startTime: checkInDate!.toISOString(),
        endTime: checkOutDate!.toISOString(),
        allDay: false,
        confirmationCode: confCode,
        provider: brand,
        isCancellation,
        confidence: confCode ? "high" : "medium",
      };
    }
  }

  // 3. RESTAURANT EXTRACTION
  if (cats.restaurants) {
    const diningMatch = fullText.match(/\b(OpenTable|Resy|SevenRooms|Tock|restaurant reservation|table reservation|dinner reservation|lunch reservation)\b/i);
    if (diningMatch) {
      const provider = diningMatch[1];
      const partyMatch = fullText.match(/\b(?:Party of|Guests?|Table for)[\s:]*(\d+)\b/i);
      const partySize = partyMatch ? partyMatch[1] : "2";

      const confCode = extractConfirmationCode(cleanBody, subject);

      // Extract Restaurant Name
      const restNameMatch = fullText.match(/\b(?:at|Restaurant)[\s:]*([A-Z][A-Za-z0-9'\s&-]{2,30}?)(?:\s+on|\s+for|\s+date|\s+time|[,\n]|$)/i);
      const restaurantName = restNameMatch ? restNameMatch[1].trim() : "Restaurant";

      // Time
      const dateMatch = fullText.match(/\b(?:Date|Reservation Date)[\s:]*([A-Za-z0-9,\s\/-]+?)(?:[,\n]|$)/i);
      const timeMatch = fullText.match(/\b(?:Time|Reservation Time)[\s:]*(\d{1,2}:\d{2}(?:\s*[AP]M)?)\b/i);

      let resDate = parseDateFlexible(dateMatch ? dateMatch[1] : "", timeMatch ? timeMatch[1] : "19:00");
      if (!resDate) {
        const anyDate = fullText.match(/\b(?:20\d{2}-\d{2}-\d{2}|[A-Z][a-z]{2,8}\s+\d{1,2},?\s+20\d{2})\b/);
        resDate = anyDate ? parseDateFlexible(anyDate[0], "19:00") : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      }
      const endDate = new Date(resDate!.getTime() + 90 * 60 * 1000); // 90 min dinner

      const title = isCancellation
        ? `[CANCELLED] Dining: ${restaurantName} (Table for ${partySize})`
        : `Dining: ${restaurantName} (Table for ${partySize})`;

      const description = `Dining reservation at ${restaurantName}.\nParty Size: ${partySize}${confCode ? `\nConfirmation Code: ${confCode}` : ""}\nSource: BYOS Mail extraction`;

      return {
        id: `email_rest_${message.id}_${confCode || restaurantName}`,
        messageId: message.id,
        messageSubject: subject,
        category: "restaurant",
        categoryLabel: "Restaurant Reservation",
        title,
        description,
        location: restaurantName,
        startTime: resDate!.toISOString(),
        endTime: endDate.toISOString(),
        allDay: false,
        confirmationCode: confCode,
        provider,
        isCancellation,
        confidence: partyMatch && confCode ? "high" : "medium",
      };
    }
  }

  // 4. TICKETS & ENTERTAINMENT EXTRACTION
  if (cats.tickets) {
    const ticketMatch = fullText.match(/\b(Ticketmaster|Eventbrite|StubHub|AXS|Live Nation|Fandango|concert ticket|movie ticket|admission ticket|e-ticket)\b/i);
    if (ticketMatch) {
      const provider = ticketMatch[1];
      const confCode = extractConfirmationCode(cleanBody, subject);

      const venueMatch = fullText.match(/\b(?:Venue|Location)[\s:]*([^\n\r]+)/i);
      const venue = venueMatch ? venueMatch[1].trim() : "Venue";

      // Event title from subject
      const eventName = subject.replace(/tickets?|confirmation|order/gi, "").trim() || "Ticketed Event";

      const dateMatch = fullText.match(/\b(?:Date|Show Date|Event Date)[\s:]*([A-Za-z0-9,\s\/-]+?)(?:[,\n]|$)/i);
      const timeMatch = fullText.match(/\b(?:Time|Show Time|Doors)[\s:]*(\d{1,2}:\d{2}(?:\s*[AP]M)?)\b/i);

      let showDate = parseDateFlexible(dateMatch ? dateMatch[1] : "", timeMatch ? timeMatch[1] : "19:30");
      if (!showDate) {
        const anyDate = fullText.match(/\b(?:20\d{2}-\d{2}-\d{2}|[A-Z][a-z]{2,8}\s+\d{1,2},?\s+20\d{2})\b/);
        showDate = anyDate ? parseDateFlexible(anyDate[0], "19:30") : new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
      }
      const endDate = new Date(showDate!.getTime() + 2 * 60 * 60 * 1000); // 2 hours

      const title = isCancellation
        ? `[CANCELLED] ${eventName} @ ${venue}`
        : `${eventName} @ ${venue}`;

      const description = `Admission ticket for ${eventName}.\nVenue: ${venue}${confCode ? `\nOrder / Ticket #: ${confCode}` : ""}\nSource: BYOS Mail extraction`;

      return {
        id: `email_ticket_${message.id}_${confCode || eventName}`,
        messageId: message.id,
        messageSubject: subject,
        category: "ticket",
        categoryLabel: "Ticket / Admission",
        title,
        description,
        location: venue,
        startTime: showDate!.toISOString(),
        endTime: endDate.toISOString(),
        allDay: false,
        confirmationCode: confCode,
        provider,
        isCancellation,
        confidence: confCode ? "high" : "medium",
      };
    }
  }

  // 5. WEBINARS & VIRTUAL CONFERENCES
  if (cats.events) {
    const webinarMatch = fullText.match(/\b(webinar|online conference|summit|symposium|zoom meeting|virtual workshop)\b/i);
    const meetingUrlMatch = fullText.match(/\b(https:\/\/[a-z0-9-]+\.(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|webex\.com)\/[^\s<>"']+)\b/i);

    if (webinarMatch || meetingUrlMatch) {
      const meetingUrl = meetingUrlMatch ? meetingUrlMatch[1] : undefined;
      const confCode = extractConfirmationCode(cleanBody, subject);

      const dateMatch = fullText.match(/\b(?:Date)[\s:]*([A-Za-z0-9,\s\/-]+?)(?:[,\n]|$)/i);
      const timeMatch = fullText.match(/\b(?:Time)[\s:]*(\d{1,2}:\d{2}(?:\s*[AP]M)?)\b/i);

      let startDate = parseDateFlexible(dateMatch ? dateMatch[1] : "", timeMatch ? timeMatch[1] : "10:00");
      if (!startDate) {
        const anyDate = fullText.match(/\b(?:20\d{2}-\d{2}-\d{2}|[A-Z][a-z]{2,8}\s+\d{1,2},?\s+20\d{2})\b/);
        startDate = anyDate ? parseDateFlexible(anyDate[0], "10:00") : new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
      }
      const endDate = new Date(startDate!.getTime() + 60 * 60 * 1000); // 1 hour

      const title = isCancellation ? `[CANCELLED] ${subject}` : subject;
      const description = `Registration confirmation for: ${subject}${meetingUrl ? `\nJoin URL: ${meetingUrl}` : ""}${confCode ? `\nRegistration ID: ${confCode}` : ""}\nSource: BYOS Mail extraction`;

      return {
        id: `email_event_${message.id}_${confCode || 'webinar'}`,
        messageId: message.id,
        messageSubject: subject,
        category: "event",
        categoryLabel: "Webinar / Event Registration",
        title,
        description,
        location: meetingUrl ? "Virtual" : undefined,
        meetingUrl,
        startTime: startDate!.toISOString(),
        endTime: endDate.toISOString(),
        allDay: false,
        confirmationCode: confCode,
        provider: "Virtual Platform",
        isCancellation,
        confidence: meetingUrl ? "high" : "medium",
      };
    }
  }

  return null;
}
