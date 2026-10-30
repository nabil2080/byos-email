/**
 * BYOS Calendar - Category 13: Contacts & Birthday Integration
 * Projects contact birthdays into annual recurring calendar events.
 */

import { ContactItem } from "../api";
import { DecryptedEventRecord } from "../components/calendar/CalendarSidebar";

export interface ContactBirthdayInfo {
  contactId: string;
  name: string;
  email?: string;
  birthMonth: number; // 0-indexed (0 = Jan, 11 = Dec)
  birthDay: number;   // 1 - 31
  birthYear?: number;
}

/**
 * Parses birthday information from a contact's notes or fields.
 */
export function extractBirthdayFromContact(contact: ContactItem): ContactBirthdayInfo | null {
  if (!contact) return null;

  const textToScan = `${contact.name || ""} ${contact.notes || ""}`;

  // Patterns:
  // "Birthday: 1990-05-24" or "Birthday: 05/24/1990" or "bday: 05/24" or "DOB: 1985-12-01"
  const isoMatch = textToScan.match(/\b(?:Birthday|bday|DOB|born)[\s:]*(\d{4})-(\d{2})-(\d{2})\b/i);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      return {
        contactId: contact.id,
        name: contact.name || contact.email || "Contact",
        email: contact.email,
        birthMonth: m,
        birthDay: d,
        birthYear: y,
      };
    }
  }

  const slashMatch = textToScan.match(/\b(?:Birthday|bday|DOB|born)[\s:]*(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/i);
  if (slashMatch) {
    const m = parseInt(slashMatch[1], 10) - 1;
    const d = parseInt(slashMatch[2], 10);
    const y = slashMatch[3] ? parseInt(slashMatch[3], 10) : undefined;
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      return {
        contactId: contact.id,
        name: contact.name || contact.email || "Contact",
        email: contact.email,
        birthMonth: m,
        birthDay: d,
        birthYear: y,
      };
    }
  }

  // Month name match: "Birthday: May 24" or "Birthday: October 30, 1992"
  const nameMatch = textToScan.match(/\b(?:Birthday|bday|DOB|born)[\s:]*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i);
  if (nameMatch) {
    const months: Record<string, number> = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
      aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
      nov: 10, november: 10, dec: 11, december: 11,
    };
    const m = months[nameMatch[1].toLowerCase()];
    const d = parseInt(nameMatch[2], 10);
    const y = nameMatch[3] ? parseInt(nameMatch[3], 10) : undefined;
    if (m !== undefined && d >= 1 && d <= 31) {
      return {
        contactId: contact.id,
        name: contact.name || contact.email || "Contact",
        email: contact.email,
        birthMonth: m,
        birthDay: d,
        birthYear: y,
      };
    }
  }

  return null;
}

/**
 * Projects contact birthdays into synthetic all-day calendar event records.
 */
export function generateContactBirthdayEvents(
  contacts: ContactItem[],
  startYear: number,
  endYear: number
): DecryptedEventRecord[] {
  const events: DecryptedEventRecord[] = [];

  for (const contact of contacts) {
    const bday = extractBirthdayFromContact(contact);
    if (!bday) continue;

    for (let year = startYear; year <= endYear; year++) {
      const startDate = new Date(Date.UTC(year, bday.birthMonth, bday.birthDay, 0, 0, 0));
      const endDate = new Date(Date.UTC(year, bday.birthMonth, bday.birthDay, 23, 59, 59));

      const age = bday.birthYear ? year - bday.birthYear : undefined;
      const title = age && age > 0
        ? `${bday.name}'s Birthday (${age}th)`
        : `${bday.name}'s Birthday`;

      events.push({
        id: `bday_${bday.contactId}_${year}`,
        calendarId: "contacts_birthdays",
        startTime: startDate,
        endTime: endDate,
        isAllDay: true,
        status: "free",
        format: "aes-gcm-envelope",
        details: {
          title,
          description: `Annual birthday reminder for ${bday.name}${bday.email ? ` (${bday.email})` : ""}.\nSource: Contacts integration`,
          color: "#9E725F",
          visibility: "public",
          eventType: "default",
        },
      });
    }
  }

  return events;
}
