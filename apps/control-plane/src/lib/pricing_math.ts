// B2B Infrastructure Pricing Math: 5% Compounding Graduated Bracket Engine

export type BillingCycle = "monthly" | "annual";

export interface TierBracket {
  tier: number;
  name: string;
  rangeLabel: string;
  minSeats: number;
  maxSeats: number;
  unitRate: number;
  discountBadge?: string;
}

export interface WaterfallLine {
  tier: number;
  name: string;
  rangeLabel: string;
  seatsInTier: number;
  unitRate: number;
  cost: number;
  annualCost: number;
  monthlyEquivalentCost: number;
  discountBadge?: string;
}

export interface ResourceLimits {
  maxDomains: number;
  maxAliases: number;
  extraDomainPriceMonthly: number;
}

export interface PricingBreakdown {
  seatCount: number;
  billingCycle: BillingCycle;
  lines: WaterfallLine[];
  baseMonthlyTotal: number;
  totalMonthlyCost: number; // monthly: baseMonthlyTotal; annual: monthly equivalent rate ((annualTotal)/12)
  totalAmount: number;      // total upfront charge: monthly = baseMonthlyTotal; annual = baseMonthlyTotal * 10
  annualTotal: number;      // baseMonthlyTotal * 10 (or baseMonthlyTotal * 12 without discount)
  annualSavings: number;    // baseMonthlyTotal * 2
  blendedRate: number;      // effective blended rate per mailbox per month
  resourceLimits: ResourceLimits;
}

export const TIER_BRACKETS: readonly TierBracket[] = [
  {
    tier: 1,
    name: "Tier 1",
    rangeLabel: "Seats 1–10",
    minSeats: 1,
    maxSeats: 10,
    unitRate: 3.00,
  },
  {
    tier: 2,
    name: "Tier 2",
    rangeLabel: "Seats 11–25",
    minSeats: 11,
    maxSeats: 25,
    unitRate: 2.85,
    discountBadge: "-5% Volume Discount",
  },
  {
    tier: 3,
    name: "Tier 3",
    rangeLabel: "Seats 26–50",
    minSeats: 26,
    maxSeats: 50,
    unitRate: 2.71,
    discountBadge: "-10% Volume Discount",
  },
  {
    tier: 4,
    name: "Tier 4",
    rangeLabel: "Seats 51–100",
    minSeats: 51,
    maxSeats: 100,
    unitRate: 2.57,
    discountBadge: "-14% Volume Discount",
  },
  {
    tier: 5,
    name: "Tier 5",
    rangeLabel: "Seats 101+",
    minSeats: 101,
    maxSeats: Infinity,
    unitRate: 2.44,
    discountBadge: "-19% Volume Discount",
  },
];

/**
 * Calculates dynamic resource limits based on provisioned seat count:
 * - Aliases: seat_count * 10
 * - Domains: <= 10 -> 3; 11-25 -> 5; >= 26 -> 10
 * - Extra domain add-on: $1.50/month
 */
export function calculateResourceLimits(seats: number): ResourceLimits {
  const seatCount = Math.max(1, Math.floor(seats || 1));
  const maxAliases = seatCount * 10;
  let maxDomains = 3;
  if (seatCount >= 26) {
    maxDomains = 10;
  } else if (seatCount >= 11) {
    maxDomains = 5;
  }
  return {
    maxDomains,
    maxAliases,
    extraDomainPriceMonthly: 1.50,
  };
}

/**
 * Calculates graduated pricing for a given mailbox count and billing cycle.
 * Progressive brackets step down by ~5% compounding discount.
 * 
 * Billing Cycle Modifier:
 * - Monthly: Total = Calculated Monthly Total
 * - Annual: Total = Calculated Monthly Total * 10 (2 Months Free: 12 months for price of 10)
 * - Annual Blended Rate: (Annual Total / 12) / seat_count
 */
export function calculateGraduatedPricing(
  seats: number,
  billingCycle: BillingCycle = "annual"
): PricingBreakdown {
  const seatCount = Math.max(1, Math.floor(seats || 1));
  const lines: WaterfallLine[] = [];
  let remaining = seatCount;
  let baseMonthlyCost = 0;

  for (const bracket of TIER_BRACKETS) {
    if (remaining <= 0) break;
    const capacity =
      bracket.maxSeats === Infinity
        ? remaining
        : bracket.maxSeats - bracket.minSeats + 1;
    const seatsInTier = Math.min(remaining, capacity);

    if (seatsInTier > 0) {
      const cost = Math.round(seatsInTier * bracket.unitRate * 100) / 100;
      baseMonthlyCost += cost;
      const annualCost = Math.round(cost * 10 * 100) / 100;
      const monthlyEquivalentCost = Math.round((cost * 10 / 12) * 100) / 100;
      lines.push({
        tier: bracket.tier,
        name: bracket.name,
        rangeLabel: bracket.rangeLabel,
        seatsInTier,
        unitRate: bracket.unitRate,
        cost,
        annualCost,
        monthlyEquivalentCost,
        discountBadge: bracket.discountBadge,
      });
      remaining -= seatsInTier;
    }
  }

  const baseMonthlyTotal = Math.round(baseMonthlyCost * 100) / 100;
  const resourceLimits = calculateResourceLimits(seatCount);

  if (billingCycle === "annual") {
    const annualTotal = Math.round(baseMonthlyTotal * 10 * 100) / 100; // 12 months for price of 10
    const totalAmount = annualTotal;
    const totalMonthlyCost = Math.round((annualTotal / 12) * 100) / 100;
    const annualSavings = Math.round(baseMonthlyTotal * 2 * 100) / 100;
    const blendedRate = Math.round(((annualTotal / 12) / seatCount) * 100) / 100;

    return {
      seatCount,
      billingCycle,
      lines,
      baseMonthlyTotal,
      totalMonthlyCost,
      totalAmount,
      annualTotal,
      annualSavings,
      blendedRate,
      resourceLimits,
    };
  }

  // Monthly billing cycle
  const totalAmount = baseMonthlyTotal;
  const totalMonthlyCost = baseMonthlyTotal;
  const annualTotal = Math.round(baseMonthlyTotal * 12 * 100) / 100;
  const annualSavings = 0;
  const blendedRate = Math.round((baseMonthlyTotal / seatCount) * 100) / 100;

  return {
    seatCount,
    billingCycle,
    lines,
    baseMonthlyTotal,
    totalMonthlyCost,
    totalAmount,
    annualTotal,
    annualSavings,
    blendedRate,
    resourceLimits,
  };
}
