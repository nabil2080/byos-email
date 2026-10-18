package handlers

type TierBracket struct {
	MinSeats  int
	MaxSeats  int
	RateCents int
}

var TIER_BRACKETS = []TierBracket{
	{MinSeats: 1, MaxSeats: 10, RateCents: 300},
	{MinSeats: 11, MaxSeats: 25, RateCents: 285},
	{MinSeats: 26, MaxSeats: 50, RateCents: 271},
	{MinSeats: 51, MaxSeats: 100, RateCents: 257},
	{MinSeats: 101, MaxSeats: 10000000, RateCents: 244},
}

// CalculateSeatPriceCents computes graduated monthly and annual pricing in integer cents.
func CalculateSeatPriceCents(seats int) (monthlyCents int, annualCents int) {
	if seats < 1 {
		seats = 1
	}
	remaining := seats
	for _, b := range TIER_BRACKETS {
		if remaining <= 0 {
			break
		}
		capacity := b.MaxSeats - b.MinSeats + 1
		inTier := remaining
		if inTier > capacity {
			inTier = capacity
		}
		monthlyCents += inTier * b.RateCents
		remaining -= inTier
	}
	annualCents = monthlyCents * 10
	return monthlyCents, annualCents
}

// ComputeCapacityCaps calculates dynamic resource limits from seat count:
// - Mailboxes: 1 per seat
// - Domains: max(1, ceil(seats / 5))
// - Aliases: max(5, seats * 2)
func ComputeCapacityCaps(seats int) (domainsCap int, aliasesCap int) {
	if seats < 1 {
		seats = 1
	}
	domainsCap = (seats + 4) / 5
	if domainsCap < 1 {
		domainsCap = 1
	}
	aliasesCap = seats * 2
	if aliasesCap < 5 {
		aliasesCap = 5
	}
	return domainsCap, aliasesCap
}
