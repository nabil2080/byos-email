import { calculateGraduatedPricing, calculateResourceLimits, TIER_BRACKETS } from "./pricing_math.js";

export function runPricingMathTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      passed++;
    } else {
      failed++;
      console.error(`  FAIL: ${msg}`);
    }
  }

  // =========================================================================
  // 1. Monthly Cycle Tests (Base Graduated Pricing)
  // =========================================================================
  {
    // Single Seat (N=1)
    const res = calculateGraduatedPricing(1, "monthly");
    assert(res.seatCount === 1, "N=1 seatCount should be 1");
    assert(res.lines.length === 1, "N=1 should only unlock Tier 1");
    assert(res.lines[0].tier === 1, "N=1 line should be Tier 1");
    assert(res.lines[0].seatsInTier === 1, "N=1 Tier 1 seats should be 1");
    assert(res.lines[0].cost === 3.00, "N=1 Tier 1 cost should be 3.00");
    assert(res.totalMonthlyCost === 3.00, "N=1 monthly total should be 3.00");
    assert(res.totalAmount === 3.00, "N=1 monthly charge amount should be 3.00");
    assert(res.blendedRate === 3.00, "N=1 blended should be 3.00");
  }

  {
    // Tier 1 Full (N=10)
    const res = calculateGraduatedPricing(10, "monthly");
    assert(res.seatCount === 10, "N=10 seatCount should be 10");
    assert(res.lines.length === 1, "N=10 should only have 1 line");
    assert(res.lines[0].seatsInTier === 10, "N=10 Tier 1 seats should be 10");
    assert(res.lines[0].cost === 30.00, "N=10 Tier 1 cost should be 30.00");
    assert(res.totalMonthlyCost === 30.00, "N=10 monthly total should be 30.00");
    assert(res.blendedRate === 3.00, "N=10 blended should be 3.00");
  }

  {
    // Partial Tier 2 (N=12)
    const res = calculateGraduatedPricing(12, "monthly");
    assert(res.seatCount === 12, "N=12 seatCount should be 12");
    assert(res.lines.length === 2, "N=12 must have exactly 2 lines (Tiers 3,4,5 hidden)");
    assert(res.lines[0].cost === 30.00, "N=12 Tier 1 cost is 30.00");
    assert(res.lines[1].seatsInTier === 2, "N=12 Tier 2 has 2 seats");
    assert(res.lines[1].cost === 5.70, "N=12 Tier 2 cost is 5.70");
    assert(res.totalMonthlyCost === 35.70, "N=12 monthly total is 35.70");
    assert(res.blendedRate === 2.98, `N=12 blended rate is 2.98 (got ${res.blendedRate})`);
  }

  {
    // User Spec Canonical Example (N=74)
    const res = calculateGraduatedPricing(74, "monthly");
    assert(res.seatCount === 74, "N=74 seatCount should be 74");
    assert(res.lines.length === 4, "N=74 must have exactly 4 lines (Tier 5 hidden)");
    assert(res.lines[0].cost === 30.00, "N=74 Tier 1 = 30.00");
    assert(res.lines[1].cost === 42.75, "N=74 Tier 2 = 42.75");
    assert(res.lines[2].cost === 67.75, "N=74 Tier 3 = 67.75");
    assert(res.lines[3].cost === 61.68, "N=74 Tier 4 = 61.68");
    assert(res.totalMonthlyCost === 202.18, `N=74 total should be 202.18 (got ${res.totalMonthlyCost})`);
    assert(res.blendedRate === 2.73, `N=74 blended should be 2.73 (got ${res.blendedRate})`);
  }

  {
    // Tier 5 Unlocked (N=120)
    const res = calculateGraduatedPricing(120, "monthly");
    assert(res.lines.length === 5, "N=120 unlocks all 5 tiers");
    assert(res.totalMonthlyCost === 317.80, `N=120 monthly total is 317.80 (got ${res.totalMonthlyCost})`);
    assert(res.blendedRate === 2.65, `N=120 blended rate is 2.65 (got ${res.blendedRate})`);
  }

  // =========================================================================
  // 2. Annual Cycle Tests (2 Months Free: Total = Monthly * 10)
  // =========================================================================
  {
    // N=1 Annual
    const res = calculateGraduatedPricing(1, "annual");
    assert(res.billingCycle === "annual", "Billing cycle should be annual");
    assert(res.baseMonthlyTotal === 3.00, "N=1 base monthly total is 3.00");
    assert(res.annualTotal === 30.00, "N=1 annual total is 30.00 (3.00 * 10)");
    assert(res.totalAmount === 30.00, "N=1 upfront charge is 30.00");
    assert(res.annualSavings === 6.00, "N=1 annual savings is 6.00 (3.00 * 2)");
    assert(res.totalMonthlyCost === 2.50, "N=1 equivalent monthly cost is 2.50 (30.00 / 12)");
    assert(res.blendedRate === 2.50, "N=1 blended annual rate is 2.50");
  }

  {
    // N=10 Annual
    const res = calculateGraduatedPricing(10, "annual");
    assert(res.baseMonthlyTotal === 30.00, "N=10 base monthly is 30.00");
    assert(res.annualTotal === 300.00, "N=10 annual total is 300.00 (30.00 * 10)");
    assert(res.totalAmount === 300.00, "N=10 total upfront cost is 300.00");
    assert(res.annualSavings === 60.00, "N=10 annual savings is 60.00 (30.00 * 2)");
    assert(res.totalMonthlyCost === 25.00, "N=10 monthly equivalent is 25.00");
    assert(res.blendedRate === 2.50, "N=10 annualized blended rate is 2.50");
  }

  {
    // N=74 Annual Canonical Test
    // Monthly = $202.18
    // Annual = $2,021.80 ($202.18 * 10)
    // Monthly Equivalent = $168.48 ($2,021.80 / 12)
    // Blended Rate = (2021.80 / 12) / 74 = $2.28 / box / mo
    // Annual Savings = $404.36 ($202.18 * 2)
    const res = calculateGraduatedPricing(74, "annual");
    assert(res.baseMonthlyTotal === 202.18, "N=74 base monthly total is 202.18");
    assert(res.annualTotal === 2021.80, `N=74 annual total is 2021.80 (got ${res.annualTotal})`);
    assert(res.totalAmount === 2021.80, "N=74 total upfront cost is 2021.80");
    assert(res.totalMonthlyCost === 168.48, `N=74 monthly equivalent is 168.48 (got ${res.totalMonthlyCost})`);
    assert(res.annualSavings === 404.36, `N=74 annual savings is 404.36 (got ${res.annualSavings})`);
    assert(res.blendedRate === 2.28, `N=74 annualized blended rate is 2.28 (got ${res.blendedRate})`);
    const linesMonthlySum = Math.round(res.lines.reduce((acc, l) => acc + l.monthlyEquivalentCost, 0) * 100) / 100;
    assert(linesMonthlySum === res.totalMonthlyCost, `N=74 line items monthly sum (${linesMonthlySum}) must equal totalMonthlyCost (${res.totalMonthlyCost})`);
    const linesAnnualSum = Math.round(res.lines.reduce((acc, l) => acc + l.annualCost, 0) * 100) / 100;
    assert(linesAnnualSum === res.annualTotal, `N=74 line items annual sum (${linesAnnualSum}) must equal annualTotal (${res.annualTotal})`);
  }

  // =========================================================================
  // 3. Dynamic Resource Limits Tests
  // =========================================================================
  {
    // Seats <= 10 -> 3 domains, seats * 10 aliases
    const lim1 = calculateResourceLimits(1);
    assert(lim1.maxDomains === 3, "N=1 maxDomains should be 3");
    assert(lim1.maxAliases === 10, "N=1 maxAliases should be 10");
    assert(lim1.extraDomainPriceMonthly === 1.50, "Extra domain add-on rate is 1.50");

    const lim10 = calculateResourceLimits(10);
    assert(lim10.maxDomains === 3, "N=10 maxDomains should be 3");
    assert(lim10.maxAliases === 100, "N=10 maxAliases should be 100");

    // Seats 11-25 -> 5 domains
    const lim11 = calculateResourceLimits(11);
    assert(lim11.maxDomains === 5, "N=11 maxDomains should be 5");
    assert(lim11.maxAliases === 110, "N=11 maxAliases should be 110");

    const lim25 = calculateResourceLimits(25);
    assert(lim25.maxDomains === 5, "N=25 maxDomains should be 5");
    assert(lim25.maxAliases === 250, "N=25 maxAliases should be 250");

    // Seats >= 26 -> 10 domains
    const lim26 = calculateResourceLimits(26);
    assert(lim26.maxDomains === 10, "N=26 maxDomains should be 10");
    assert(lim26.maxAliases === 260, "N=26 maxAliases should be 260");

    const lim74 = calculateResourceLimits(74);
    assert(lim74.maxDomains === 10, "N=74 maxDomains should be 10");
    assert(lim74.maxAliases === 740, "N=74 maxAliases should be 740");
  }

  // =========================================================================
  // 4. Edge Cases: Non-integer or negative inputs
  // =========================================================================
  {
    const resZero = calculateGraduatedPricing(0, "monthly");
    assert(resZero.seatCount === 1, "0 seats normalized to 1");
    const resNegative = calculateGraduatedPricing(-15, "annual");
    assert(resNegative.seatCount === 1, "Negative seats normalized to 1");
    const resDecimal = calculateGraduatedPricing(15.8, "monthly");
    assert(resDecimal.seatCount === 15, "15.8 floored to 15");
  }

  return { passed, failed };
}

