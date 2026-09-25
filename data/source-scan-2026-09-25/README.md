# Official-source scan, Sept. 25, 2026

A scan of the Office of Labor Relations (OLR) labor pages, CUNY's labor contracts page, the Mayor's Office, the Office of Collective Bargaining, the Comptroller and the state Public Employment Relations Board for contract documents not in this database.

- `links.json`: every PDF link on each OLR page scanned, tagged IN (in the database), PRED (an earlier agreement for a document in the database) or NEW.
- `check.json`: HTTP status for each link (206 = a PDF was returned).
- `predecessor-map.txt`: for each of the 59 amendments with no linked underlying agreement, the earlier OLR documents that appear to be its predecessors. Matched by title and term; about 25 were confirmed by reading the text. Treat the rest as leads to verify before linking.

Findings: no official source posts NYSNA's July 2023 contract or the UFA and UFOA successor unit agreements. Sixteen current documents are published but not in the database (10 CUNY non-faculty agreements and 6 unlinked OLR memoranda); their text was added to the Gemini Notebook directly.
