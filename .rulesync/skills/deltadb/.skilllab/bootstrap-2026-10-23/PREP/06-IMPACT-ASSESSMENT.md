# Practical impact

Largest costs are private transcript leakage, accidental native deletion,
producer sequence corruption, and false confidence in incomplete CRUD.
Mitigations are bounded reads, exact target/effect labels, dedicated producer
discipline, outcome reconciliation, and evidence-ranked claims. User setup or
approval should be requested only for an actual blocked operation, not for docs.
