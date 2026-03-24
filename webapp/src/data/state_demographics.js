// State electorate demographic data — populated by pipeline/fetch_demographics.py
// Keyed by state seat ID (VIC: 9001-9088, NSW: 8001-8093, QLD: 7201-7293,
//                          WA: 7301-7359, SA: 7401-7447, NT: 7501-7525)
// Fields: medianAge, medianPersonalIncome, medianHouseholdIncome,
//         medianWeeklyRent, medianMonthlyMortgage, ownerOutrightPct,
//         ownerMortgagePct, renterPct, bachelorsOrAbovePct, overseasBornPct, urbanClass

const STATE_DEMOGRAPHICS = {};

export default STATE_DEMOGRAPHICS;
